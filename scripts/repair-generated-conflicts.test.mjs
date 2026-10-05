import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import {
	isGeneratedPath,
	mergeGeneratedConflicts,
	regenerateOperationalSvgs,
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

function fixture(t, canonicalConflict = false, svg = false) {
	const diagram =
		svg === "nested" ? ".pfdsl/team/deep/pipeline" : ".pfdsl/pipeline";
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
	if (svg) {
		put(`${diagram}.pfdsl`, "first\nmiddle\nlast\n");
		put(`${diagram}.svg`, "original svg\n");
	}
	commit("initial");
	git("switch", "-c", "feature");
	put("plugin/output.txt", "feature\n");
	put("feature.txt", "feature\n");
	if (svg) {
		put(`${diagram}.pfdsl`, "feature\nmiddle\nlast\n");
		put(`${diagram}.svg`, "feature svg\n");
	}
	if (canonicalConflict === true) put("source.txt", "feature\n");
	const head = commit("feature");
	git("switch", "main");
	put("plugin/output.txt", "main\n");
	if (svg) {
		put(
			`${diagram}.pfdsl`,
			canonicalConflict === "diagram"
				? "main\nmiddle\nlast\n"
				: "first\nmiddle\nmain\n",
		);
		put(`${diagram}.svg`, "main svg\n");
	}
	put("source.txt", "main\n");
	const base = commit("main update");
	git("switch", "feature");
	return { root, git, put, head, base, commit };
}

test("operational SVG conflicts preserve automatically merged canonical source", (t) => {
	const f = fixture(t, false, true);
	assert.ok(
		mergeGeneratedConflicts(f.root, f.head, f.base).includes(
			".pfdsl/pipeline.svg",
		),
	);
	assert.equal(
		readFileSync(join(f.root, ".pfdsl/pipeline.pfdsl"), "utf8"),
		"feature\nmiddle\nmain\n",
	);
	f.put(".pfdsl/pipeline.svg", "regenerated svg\n");
	const repaired = f.commit("regenerate SVG");
	assert.doesNotThrow(() => verifyRepair(f.root, f.head, f.base, repaired));
});

test("nested SVG conflicts preserve merged source and pass independent publication checks", (t) => {
	const f = fixture(t, false, "nested");
	const path = ".pfdsl/team/deep/pipeline.svg";
	assert.ok(mergeGeneratedConflicts(f.root, f.head, f.base).includes(path));
	assert.equal(
		readFileSync(join(f.root, path.replace(/\.svg$/, ".pfdsl")), "utf8"),
		"feature\nmiddle\nmain\n",
	);
	f.put(path, "regenerated\n");
	assert.doesNotThrow(() =>
		verifyRepair(f.root, f.head, f.base, f.commit("nested repair")),
	);
});

test("publisher rejects SVGs without a tracked matching operational source", (t) => {
	const f = fixture(t);
	mergeGeneratedConflicts(f.root, f.head, f.base);
	f.put(".pfdsl/unknown.svg", "unowned\n");
	assert.throws(
		() => verifyRepair(f.root, f.head, f.base, f.commit("unowned output")),
		/unknown.svg/,
	);
});

test("renderer consumes merged source recursively, excludes orphan SVGs, and preserves output on failure", (t) => {
	const f = fixture(t, false, true);
	mergeGeneratedConflicts(f.root, f.head, f.base);
	f.put(".pfdsl/orphan.svg", "orphan\n");
	f.put(".pfdsl/nested/diagram.pfdsl", "nested\n");
	f.put(".pfdsl/nested/diagram.svg", "nested svg\n");
	f.put(".pfdsl/workflow.pfdsl", "workflow source\n");
	f.put(".pfdsl/workflow.svg", "workflow svg\n");
	f.put("docs/samples/example.pfdsl", "sample\n");
	f.put("docs/samples/example.svg", "sample svg\n");
	symlinkSync("../source.txt", join(f.root, ".pfdsl/linked.pfdsl"));
	f.put(".pfdsl/linked.svg", "linked svg\n");
	f.put(
		"packages/cli/dist/cli.js",
		`const fs=require('node:fs');
if(process.env.GH_TOKEN || process.env.GITHUB_TOKEN)process.exit(2);
if(process.env.REPAIR_TEST_RENDER_FAIL)process.exit(1);
process.stdout.write('<svg>'+fs.readFileSync(process.argv[3],'utf8')+'</svg>');`,
	);
	f.git("add", "-A");
	const tree = f.git("write-tree");
	assert.deepEqual(regenerateOperationalSvgs(f.root, tree), [
		".pfdsl/nested/diagram.svg",
		".pfdsl/pipeline.svg",
		".pfdsl/workflow.svg",
	]);
	assert.equal(
		readFileSync(join(f.root, ".pfdsl/workflow.svg"), "utf8"),
		"<svg>workflow source\n</svg>",
	);
	assert.equal(
		readFileSync(join(f.root, ".pfdsl/linked.svg"), "utf8"),
		"linked svg\n",
	);
	assert.equal(
		readFileSync(join(f.root, "docs/samples/example.svg"), "utf8"),
		"sample svg\n",
	);
	assert.equal(
		readFileSync(join(f.root, ".pfdsl/nested/diagram.svg"), "utf8"),
		"<svg>nested\n</svg>",
	);
	const expected = "<svg>feature\nmiddle\nmain\n</svg>";
	assert.equal(
		readFileSync(join(f.root, ".pfdsl/pipeline.svg"), "utf8"),
		expected,
	);
	assert.equal(
		readFileSync(join(f.root, ".pfdsl/orphan.svg"), "utf8"),
		"orphan\n",
	);
	f.put("packages/cli/dist/cli.js", "process.exit(1)");
	assert.throws(() => regenerateOperationalSvgs(f.root, tree));
	assert.equal(
		readFileSync(join(f.root, ".pfdsl/pipeline.svg"), "utf8"),
		expected,
	);
});

test("a canonical conflict leaves the SVG unresolved and cannot be smuggled through publication", (t) => {
	const f = fixture(t, "diagram", true);
	assert.throws(
		() => mergeGeneratedConflicts(f.root, f.head, f.base),
		/pipeline.pfdsl/,
	);
	assert.match(f.git("diff", "--name-only", "--diff-filter=U"), /pipeline.svg/);
	assert.throws(
		() => verifyRepair(f.root, f.head, f.base, f.commit("invalid markers")),
		/pipeline.pfdsl/,
	);
});

test("nested canonical conflicts stop before resolving nested SVGs", (t) => {
	const f = fixture(t, "diagram", "nested");
	assert.throws(
		() => mergeGeneratedConflicts(f.root, f.head, f.base),
		/team\/deep\/pipeline.pfdsl/,
	);
	assert.match(
		f.git("diff", "--name-only", "--diff-filter=U"),
		/team\/deep\/pipeline.svg/,
	);
	assert.throws(
		() =>
			verifyRepair(f.root, f.head, f.base, f.commit("invalid nested markers")),
		/pipeline.pfdsl/,
	);
});

test("renderer cannot modify plugin or canonical files or create new files", (t) => {
	for (const path of ["source.txt", "plugin/output.txt", "unexpected.txt"]) {
		const f = fixture(t, false, true);
		mergeGeneratedConflicts(f.root, f.head, f.base);
		f.put(
			"packages/cli/dist/cli.js",
			`require('node:fs').writeFileSync(${JSON.stringify(path)},'tampered');process.stdout.write('<svg/>');`,
		);
		f.git("add", "-A");
		assert.throws(
			() => regenerateOperationalSvgs(f.root, f.git("write-tree")),
			/outside|unexpected/,
		);
	}
});

test("publisher rejects symlink SVG replacement and canonical diagram edits", (t) => {
	for (const kind of ["symlink", "source"]) {
		const f = fixture(t, false, true);
		mergeGeneratedConflicts(f.root, f.head, f.base);
		if (kind === "symlink") {
			rmSync(join(f.root, ".pfdsl/pipeline.svg"));
			symlinkSync("../source.txt", join(f.root, ".pfdsl/pipeline.svg"));
		} else f.put(".pfdsl/pipeline.pfdsl", "tampered\n");
		assert.throws(
			() => verifyRepair(f.root, f.head, f.base, f.commit("invalid repair")),
			/pipeline/,
		);
	}
});

test("a mixed regular and symlink SVG conflict requires manual resolution", (t) => {
	const f = fixture(t, false, true);
	rmSync(join(f.root, ".pfdsl/pipeline.svg"));
	symlinkSync("../source.txt", join(f.root, ".pfdsl/pipeline.svg"));
	const head = f.commit("symlink output");
	assert.throws(
		() => mergeGeneratedConflicts(f.root, head, f.base),
		/pipeline/,
	);
});

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

test("prepare CLI explains source conflicts in logs and the Actions summary without publishing", (t) => {
	const f = fixture(t, true);
	const artifacts = join(f.root, "artifacts");
	mkdirSync(artifacts);
	writeFileSync(
		join(artifacts, "snapshot.json"),
		JSON.stringify({
			repository: "owner/repo",
			number: 12,
			head: f.head,
			base: f.base,
			branch: "feature",
		}),
	);
	const summary = join(f.root, "summary.md");
	const result = spawnSync(
		process.execPath,
		[
			new URL("./repair-generated-conflicts.mjs", import.meta.url).pathname,
			"prepare",
			f.root,
			artifacts,
		],
		{ encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: summary } },
	);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /source.txt/);
	assert.match(result.stderr, /Resolve these files manually/);
	assert.doesNotMatch(result.stderr, /at assertGenerated/);
	assert.match(readFileSync(summary, "utf8"), /No changes were pushed/);
	assert.match(readFileSync(summary, "utf8"), /source.txt/);
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

test("publication CLI accepts a bundle without a duplicate result JSON and rejects missing bundle refs", (t) => {
	const f = fixture(t);
	mergeGeneratedConflicts(f.root, f.head, f.base);
	f.put("plugin/output.txt", "regenerated\n");
	const repaired = f.commit("repair");
	const artifacts = join(f.root, "artifacts");
	const bin = join(f.root, "bin");
	mkdirSync(artifacts);
	mkdirSync(bin);
	writeFileSync(
		join(f.root, ".git/info/exclude"),
		"artifacts/\nbin/\nremote.git/\n",
	);
	const value = {
		repository: "owner/repo",
		number: 12,
		head: f.head,
		base: f.base,
		branch: "feature",
	};
	writeFileSync(join(artifacts, "snapshot.json"), JSON.stringify(value));
	const gh = join(bin, "gh");
	writeFileSync(
		gh,
		`#!/usr/bin/env node\nconst v=JSON.parse(process.env.REPAIR_TEST_SNAPSHOT);console.log(JSON.stringify(process.argv.at(-1).endsWith('/heads/main') ? {object:{sha:v.base}} : {state:'open',head:{sha:v.head,ref:v.branch,repo:{full_name:v.repository}},base:{sha:v.base,ref:'main',repo:{full_name:v.repository}}}));\n`,
	);
	chmodSync(gh, 0o755);
	const execute = (mode = "verify", extraEnv = {}) =>
		spawnSync(
			process.execPath,
			[
				new URL("./repair-generated-conflicts.mjs", import.meta.url).pathname,
				mode,
				f.root,
				artifacts,
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					PATH: `${bin}:${process.env.PATH}`,
					GITHUB_REPOSITORY: value.repository,
					PR_NUMBER: "12",
					REPAIR_TEST_SNAPSHOT: JSON.stringify(value),
					...extraEnv,
				},
			},
		);
	const retryOutput = join(artifacts, "retry-output");
	for (const field of ["head", "branch"]) {
		const fresh = { ...value, [field]: "c".repeat(40) };
		writeFileSync(retryOutput, "");
		const stale = execute("publish", {
			REPAIR_TEST_SNAPSHOT: JSON.stringify(fresh),
			GITHUB_OUTPUT: retryOutput,
		});
		assert.equal(stale.status, 0, stale.stderr);
		assert.equal(readFileSync(retryOutput, "utf8"), "retry=true\n");
		assert.match(stale.stdout, /No changes were pushed/);
	}
	const staleValidation = execute("verify", {
		REPAIR_TEST_SNAPSHOT: JSON.stringify({ ...value, head: "c".repeat(40) }),
	});
	assert.notEqual(staleValidation.status, 0);
	assert.match(staleValidation.stderr, /fresh preparation/);
	f.git("update-ref", "refs/heads/generated-repair-result", repaired);
	f.git(
		"bundle",
		"create",
		join(artifacts, "repair.bundle"),
		"refs/heads/generated-repair-result",
	);
	let result = execute();
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /not pushed/);
	// Route only the GitHub remote URL to a real local bare repository. The
	// fake PR API deliberately continues reporting the old head after push.
	const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
	const remote = join(f.root, "remote.git");
	f.git("init", "--bare", remote);
	f.git("push", remote, `${f.head}:refs/heads/feature`);
	writeFileSync(
		join(bin, "git"),
		`#!${process.execPath}
const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2);
const remote=${JSON.stringify(remote)};
const git=${JSON.stringify(realGit)};
const index=args.indexOf('https://github.com/owner/repo.git');
if(index>=0)args[index]=remote;
const result=spawnSync(git,args,{stdio:'inherit'});
if(result.status===0 && args[0]==='push' && process.env.REPAIR_TEST_CHANGE_REMOTE){
 const changed=spawnSync(git,['--git-dir',remote,'update-ref','refs/heads/feature',process.env.REPAIR_TEST_CHANGE_REMOTE],{stdio:'inherit'});
 if(changed.status!==0)process.exit(changed.status);
}
if(result.status===0 && args[0]==='push' && process.env.REPAIR_TEST_DELETE_REMOTE){
 const deleted=spawnSync(git,['--git-dir',remote,'update-ref','-d','refs/heads/feature'],{stdio:'inherit'});
 if(deleted.status!==0)process.exit(deleted.status);
}
process.exit(result.status ?? 1);
`,
		{ mode: 0o755 },
	);
	// Concurrent main changes that merge cleanly can use Update branch later.
	f.git("switch", "main");
	f.put("parallel.txt", "parallel source update\n");
	const cleanBase = f.commit("parallel update");
	f.git("push", remote, `${cleanBase}:refs/heads/main`);
	f.git("switch", "feature");
	result = execute("verify", {
		REPAIR_TEST_SNAPSHOT: JSON.stringify({ ...value, base: cleanBase }),
	});
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Update branch/);
	// A new generated conflict must go through preparation again.
	f.git("switch", "main");
	f.put("plugin/output.txt", "new main output\n");
	const conflictingBase = f.commit("parallel generated update");
	f.git("push", remote, `${conflictingBase}:refs/heads/main`);
	f.git("switch", "feature");
	writeFileSync(retryOutput, "");
	result = execute("publish", {
		REPAIR_TEST_SNAPSHOT: JSON.stringify({ ...value, base: conflictingBase }),
		GITHUB_OUTPUT: retryOutput,
	});
	assert.equal(result.status, 0, result.stderr);
	assert.equal(readFileSync(retryOutput, "utf8"), "retry=true\n");
	assert.equal(
		f.git("--git-dir", remote, "rev-parse", "refs/heads/feature"),
		f.head,
	);
	result = execute("verify", {
		REPAIR_TEST_SNAPSHOT: JSON.stringify({ ...value, base: conflictingBase }),
	});
	assert.notEqual(result.status, 0);
	const synchronized = { ...value, head: repaired };
	const verifiedBundle = readFileSync(join(artifacts, "repair.bundle"));
	rmSync(join(artifacts, "repair.bundle"));
	writeFileSync(join(artifacts, "snapshot.json"), JSON.stringify(synchronized));
	writeFileSync(retryOutput, "");
	result = execute("recheck", {
		REPAIR_TEST_SNAPSHOT: JSON.stringify({
			...synchronized,
			base: conflictingBase,
		}),
		GITHUB_OUTPUT: retryOutput,
	});
	assert.equal(result.status, 0, result.stderr);
	assert.equal(readFileSync(retryOutput, "utf8"), "retry=true\n");
	result = execute("recheck", {
		REPAIR_TEST_SNAPSHOT: JSON.stringify(synchronized),
	});
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /not pushed/);
	writeFileSync(join(artifacts, "snapshot.json"), JSON.stringify(value));
	result = execute("recheck");
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /has not integrated/);
	writeFileSync(join(artifacts, "repair.bundle"), verifiedBundle);
	result = execute("publish");
	assert.equal(result.status, 0, result.stderr);
	assert.equal(
		f.git("--git-dir", remote, "rev-parse", "refs/heads/feature"),
		repaired,
	);
	assert.match(result.stdout, /\(pushed\)/);
	result = execute("publish", { REPAIR_TEST_CHANGE_REMOTE: f.head });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /remote branch/);
	result = execute("publish", { REPAIR_TEST_DELETE_REMOTE: "1" });
	assert.notEqual(result.status, 0);
	assert.match(
		result.stderr,
		/Push succeeded, but remote branch verification failed/,
	);
	f.git("bundle", "create", join(artifacts, "wrong.bundle"), "refs/heads/main");
	writeFileSync(
		join(artifacts, "repair.bundle"),
		readFileSync(join(artifacts, "wrong.bundle")),
	);
	result = execute();
	assert.notEqual(result.status, 0);
	rmSync(join(artifacts, "repair.bundle"));
	assert.notEqual(execute().status, 0);
});

test("repair workflow retries fresh isolated attempts only when requested", (t) => {
	const readWorkflow = (name) =>
		parse(
			readFileSync(
				new URL(`../.github/workflows/${name}`, import.meta.url),
				"utf8",
			),
		);
	const workflow = readWorkflow("repair-generated-conflicts.yml");
	const attempt = readWorkflow("repair-generated-conflicts-attempt.yml");
	assert.deepEqual(workflow.on.workflow_dispatch.inputs.mode.options, [
		"repair",
		"validate",
	]);
	assert.deepEqual(Object.keys(workflow.jobs), [
		"attempt-1",
		"attempt-2",
		"attempt-3",
		"retry-limit",
	]);
	for (let index = 1; index <= 3; index++) {
		const job = workflow.jobs[`attempt-${index}`];
		assert.equal(
			job.uses,
			"./.github/workflows/repair-generated-conflicts-attempt.yml",
		);
		assert.equal(job.with.attempt, index);
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal GitHub expression.
		assert.equal(job.with.mode, "${{ inputs.mode }}");
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal GitHub expression.
		assert.equal(job.with["pull-request"], "${{ inputs.pull-request }}");
		assert.equal(job.permissions, undefined);
		if (index === 1) assert.equal(job.needs, undefined);
		else {
			assert.equal(job.needs, `attempt-${index - 1}`);
			assert.equal(
				job.if,
				`needs.attempt-${index - 1}.outputs.retry == 'true'`,
			);
		}
	}
	assert.equal(
		attempt.on.workflow_call.outputs.retry.value,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal GitHub expression.
		"${{ jobs.publish.outputs.retry || jobs.recheck.outputs.retry }}",
	);
	assert.equal(
		attempt.jobs.publish.outputs.retry,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal GitHub expression.
		"${{ steps.publish.outputs.retry }}",
	);
	assert.equal(
		attempt.jobs.prepare.steps.find((step) =>
			step.uses?.startsWith("actions/upload-artifact@"),
		).with.name,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal GitHub expression.
		"generated-repair-${{ inputs.attempt }}",
	);
	assert.equal(
		attempt.jobs.publish.steps.find((step) =>
			step.uses?.startsWith("actions/download-artifact@"),
		).with.name,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal GitHub expression.
		"generated-repair-${{ inputs.attempt }}",
	);
	assert.equal(attempt.concurrency, undefined);
	assert.equal(attempt.jobs.recheck.permissions, undefined);
	assert.equal(attempt.jobs.recheck.needs, "prepare");
	assert.match(attempt.jobs.recheck.if, /changed == 'false'/);
	assert.match(attempt.jobs.recheck.if, /inputs.mode == 'repair'/);
	assert.equal(
		attempt.jobs.prepare.steps.find((step) =>
			step.uses?.startsWith("actions/upload-artifact@"),
		).if,
		undefined,
	);
	const limit = workflow.jobs["retry-limit"];
	assert.equal(limit.needs, "attempt-3");
	assert.equal(limit.if, "needs.attempt-3.outputs.retry == 'true'");
	const root = mkdtempSync(join(tmpdir(), "repair-retry-limit-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const summary = join(root, "summary.md");
	const result = spawnSync("bash", ["-e", "-c", limit.steps[0].run], {
		encoding: "utf8",
		env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /three repair attempts/);
	assert.match(readFileSync(summary, "utf8"), /No repair was pushed/);
});

test("workflow isolates PR execution from publication credentials", () => {
	const workflow = parse(
		readFileSync(
			new URL(
				"../.github/workflows/repair-generated-conflicts-attempt.yml",
				import.meta.url,
			),
			"utf8",
		),
	);
	assert.equal(workflow.permissions.contents, "read");
	assert.deepEqual(Object.keys(workflow.on.workflow_call.inputs), [
		"pull-request",
		"mode",
		"attempt",
	]);
	const app = workflow.jobs.publish.steps.find(
		(step) => step.id === "app-token",
	);
	assert.equal(app.if, undefined);
	assert.equal(workflow.jobs.prepare.permissions, undefined);
	assert.equal(workflow.jobs.publish.permissions.contents, "write");
	assert.equal(workflow.jobs.publish.needs, "prepare");
	assert.equal(workflow.jobs.prepare.if, undefined);
	const guard = workflow.jobs.prepare.steps[0];
	assert.equal(guard.name, "Check execution mode and workflow branch");
	assert.match(workflow.jobs.publish.if, /github.ref == 'refs\/heads\/main'/);
	assert.match(workflow.jobs.publish.if, /inputs.mode == 'repair'/);
	const root = mkdtempSync(join(tmpdir(), "repair-branch-guard-"));
	try {
		for (const [ref, mode] of [
			["refs/heads/main", "repair"],
			["refs/heads/feature", "repair"],
			["refs/heads/main", "validate"],
			["refs/heads/feature", "validate"],
		]) {
			const summary = join(root, "summary.md");
			writeFileSync(summary, "");
			const result = spawnSync("bash", ["-e", "-c", guard.run], {
				encoding: "utf8",
				env: {
					...process.env,
					GITHUB_REF: ref,
					REPAIR_MODE: mode,
					GITHUB_STEP_SUMMARY: summary,
				},
			});
			assert.equal(
				result.status,
				mode === "validate" || ref.endsWith("/main") ? 0 : 1,
			);
			if (result.status) {
				assert.match(result.stdout, /Select main/);
				assert.match(readFileSync(summary, "utf8"), /Select main/);
			}
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
	const preparing = workflow.jobs.prepare.steps;
	assert.equal(
		preparing.some((step) =>
			step.uses?.startsWith("actions/create-github-app-token@"),
		),
		false,
	);
	const execution = preparing.find((step) => step.id === "repair");
	assert.equal(execution.env, undefined);
	for (const step of [
		...preparing,
		...workflow.jobs.publish.steps,
		...workflow.jobs.recheck.steps,
	]) {
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
	// biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression syntax is intentionally literal.
	assert.equal(publisher.env.GH_TOKEN, "${{ steps.app-token.outputs.token }}");
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
