import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runMainCommitGuard } from "./main-commit-guard.mjs";
import { runVerificationTreeGuard } from "./verification-tree-guard.mjs";

const payload = (command) =>
	JSON.stringify({
		tool_name: "Bash",
		cwd: "/repo/main",
		tool_input: { command },
	});
const decision = (result) =>
	result.output?.hookSpecificOutput?.permissionDecision ?? "allow";
const main = (command, options = {}) =>
	runMainCommitGuard(payload(command), {
		supportsAsk: false,
		payloadCwdIsExecutionCwd: false,
		resolveBranches: (_payload, cwd) => ({
			currentBranch: cwd === "/repo/main" ? "main" : "feature",
			mainBranch: "main",
			targetRelation: "sibling",
		}),
		...options,
	});
const verify = (command, options = {}) =>
	runVerificationTreeGuard(payload(command), {
		supportsAsk: false,
		payloadCwdIsExecutionCwd: false,
		resolveRoots: () => ({
			worktreeRoot: "/repo/main",
			mainRoot: "/repo/main",
			hasLinkedWorktrees: true,
		}),
		...options,
	});

describe("worktree operation contract", () => {
	it("allows an explicit feature target while protecting main and hook bypasses", () => {
		assert.equal(decision(main("git -C /repo/feature add -A")), "allow");
		assert.equal(decision(main("git -C /repo/main add -A")), "deny");
		assert.equal(
			decision(main("git -C /repo/feature commit --no-verify")),
			"deny",
		);
	});
	it("does not use a Codex session cwd as the shell execution cwd", () => {
		assert.equal(
			decision(
				main("git add -A", {
					resolveBranches: () => ({ currentBranch: "feature" }),
				}),
			),
			"deny",
		);
		assert.equal(
			decision(verify("node /repo/feature/scripts/check.mjs")),
			"deny",
		);
	});
	it("keeps cwd capability independent from permission capability", () => {
		assert.equal(
			decision(
				main("git add -A", {
					payloadCwdIsExecutionCwd: true,
					resolveBranches: () => ({ currentBranch: "feature" }),
				}),
			),
			"allow",
		);
		assert.equal(
			decision(
				main("git add -A", {
					supportsAsk: true,
					resolveBranches: () => ({ currentBranch: "feature" }),
				}),
			),
			"deny",
		);
	});
	it("accepts the ordinary explicit verification forms", () => {
		for (const command of [
			"cd /repo/feature && make test",
			"make -C /repo/feature test",
			"cd /repo/feature && node scripts/check.mjs",
		])
			assert.equal(decision(verify(command)), "allow", command);
		for (const command of ["node --version", "make --help", "pnpm --version"])
			assert.equal(decision(verify(command)), "allow", command);
	});
	it("requires state setup and clearing to be separate from protected operations", () => {
		for (const setup of [
			"readonly GIT_DIR=/override; unset GIT_DIR",
			"set -a; GIT_CONFIG_COUNT=1 :",
			"set -o posix; GIT_CONFIG_COUNT=1 :",
			"GIT_DIR=/override :",
			"source setup.sh; unset GIT_DIR",
			"GIT_CONFIG_COUNT=0",
		])
			assert.equal(
				decision(main(`${setup}; git -C /repo/feature add -A`)),
				"deny",
				setup,
			);
		assert.equal(
			decision(
				main("git -C /repo/feature add -A", { ambientGitTargetOverride: true }),
			),
			"deny",
		);
	});
	it("checks branches again after branch or repository changes", () => {
		for (const setup of [
			"git -C /repo/feature switch main",
			"git -C /repo/feature branch -m main",
			"git -C /repo/feature symbolic-ref HEAD refs/heads/main",
		])
			assert.equal(
				decision(main(`${setup} && git -C /repo/feature add -A`)),
				"deny",
				setup,
			);
	});
	it("separates branch changes from later verification", () => {
		for (const setup of [
			"git -C /repo/feature switch main",
			"git -C /repo/feature branch -m main",
			"git -C /repo/feature symbolic-ref HEAD refs/heads/main",
		])
			assert.equal(
				decision(verify(`${setup} && make -C /repo/feature test`)),
				"deny",
				setup,
			);
		assert.equal(
			decision(
				verify(
					"git -C /repo/feature branch --show-current && make -C /repo/feature test",
				),
			),
			"allow",
		);
	});
	it("does not conflate logical shell cd with physical Git chdir", () => {
		for (const command of [
			"cd /repo/main/alias/.. && git add -A",
			"cd /repo/main/alias/.. && make test",
		]) {
			assert.equal(
				decision(main(command)),
				command.includes("git add") ? "deny" : "allow",
				command,
			);
			assert.equal(
				decision(verify(command)),
				command.includes("make test") ? "deny" : "allow",
				command,
			);
		}
	});
	it("does not accept shell dispatch changes before a protected operation", () => {
		for (const setup of [
			"shopt -s expand_aliases\nalias cd='printf empty'",
			"trap 'cd /repo/main' DEBUG",
		])
			assert.equal(
				decision(
					main(`${setup}\ncd /repo/feature && git add -A`, {
						payloadCwdIsExecutionCwd: true,
					}),
				),
				"deny",
				setup,
			);
	});
	it("preserves PR 1335 literal heredoc handling and real commands after it", () => {
		assert.equal(
			decision(
				main(
					"cat <<'END'\nset -a\ngit -C /repo/main add -A\nEND\ngit -C /repo/feature add -A",
				),
			),
			"allow",
		);
		assert.equal(
			decision(main("cat <<'END'\nliteral\nEND\ngit -C /repo/main add -A")),
			"deny",
		);
	});
});
