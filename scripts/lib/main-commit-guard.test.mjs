import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	classifyGitCommand,
	crossesWorktree,
	evaluateMainCommitGuard,
	resolveCommandCwd,
	runMainCommitGuard,
} from "./main-commit-guard.mjs";

function payload({ toolName = "Bash", command, cwd }) {
	const value = {
		hook_event_name: "PreToolUse",
		tool_name: toolName,
		tool_input: { command },
	};
	if (cwd !== undefined) value.cwd = cwd;
	return value;
}

describe("classifyGitCommand", () => {
	it("denies subcommands that create new state on the branch", () => {
		for (const sub of ["commit", "add", "rm", "mv", "apply", "am"]) {
			assert.deepEqual(
				classifyGitCommand(`git ${sub} x`),
				{ subcommand: sub, decision: "deny" },
				sub,
			);
		}
	});

	it("asks for subcommands that destroy or restore existing state (#777)", () => {
		for (const sub of [
			"reset",
			"restore",
			"checkout",
			"switch",
			"stash",
			"clean",
			"merge",
			"rebase",
			"cherry-pick",
			"revert",
		]) {
			assert.deepEqual(
				classifyGitCommand(`git ${sub} x`),
				{ subcommand: sub, decision: "ask" },
				sub,
			);
		}
	});

	it("classifies a subcommand behind global git flags", () => {
		assert.deepEqual(classifyGitCommand("git -C /repo commit -m 'x'"), {
			subcommand: "commit",
			decision: "deny",
		});
	});

	it("prefers the denied subcommand over an asked one in a compound", () => {
		assert.deepEqual(classifyGitCommand("git checkout main && git add -A"), {
			subcommand: "add",
			decision: "deny",
		});
	});

	it("leaves read-only git commands alone", () => {
		assert.equal(classifyGitCommand("git status --short"), null);
		assert.equal(classifyGitCommand("git log --oneline -5"), null);
		assert.equal(classifyGitCommand("git fetch origin"), null);
		assert.equal(classifyGitCommand("git worktree add ../w -b topic"), null);
	});

	it("leaves the read-only stash forms alone, since they diagnose a loss", () => {
		assert.equal(classifyGitCommand("git stash list"), null);
		assert.equal(classifyGitCommand("git stash show -p"), null);
	});

	it("leaves the read-only apply forms alone, since they only report", () => {
		assert.equal(classifyGitCommand("git apply --check patch.diff"), null);
		assert.equal(classifyGitCommand("git apply --stat patch.diff"), null);
	});

	it("still denies an apply that writes", () => {
		assert.deepEqual(classifyGitCommand("git apply patch.diff"), {
			subcommand: "apply",
			decision: "deny",
		});
	});

	it("treats a bare `git stash` as the push it is", () => {
		assert.deepEqual(classifyGitCommand("git stash"), {
			subcommand: "stash",
			decision: "ask",
		});
	});

	it("does not classify a subcommand inside a quoted string", () => {
		assert.equal(classifyGitCommand('echo "git commit"'), null);
		assert.equal(classifyGitCommand("echo 'git add -A'"), null);
	});

	it("does not classify a subcommand appearing as a flag value", () => {
		assert.equal(classifyGitCommand("git log --grep commit"), null);
	});

	it("ignores a non-string command", () => {
		assert.equal(classifyGitCommand(undefined), null);
	});
});

describe("resolveCommandCwd", () => {
	const HOOK_CWD = "/repo";

	it("keeps the hook's cwd for a plain commit", () => {
		assert.equal(resolveCommandCwd("git commit -m 'x'", HOOK_CWD), HOOK_CWD);
	});

	it("follows a leading cd into the tree the commit lands in (#751)", () => {
		assert.equal(
			resolveCommandCwd(
				"cd .claude/worktrees/w && git commit -m 'x'",
				HOOK_CWD,
			),
			"/repo/.claude/worktrees/w",
		);
	});

	it("follows an absolute cd", () => {
		assert.equal(
			resolveCommandCwd("cd /elsewhere/w && git commit -m 'x'", HOOK_CWD),
			"/elsewhere/w",
		);
	});

	it("reads git -C, which used to bypass the guard entirely (#751)", () => {
		assert.equal(
			resolveCommandCwd("git -C /elsewhere/w commit -m 'x'", HOOK_CWD),
			"/elsewhere/w",
		);
	});

	it("applies repeated git -C options from left to right (#784)", () => {
		assert.equal(
			resolveCommandCwd(
				"git -C /worktrees/session -C ../sibling add -A",
				HOOK_CWD,
			),
			"/worktrees/sibling",
		);
	});

	it("resolves the tree for guarded subcommands other than commit (#777)", () => {
		assert.equal(resolveCommandCwd("cd /a && git add -A", HOOK_CWD), "/a");
		assert.equal(resolveCommandCwd("git -C /b stash push", HOOK_CWD), "/b");
	});

	it("stops at the first guarded subcommand, not a later one", () => {
		assert.equal(
			resolveCommandCwd(
				"cd /a && git add -A && cd /b && git commit -m 'x'",
				HOOK_CWD,
			),
			"/a",
		);
	});

	it("lets git -C win over an earlier cd, since git resolves last", () => {
		assert.equal(
			resolveCommandCwd("cd /a && git -C /b commit -m 'x'", HOOK_CWD),
			"/b",
		);
	});

	it("uses the cd in effect where the commit runs, not a later one", () => {
		assert.equal(
			resolveCommandCwd("cd /a && git commit -m 'x' && cd /b", HOOK_CWD),
			"/a",
		);
	});

	it("strips quotes around a cd path", () => {
		assert.equal(
			resolveCommandCwd("cd '/a b/w' && git commit -m 'x'", HOOK_CWD),
			"/a b/w",
		);
	});

	it("leaves the cwd unresolved when the path is not statically known", () => {
		assert.equal(
			resolveCommandCwd("cd $WORKTREE && git commit -m 'x'", HOOK_CWD),
			null,
		);
		assert.equal(
			resolveCommandCwd("cd ~/works/x && git commit -m 'x'", HOOK_CWD),
			null,
		);
		assert.equal(
			resolveCommandCwd("cd \"$WORKTREE\" && git commit -m 'x'", HOOK_CWD),
			null,
		);
	});

	it("follows cd with an end-of-options marker or a redirection", () => {
		assert.equal(
			resolveCommandCwd("cd -- /elsewhere/w && git add -A", HOOK_CWD),
			"/elsewhere/w",
		);
		assert.equal(
			resolveCommandCwd("cd /elsewhere/w >/dev/null && git add -A", HOOK_CWD),
			"/elsewhere/w",
		);
	});

	it("leaves the cwd unresolved for a bare cd, which means the home directory", () => {
		assert.equal(resolveCommandCwd("cd && git commit -m 'x'", HOOK_CWD), null);
	});

	it("ignores a cd inside a quoted string", () => {
		assert.equal(
			resolveCommandCwd("echo 'cd /a' && git commit -m 'x'", HOOK_CWD),
			HOOK_CWD,
		);
	});
});

describe("evaluateMainCommitGuard", () => {
	it("recognizes a different worktree only when both roots share one repository", () => {
		const session = {
			worktreeRoot: "/repo/.claude/worktrees/a",
			commonDir: "/repo/.git",
			mainRoot: "/repo",
		};
		assert.equal(
			crossesWorktree(session, {
				...session,
				worktreeRoot: "/repo/.claude/worktrees/b",
			}),
			true,
		);
		assert.equal(crossesWorktree(session, session), false);
		assert.equal(
			crossesWorktree(session, {
				worktreeRoot: "/other/worktree",
				commonDir: "/other/.git",
				mainRoot: "/other",
			}),
			false,
		);
	});

	it("ignores tools other than Bash", () => {
		const result = evaluateMainCommitGuard(
			{
				hook_event_name: "PreToolUse",
				tool_name: "Read",
				tool_input: { file_path: "/tmp/x" },
			},
			{ currentBranch: "main" },
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a read-only command on main", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git status" }), {
			currentBranch: "main",
		});
		assert.equal(result.decision, "allow");
	});

	it("denies staging on main, the index the whole repo shares (#777)", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git add -A" }), {
			currentBranch: "main",
		});
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /git add/);
	});

	it("asks before a restore on main, which is also the recovery path (#777)", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git checkout -- src/x.ts" }),
			{ currentBranch: "main" },
		);
		assert.equal(result.decision, "ask");
		assert.match(result.reason, /git checkout/);
	});

	it("allows staging on a feature branch", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git add -A" }), {
			currentBranch: "feature/x",
		});
		assert.equal(result.decision, "allow");
	});

	it("denies staging when a feature-branch session targets a sibling worktree (#784)", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git add -A" }), {
			currentBranch: "feature/other",
			crossesWorktree: true,
		});
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /sibling worktree/);
		assert.match(
			result.reason,
			/requires starting or reopening a session whose project root is that worktree/,
		);
	});

	it("asks before restoring files in a sibling worktree (#784)", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git restore src/x.ts" }),
			{
				currentBranch: "feature/other",
				crossesWorktree: true,
			},
		);
		assert.equal(result.decision, "ask");
		assert.match(result.reason, /sibling worktree/);
	});

	it("allows a commit on a feature branch", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit -m 'x'" }),
			{
				currentBranch: "feature/x",
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("denies a commit on main", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit -m 'x'" }),
			{ currentBranch: "main" },
		);
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /main/);
		assert.match(
			result.reason,
			/shared by processes and sessions targeting that checkout/,
		);
	});

	it("respects a configured default branch other than main", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit -m 'x'" }),
			{
				currentBranch: "trunk",
				mainBranch: "trunk",
			},
		);
		assert.equal(result.decision, "deny");
	});

	it("allows when currentBranch is unknown (detached HEAD, detection failure)", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit -m 'x'" }),
			{ currentBranch: undefined },
		);
		assert.equal(result.decision, "allow");
	});
});

describe("runMainCommitGuard", () => {
	const commit = JSON.stringify(payload({ command: "git commit -m 'x'" }));

	it("denies a commit on the default branch", () => {
		const { shouldOutput, output } = runMainCommitGuard(commit, {
			resolveBranches: () => ({ currentBranch: "main", mainBranch: "main" }),
		});
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
	});

	it("denies on a default branch that is not called main", () => {
		const { shouldOutput } = runMainCommitGuard(commit, {
			resolveBranches: () => ({ currentBranch: "trunk", mainBranch: "trunk" }),
		});
		assert.equal(shouldOutput, true);
	});

	it("allows a commit on a feature branch", () => {
		const { shouldOutput } = runMainCommitGuard(commit, {
			resolveBranches: () => ({ currentBranch: "topic", mainBranch: "main" }),
		});
		assert.equal(shouldOutput, false);
	});

	it("evaluates every guarded segment in its own effective cwd (#784)", () => {
		for (const command of [
			"git add -A && cd /worktrees/sibling && git add -A",
			"git add -A && git -C /worktrees/sibling add -A",
		]) {
			const visited = [];
			const input = JSON.stringify(
				payload({ command, cwd: "/worktrees/session" }),
			);
			const { shouldOutput, output } = runMainCommitGuard(input, {
				resolveBranches: (_payload, targetCwd) => {
					visited.push(targetCwd);
					return {
						currentBranch: "topic",
						mainBranch: "main",
						crossesWorktree: targetCwd === "/worktrees/sibling",
					};
				},
			});
			assert.deepEqual(visited, ["/worktrees/session", "/worktrees/sibling"]);
			assert.equal(shouldOutput, true);
			assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
		}
	});

	it("aggregates per-segment decisions with deny before ask (#784)", () => {
		const context = (_payload, targetCwd) => ({
			currentBranch: "topic",
			mainBranch: "main",
			crossesWorktree: targetCwd === "/worktrees/sibling",
		});
		const askInput = JSON.stringify(
			payload({
				command: "git add -A && git -C /worktrees/sibling restore tracked.txt",
				cwd: "/worktrees/session",
			}),
		);
		const asked = runMainCommitGuard(askInput, { resolveBranches: context });
		assert.equal(asked.output.hookSpecificOutput.permissionDecision, "ask");

		const denyInput = JSON.stringify(
			payload({
				command:
					"git -C /worktrees/sibling restore tracked.txt && git -C /worktrees/sibling add -A",
				cwd: "/worktrees/session",
			}),
		);
		const denied = runMainCommitGuard(denyInput, { resolveBranches: context });
		assert.equal(denied.output.hookSpecificOutput.permissionDecision, "deny");
	});

	it("asks rather than denies for a state-restoring subcommand (#777)", () => {
		const input = JSON.stringify(payload({ command: "git reset --hard" }));
		const { shouldOutput, output } = runMainCommitGuard(input, {
			resolveBranches: () => ({ currentBranch: "main", mainBranch: "main" }),
		});
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.permissionDecision, "ask");
	});

	it("never resolves branches for a command the guard does not cover", () => {
		let called = false;
		const input = JSON.stringify(payload({ command: "git status" }));
		const { shouldOutput } = runMainCommitGuard(input, {
			resolveBranches: () => {
				called = true;
				return { currentBranch: "main", mainBranch: "main" };
			},
		});
		assert.equal(shouldOutput, false);
		assert.equal(called, false);
	});

	it("silently allows malformed stdin JSON", () => {
		assert.deepEqual(
			runMainCommitGuard("not json{{{", { resolveBranches: () => ({}) }),
			{
				shouldOutput: false,
			},
		);
	});
});

describe("main-commit-guard wrapper", () => {
	const script = resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../main-commit-guard.mjs",
	);
	let root;
	let repo;
	let session;
	let sibling;

	function git(cwd, args) {
		return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
	}

	before(() => {
		root = mkdtempSync(join(tmpdir(), "main-commit-guard-"));
		repo = join(root, "repo");
		session = join(root, "session");
		sibling = join(root, "sibling");
		mkdirSync(repo);
		git(root, ["init", "-b", "main", repo]);
		git(repo, ["config", "user.email", "guard-test@example.invalid"]);
		git(repo, ["config", "user.name", "Guard Test"]);
		writeFileSync(join(repo, "tracked.txt"), "fixture\n");
		git(repo, ["add", "tracked.txt"]);
		git(repo, ["commit", "-m", "fixture"]);
		git(repo, ["remote", "add", "origin", repo]);
		git(repo, [
			"symbolic-ref",
			"refs/remotes/origin/HEAD",
			"refs/remotes/origin/main",
		]);
		git(repo, ["worktree", "add", "-b", "session", session]);
		git(repo, ["worktree", "add", "-b", "sibling", sibling]);
	});

	after(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function runWrapper(
		command,
		{ payloadCwd = session, claudeProjectDir = session } = {},
	) {
		const env = { ...process.env };
		if (claudeProjectDir === null) delete env.CLAUDE_PROJECT_DIR;
		else env.CLAUDE_PROJECT_DIR = claudeProjectDir;
		return execFileSync(process.execPath, [script], {
			encoding: "utf8",
			env,
			input: JSON.stringify(payload({ command, cwd: payloadCwd })),
		}).trim();
	}

	it("uses the payload cwd as the session worktree in Codex (#784)", () => {
		const output = runWrapper(`git -C ${sibling} add -A`, {
			claudeProjectDir: null,
		});
		assert.notEqual(output, "");
		assert.equal(
			JSON.parse(output).hookSpecificOutput.permissionDecision,
			"deny",
		);
	});

	it("keeps CLAUDE_PROJECT_DIR authoritative over the payload cwd", () => {
		const output = runWrapper(`git -C ${session} add -A`, {
			payloadCwd: sibling,
			claudeProjectDir: session,
		});
		assert.equal(output, "");
	});

	it("treats whitespace-only session roots as absent", () => {
		const fallbackToPayload = runWrapper(`git -C ${sibling} add -A`, {
			payloadCwd: session,
			claudeProjectDir: " \t ",
		});
		assert.notEqual(fallbackToPayload, "");
		assert.equal(
			JSON.parse(fallbackToPayload).hookSpecificOutput.permissionDecision,
			"deny",
		);

		const claudeStillWins = runWrapper(`git -C ${session} add -A`, {
			payloadCwd: " \n ",
			claudeProjectDir: session,
		});
		assert.equal(claudeStillWins, "");
	});

	it("denies compound and repeated-C sibling mutations end to end (#784)", () => {
		for (const command of [
			`git add -A && cd ${sibling} && git add -A`,
			`cd -- ${sibling} && git add -A`,
			`cd ${sibling} >/dev/null && git add -A`,
			`git add -A && git -C ${sibling} add -A`,
			`git -C ${session} -C ../sibling add -A`,
		]) {
			const output = runWrapper(command);
			assert.notEqual(output, "", command);
			assert.equal(
				JSON.parse(output).hookSpecificOutput.permissionDecision,
				"deny",
				command,
			);
		}
	});

	it("fails closed when cd requires shell expansion", () => {
		for (const [command, decision] of [
			[`SIBLING=${sibling}; cd "$SIBLING" && git add -A`, "deny"],
			[`SIBLING=${sibling}; cd "$SIBLING" && git restore tracked.txt`, "ask"],
		]) {
			const output = runWrapper(command);
			assert.notEqual(output, "", command);
			const result = JSON.parse(output).hookSpecificOutput;
			assert.equal(result.permissionDecision, decision, command);
			assert.match(
				result.permissionDecisionReason,
				/literal path or harness workdir/,
				command,
			);
		}
	});
});
