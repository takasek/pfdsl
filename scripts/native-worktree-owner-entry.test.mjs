import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(
	new URL("./main-commit-guard.mjs", import.meta.url),
);
const env = { ...process.env };
for (const key of Object.keys(env))
	if (key.startsWith("GIT_") || key === "CLAUDE_PROJECT_DIR") delete env[key];
const git = (cwd, args) =>
	execFileSync("git", args, {
		cwd,
		env,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();

// Disposable Git fixtures with synthetic metadata: real repo entrypoint I/O,
// not evidence that the native harness wrote or authorized the ownership.
describe("native ownership through the real hook entry", () => {
	let fixture, repo, target, metadata;
	before(() => {
		fixture = realpathSync(
			mkdtempSync(join(tmpdir(), "pfdsl-native-owner-entry-")),
		);
		repo = join(fixture, "repo");
		git(fixture, ["init", "-b", "main", repo]);
		git(repo, [
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.invalid",
			"commit",
			"--allow-empty",
			"-m",
			"test: fixture",
		]);
		target = join(fixture, "作業 tree");
		git(repo, ["remote", "add", "origin", repo]);
		git(repo, [
			"symbolic-ref",
			"refs/remotes/origin/HEAD",
			"refs/remotes/origin/main",
		]);
		git(repo, ["worktree", "add", "-b", "topic", target]);
		metadata = resolve(
			target,
			git(target, ["rev-parse", "--git-path", "codex-thread.json"]),
		);
	});
	after(() => rmSync(fixture, { recursive: true, force: true }));
	function invoke(command, overrides = {}) {
		const out = execFileSync(process.execPath, [entry], {
			cwd: repo,
			env: { ...env, ...overrides },
			input: JSON.stringify({
				hook_event_name: "PreToolUse",
				tool_name: "Bash",
				cwd: repo,
				session_id: "native-thread",
				tool_input: { command },
			}),
			encoding: "utf-8",
		});
		return out.trim() ? JSON.parse(out).hookSpecificOutput : null;
	}
	it("allows the matched Codex sibling but keeps other owners and main/bypass protected", () => {
		writeFileSync(
			metadata,
			JSON.stringify({ version: 1, ownerThreadId: "native-thread" }),
		);
		assert.equal(invoke(`git -C '${target}' add file`), null);
		assert.equal(
			invoke(`git -C '${target}' commit --no-verify -m test`)
				.permissionDecision,
			"deny",
		);
		assert.equal(invoke("git add file").permissionDecision, "deny");
		writeFileSync(
			metadata,
			JSON.stringify({ version: 1, ownerThreadId: "other" }),
		);
		assert.equal(
			invoke(`git -C '${target}' add file`).permissionDecision,
			"deny",
		);
		writeFileSync(metadata, "{broken");
		assert.equal(
			invoke(`git -C '${target}' add file`).permissionDecision,
			"deny",
		);
		rmSync(metadata);
		assert.equal(
			invoke(`git -C '${target}' add file`).permissionDecision,
			"deny",
		);
	});
	it("reads direct Claude parent from the real process and rejects a stale start", () => {
		const start = execFileSync(
			"ps",
			["-o", "lstart=", "-p", String(process.pid)],
			{ env: { ...env, LC_ALL: "C", TZ: "UTC" }, encoding: "utf-8" },
		).trim();
		git(repo, [
			"worktree",
			"lock",
			"--reason",
			`claude session topic (pid ${process.pid} start ${start})`,
			target,
		]);
		assert.equal(
			invoke(`git -C '${target}' add file`, { CLAUDE_PROJECT_DIR: repo }),
			null,
		);
		git(repo, ["worktree", "unlock", target]);
		git(repo, [
			"worktree",
			"lock",
			"--reason",
			`claude session topic (pid ${process.pid} start Tue Oct 6 00:00:00 2026)`,
			target,
		]);
		const result = invoke(`git -C '${target}' add file`, {
			CLAUDE_PROJECT_DIR: repo,
		});
		assert.equal(result.permissionDecision, "ask");
		assert.match(
			result.permissionDecisionReason,
			/could not confirm.*native owner/i,
		);
		git(repo, ["worktree", "unlock", target]);
	});
	it("does not permit shell owner identity or ambient Git target substitution", () => {
		writeFileSync(
			metadata,
			JSON.stringify({ version: 1, ownerThreadId: "other" }),
		);
		assert.equal(
			invoke(`git -C '${target}' add file`, { CODEX_THREAD_ID: "other" })
				.permissionDecision,
			"deny",
		);
		writeFileSync(
			metadata,
			JSON.stringify({ version: 1, ownerThreadId: "native-thread" }),
		);
		assert.equal(
			invoke(`git -C '${target}' add file`, {
				GIT_DIR: git(target, ["rev-parse", "--absolute-git-dir"]),
			}).permissionDecision,
			"deny",
		);
		assert.equal(
			readFileSync(metadata, "utf-8").includes("native-thread"),
			true,
		);
	});
});
