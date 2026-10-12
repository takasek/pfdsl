import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classifyAgentOperations } from "./agent-operation-classifier.mjs";
import { collectAgentOperationEnvironment } from "./agent-operation-environment.mjs";
import { readShell } from "./shell-commands.mjs";

function fixture({ nativeLock = true } = {}) {
	const root = mkdtempSync(
		fileURLToPath(new URL("../../node_modules/pfdsl-facts-", import.meta.url)),
	);
	const roots = Object.fromEntries(
		["primary", "own", "live", "native", "unowned", "foreign"].map((name) => [
			name,
			join(root, name),
		]),
	);
	for (const path of Object.values(roots)) mkdirSync(path);
	mkdirSync(join(roots.primary, "sub"));
	symlinkSync(join(roots.primary, "sub"), join(roots.own, "link"));
	const commonDir = join(roots.primary, ".git");
	const start = "Mon Oct 12 00:00:00 2026";
	const listing = Object.entries(roots)
		.filter(([name]) => name !== "foreign")
		.map(
			([name, path]) =>
				`worktree ${path}\0branch refs/heads/${name === "primary" ? "main" : `feat/${name}`}\0${name === "live" || (name === "native" && nativeLock) ? `locked claude session ${name} (pid ${name === "live" ? 456 : 123} start ${start})\0` : ""}\0`,
		)
		.join("");
	const seen = [];
	const probeGit = (args, options) => {
		seen.push({ args, options });
		const target = Object.values(roots).find(
			(path) => options.cwd === path || options.cwd.startsWith(`${path}/`),
		);
		const ok = (out) => ({ ok: true, status: 0, out });
		if (args.includes("--show-toplevel"))
			return target
				? ok(target)
				: { ok: false, status: 128, out: "not a git repository" };
		if (args.includes("--git-common-dir"))
			return ok(target === roots.foreign ? join(target, ".git") : commonDir);
		if (args.includes("--git-path"))
			return ok(
				join(
					commonDir,
					"worktrees",
					target?.split("/").at(-1),
					"codex-thread.json",
				),
			);
		if (args.includes("--absolute-git-dir"))
			return ok(join(commonDir, "worktrees", target?.split("/").at(-1)));
		if (args[0] === "worktree") return ok(listing);
		if (args[0] === "symbolic-ref") return ok("origin/main\n");
		throw new Error(`unexpected observation ${JSON.stringify(args)}`);
	};
	const probeProcess = () => ({ ok: true, status: 0, out: start });
	const readMetadata = (path) =>
		JSON.stringify({
			version: 1,
			ownerThreadId: path.includes("/native/") ? "session" : "other",
		});
	return {
		root,
		roots,
		commonDir,
		seen,
		probeGit,
		probeProcess,
		readMetadata,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("environment observations preserve session origin, physical targets, branch occupancy and live native evidence", () => {
	const f = fixture();
	try {
		const payload = {
			tool_name: "Write",
			cwd: f.roots.own,
			session_id: "session",
			tool_input: { file_path: `${f.roots.own}/link/../a`, content: "x" },
		};
		const facts = collectAgentOperationEnvironment(payload, {
			hookRoot: f.root,
			environment: { CLAUDE_PROJECT_DIR: f.roots.own, GIT_DIR: "/unobserved" },
			parentPid: 123,
			probeGit: f.probeGit,
			probeProcess: f.probeProcess,
			readMetadata: f.readMetadata,
		});
		assert.equal(facts.sessionRoot, f.roots.own);
		assert.equal(facts.commonDir, f.commonDir);
		assert.ok(facts.gitMetadataPaths.includes(f.commonDir));
		assert.equal(facts.defaultBranch, "main");
		assert.equal(facts.branches["feat/live"].checkedOutAt, f.roots.live);
		assert.equal(
			facts.worktrees.find(({ root }) => root === f.roots.primary).primary,
			true,
		);
		assert.equal(
			facts.worktrees.find(({ root }) => root === f.roots.live).ownership.live,
			true,
		);
		assert.equal(
			facts.worktrees.find(({ root }) => root === f.roots.native).ownership
				.ownerId,
			"session",
		);
		const operation = classifyAgentOperations(payload, facts).operations[0];
		assert.equal(operation.target, "primary");
		assert.equal(operation.executionPath, join(f.roots.primary, "a"));
		assert.ok(f.seen.every(({ options }) => options.env.GIT_DIR === undefined));
	} finally {
		f.cleanup();
	}
});

test("Codex observes native identity separately from cwd and ignores the unobserved workdir", () => {
	const f = fixture({ nativeLock: false });
	try {
		const payload = {
			tool_name: "exec_command",
			cwd: f.roots.own,
			session_id: "session",
			tool_input: {
				cmd: `git -C ${f.roots.native} add a`,
				workdir: f.roots.primary,
			},
		};
		const shell = readShell(payload.tool_input.cmd);
		const facts = collectAgentOperationEnvironment(payload, {
			hookRoot: f.root,
			shell,
			environment: {},
			parentPid: 999,
			probeGit: f.probeGit,
			probeProcess: f.probeProcess,
			readMetadata: f.readMetadata,
		});
		assert.equal(facts.sessionRoot, f.roots.own);
		const operation = classifyAgentOperations(payload, facts).operations[0];
		assert.equal(operation.target, "own");
		assert.equal(operation.executionPath, f.roots.native);
		assert.equal(
			facts.worktrees.find(({ root }) => root === f.roots.unowned).ownership
				.ownerId,
			"other",
		);
		assert.equal(
			facts.worktrees.find(({ root }) => root === f.roots.unowned).ownership
				.live,
			false,
		);
	} finally {
		f.cleanup();
	}
});

test("GitHub capabilities have no checkout and unknown capabilities remain unresolved", () => {
	const payload = {
		tool_name: "mcp__plugin_github_github__merge_pull_request",
		tool_input: {},
	};
	const facts = collectAgentOperationEnvironment(payload, {
		hookRoot: "/fixture/hook",
		environment: {},
		probeGit: () => {
			throw new Error("remote operation must not probe a checkout");
		},
	});
	assert.deepEqual(
		classifyAgentOperations(payload, facts).operations[0].classes,
		["O", "P"],
	);
	assert.deepEqual(
		classifyAgentOperations(
			{ ...payload, tool_name: "mcp__github__future_operation" },
			facts,
		).operations[0].classes,
		["U"],
	);
});
