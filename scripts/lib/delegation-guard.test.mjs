import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateDelegationGuard, findOutwardCommand, runDelegationGuard } from "./delegation-guard.mjs";

function payload({ agentType, command, toolName = "Bash" }) {
	const p = { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: { command } };
	if (agentType) p.agent_type = agentType;
	return p;
}

describe("evaluateDelegationGuard — caller identity", () => {
	it("allows the main thread, which has no agent_type", () => {
		// The main thread is the reviewer/caller; it must keep push and PR rights.
		const result = evaluateDelegationGuard(payload({ command: "git push -u origin topic" }));
		assert.equal(result.decision, "allow");
	});

	it("denies a subagent that is not on the allowlist", () => {
		const result = evaluateDelegationGuard(payload({ agentType: "general-purpose", command: "git push -u origin topic" }));
		assert.equal(result.decision, "deny");
	});

	it("allows an allowlisted subagent whose job is to publish", () => {
		const result = evaluateDelegationGuard(payload({ agentType: "issue-worker", command: "git push -u origin topic" }));
		assert.equal(result.decision, "allow");
	});

	it("defaults to deny for an agent type nobody has allowlisted yet", () => {
		// A newly added agent must not silently inherit push rights.
		const result = evaluateDelegationGuard(payload({ agentType: "brand-new-agent", command: "git push" }));
		assert.equal(result.decision, "deny");
	});

	it("ignores tools other than Bash", () => {
		const result = evaluateDelegationGuard({
			hook_event_name: "PreToolUse",
			tool_name: "Read",
			agent_type: "general-purpose",
			tool_input: { file_path: "/tmp/x" },
		});
		assert.equal(result.decision, "allow");
	});

	it("explains in the reason that the agent should hand back to its caller", () => {
		const result = evaluateDelegationGuard(payload({ agentType: "general-purpose", command: "git push" }));
		assert.match(result.reason, /caller/i);
	});
});

describe("findOutwardCommand — git", () => {
	it("flags a bare push", () => {
		assert.equal(findOutwardCommand("git push"), "git push");
	});

	it("flags a push behind global git flags", () => {
		assert.equal(findOutwardCommand("git -C /repo push origin main"), "git push");
	});

	it("flags a push in a compound command", () => {
		assert.equal(findOutwardCommand("pnpm test && git push -u origin topic"), "git push");
	});

	it("ignores read-only git commands", () => {
		assert.equal(findOutwardCommand("git status --short"), null);
		assert.equal(findOutwardCommand("git log --oneline -5"), null);
	});

	it("does not flag the word push inside a quoted string", () => {
		// `echo "git push"` never executes a push.
		assert.equal(findOutwardCommand('echo "git push"'), null);
	});

	it("does not flag push appearing as a flag value", () => {
		assert.equal(findOutwardCommand("git log --grep push"), null);
	});
});

describe("findOutwardCommand — gh", () => {
	it("flags mutating pr subcommands", () => {
		assert.equal(findOutwardCommand("gh pr create --title x"), "gh pr create");
		assert.equal(findOutwardCommand("gh pr merge 12"), "gh pr merge");
	});

	it("flags mutating issue subcommands", () => {
		assert.equal(findOutwardCommand("gh issue close 42"), "gh issue close");
	});

	it("allows read-only gh subcommands", () => {
		assert.equal(findOutwardCommand("gh pr view 12"), null);
		assert.equal(findOutwardCommand("gh run view 99 --log"), null);
		assert.equal(findOutwardCommand("gh pr checks 12"), null);
		assert.equal(findOutwardCommand("gh auth status"), null);
	});

	it("denies a gh group with no verb rather than guessing", () => {
		assert.equal(findOutwardCommand("gh pr"), "gh pr");
	});

	it("allows gh api without an explicit method (GET by default)", () => {
		assert.equal(findOutwardCommand("gh api repos/o/r/pulls"), null);
	});

	it("flags gh api with a mutating method, however the method was spelled", () => {
		assert.equal(findOutwardCommand("gh api -X POST repos/o/r/pulls"), "gh api POST");
		assert.equal(findOutwardCommand("gh api --method DELETE repos/o/r/x"), "gh api DELETE");
		assert.equal(findOutwardCommand("gh api --method=PATCH repos/o/r/x"), "gh api PATCH");
	});

	it("allows gh api with an explicit GET", () => {
		assert.equal(findOutwardCommand("gh api -X GET repos/o/r"), null);
	});
});

describe("findOutwardCommand — unrelated commands", () => {
	it("ignores ordinary work", () => {
		assert.equal(findOutwardCommand("node --test 'scripts/lib/*.test.mjs'"), null);
		assert.equal(findOutwardCommand("git add -A && git commit -m 'feat: x'"), null);
	});
});

describe("runDelegationGuard", () => {
	it("prints a deny payload for a deny decision", () => {
		const input = JSON.stringify(payload({ agentType: "builder", command: "git push -u origin topic" }));
		const { shouldOutput, output } = runDelegationGuard(input);
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
	});

	it("produces no output for an allow decision", () => {
		const input = JSON.stringify(payload({ command: "git push -u origin topic" }));
		const { shouldOutput, output } = runDelegationGuard(input);
		assert.equal(shouldOutput, false);
		assert.equal(output, undefined);
	});

	it("silently allows malformed stdin JSON", () => {
		const { shouldOutput, output } = runDelegationGuard("not json{{{");
		assert.equal(shouldOutput, false);
		assert.equal(output, undefined);
	});
});
