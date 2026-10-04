import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import {
	isGeneratedPath,
	mergeGeneratedConflicts,
	validatePull,
	verifyRepair,
} from "./repair-generated-conflicts.mjs";

const pull = {
	state: "open",
	head: {
		sha: "a".repeat(40),
		ref: "fix/example",
		repo: { full_name: "owner/repo" },
	},
	base: { sha: "b".repeat(40), ref: "main", repo: { full_name: "owner/repo" } },
};

test("only same-repository, open, main-targeted feature PRs are eligible", () => {
	assert.equal(validatePull(pull, "owner/repo", 12).head, pull.head.sha);
	for (const mutate of [
		(p) => {
			p.state = "closed";
		},
		(p) => {
			p.head.repo.full_name = "fork/repo";
		},
		(p) => {
			p.base.ref = "other";
		},
		(p) => {
			p.head.ref = "main";
		},
		(p) => {
			p.head.sha = "invalid";
		},
	]) {
		const p = structuredClone(pull);
		mutate(p);
		assert.throws(() => validatePull(p, "owner/repo", 12));
	}
	assert.throws(() => validatePull(pull, "owner/repo", "1; echo bad"));
});

test("generated ownership uses path boundaries and excludes canonical sources", () => {
	assert.equal(
		isGeneratedPath("plugin/pfdsl/.claude-plugin/bundle-manifest.sha256"),
		true,
	);
	assert.equal(
		isGeneratedPath(
			".claude/skills/pfd-ops/references/github-issues-backend.md",
		),
		true,
	);
	for (const path of [
		"plugins/file",
		"AGENTS.md.extra",
		"scripts/harness-template/file",
		".github/workflows/test.yml",
		"../plugin/file",
	]) {
		assert.equal(isGeneratedPath(path), false, path);
	}
});

function fixture(t, canonicalConflict = false) {
	const root = mkdtempSync(join(tmpdir(), "generated-repair-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const git = (...args) =>
		execFileSync(
			"git",
			["-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
			{ cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		).trim();
	const put = (path, body) => {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), body);
	};
	const commit = (subject) => {
		git("add", "-A");
		git("commit", "-m", subject);
		return git("rev-parse", "HEAD");
	};
	git("init", "-b", "main");
	put("source.txt", "original\n");
	put("plugin/output.txt", "original\n");
	commit("initial");
	git("switch", "-c", "feature");
	put("plugin/output.txt", "feature\n");
	put("feature.txt", "feature\n");
	if (canonicalConflict) put("source.txt", "feature\n");
	const head = commit("feature");
	git("switch", "main");
	put("plugin/output.txt", "main\n");
	put("source.txt", "main\n");
	const base = commit("main update");
	git("switch", "feature");
	return { root, git, put, head, base, commit };
}

test("real Git merge preserves both source changes and regenerates generated conflicts", (t) => {
	const f = fixture(t);
	mergeGeneratedConflicts(f.root, f.head, f.base);
	assert.equal(readFileSync(join(f.root, "source.txt"), "utf8"), "main\n");
	assert.equal(readFileSync(join(f.root, "feature.txt"), "utf8"), "feature\n");
	f.put("plugin/output.txt", "regenerated\n");
	const repaired = f.commit("fix(ci): regenerate generated conflicts");
	assert.deepEqual(f.git("show", "-s", "--format=%P", repaired).split(" "), [
		f.head,
		f.base,
	]);
	verifyRepair(f.root, f.head, f.base, repaired);
});

test("canonical conflict stops before resolving even a generated conflict", (t) => {
	const f = fixture(t, true);
	assert.throws(
		() => mergeGeneratedConflicts(f.root, f.head, f.base),
		/source.txt/,
	);
	assert.match(
		f.git("diff", "--name-only", "--diff-filter=U"),
		/plugin\/output.txt/,
	);
});

test("publisher rejects canonical tampering and wrong parents", (t) => {
	const f = fixture(t);
	mergeGeneratedConflicts(f.root, f.head, f.base);
	f.put("source.txt", "tampered\n");
	const repaired = f.commit("tampered repair");
	assert.throws(
		() => verifyRepair(f.root, f.head, f.base, repaired),
		/source.txt/,
	);
	assert.throws(() => verifyRepair(f.root, f.head, f.base, f.head), /parents/);
});

test("already integrated main is eligible for a generated-only single-parent repair", (t) => {
	const f = fixture(t);
	mergeGeneratedConflicts(f.root, f.head, f.base);
	const integrated = f.commit("integrate main");
	assert.deepEqual(mergeGeneratedConflicts(f.root, integrated, f.base), []);
	f.put("plugin/output.txt", "regenerated\n");
	const repaired = f.commit("repair stale output");
	verifyRepair(f.root, integrated, f.base, repaired);
});

test("workflow isolates PR execution from publication credentials", () => {
	const workflow = parse(
		readFileSync(
			new URL(
				"../.github/workflows/repair-generated-conflicts.yml",
				import.meta.url,
			),
			"utf8",
		),
	);
	assert.equal(workflow.permissions.contents, "read");
	assert.equal(workflow.jobs.prepare.permissions, undefined);
	assert.equal(workflow.jobs.publish.permissions.contents, "write");
	assert.equal(workflow.jobs.publish.needs, "prepare");
	assert.equal(workflow.jobs.prepare.if, "github.ref == 'refs/heads/main'");
	const preparing = workflow.jobs.prepare.steps;
	assert.equal(
		preparing.some((step) =>
			step.uses?.startsWith("actions/create-github-app-token@"),
		),
		false,
	);
	const execution = preparing.find((step) => step.id === "repair");
	assert.equal(execution.env, undefined);
	for (const step of [...preparing, ...workflow.jobs.publish.steps]) {
		if (step.uses?.startsWith("actions/checkout@"))
			assert.equal(step.with["persist-credentials"], false);
		if (step.run) assert.equal(step.run.includes("${{ inputs."), false);
	}
	const publisher = workflow.jobs.publish.steps.find((step) =>
		step.name?.startsWith("Recheck identities"),
	);
	assert.match(
		publisher.run,
		/scripts\/repair-generated-conflicts.mjs publish/,
	);
	// biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression syntax is intentionally literal.
	assert.equal(publisher.env.PR_NUMBER, "${{ inputs.pull-request }}");
});

test("a fresh runner without global Git identity can begin a divergent merge", (t) => {
	const f = fixture(t);
	const moduleUrl = new URL("./repair-generated-conflicts.mjs", import.meta.url)
		.href;
	execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import {mergeGeneratedConflicts} from ${JSON.stringify(moduleUrl)}; mergeGeneratedConflicts(${JSON.stringify(f.root)}, ${JSON.stringify(f.head)}, ${JSON.stringify(f.base)});`,
		],
		{
			env: {
				...process.env,
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_COUNT: "1",
				GIT_CONFIG_KEY_0: "user.useConfigOnly",
				GIT_CONFIG_VALUE_0: "true",
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	assert.equal(f.git("diff", "--name-only", "--diff-filter=U"), "");
});

test("publisher rejects canonical conflicts even if an artifact preserves their marker tree", (t) => {
	const f = fixture(t, true);
	assert.throws(() => mergeGeneratedConflicts(f.root, f.head, f.base));
	// Deliberately commit the markers, modelling an untrusted preparation artifact.
	const repaired = f.commit("invalid conflict artifact");
	assert.throws(
		() => verifyRepair(f.root, f.head, f.base, repaired),
		/source.txt/,
	);
});
