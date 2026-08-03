import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	evaluateCommandUsageGuard,
	runCommandUsageGuard,
	usesBodyDroppingView,
	usesPublishedCli,
} from "./command-usage-guard.mjs";

function payload({ toolName = "Bash", command }) {
	return { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: { command } };
}

describe("usesPublishedCli", () => {
	it("flags npx against the published CLI", () => {
		assert.equal(usesPublishedCli("npx @pfdsl/cli check .pfdsl/roadmap.pfdsl"), true);
	});

	it("flags a pinned or @latest version spec", () => {
		assert.equal(usesPublishedCli("npx @pfdsl/cli@latest help"), true);
		assert.equal(usesPublishedCli("npx @pfdsl/cli@0.0.24 check x.pfdsl"), true);
	});

	it("flags it behind npx flags, in a compound command, and via pnpm dlx", () => {
		assert.equal(usesPublishedCli("npx --yes @pfdsl/cli check x.pfdsl"), true);
		assert.equal(usesPublishedCli("pnpm -r build && npx @pfdsl/cli check x.pfdsl"), true);
		assert.equal(usesPublishedCli("pnpm dlx @pfdsl/cli check x.pfdsl"), true);
	});

	it("ignores the local build, which is what this repo should be running", () => {
		assert.equal(usesPublishedCli("node packages/cli/dist/cli.js check x.pfdsl"), false);
	});

	it("ignores npx against some other package, and installs of the CLI", () => {
		assert.equal(usesPublishedCli("npx tsx script.ts"), false);
		assert.equal(usesPublishedCli("npm install -g @pfdsl/cli@latest"), false);
	});

	it("does not flag the invocation inside a quoted string", () => {
		assert.equal(usesPublishedCli('rg "npx @pfdsl/cli" docs'), false);
		assert.equal(usesPublishedCli('echo "npx @pfdsl/cli check"'), false);
	});

	it("flags a quoted package argument — the quotes do not change what npx runs", () => {
		assert.equal(usesPublishedCli('npx "@pfdsl/cli" check x.pfdsl'), true);
	});

	it("ignores a non-string command", () => {
		assert.equal(usesPublishedCli(undefined), false);
	});
});

describe("usesBodyDroppingView", () => {
	it("flags gh issue view --comments, which prints no body", () => {
		assert.equal(usesBodyDroppingView("gh issue view 650 --comments"), true);
	});

	it("flags the same trap on gh pr view", () => {
		assert.equal(usesBodyDroppingView("gh pr view 664 --comments"), true);
	});

	it("allows it once --json asks for the body explicitly", () => {
		assert.equal(usesBodyDroppingView("gh issue view 650 --json body,comments"), false);
		assert.equal(usesBodyDroppingView("gh issue view 650 --comments --json comments"), false);
	});

	it("allows a view that never asked for comments", () => {
		assert.equal(usesBodyDroppingView("gh issue view 650"), false);
	});

	it("ignores other gh groups and verbs", () => {
		assert.equal(usesBodyDroppingView("gh issue list --label flow:managed"), false);
		assert.equal(usesBodyDroppingView("gh run view 123 --log"), false);
	});

	it("does not flag the flag inside a quoted string", () => {
		assert.equal(usesBodyDroppingView('echo "gh issue view 650 --comments"'), false);
	});

	it("flags it behind a gh global flag, where the group is not the second token", () => {
		assert.equal(usesBodyDroppingView("gh -R owner/repo issue view 650 --comments"), true);
		assert.equal(usesBodyDroppingView("gh --repo owner/repo pr view 664 --comments"), true);
	});

	it("flags a quoted --comments", () => {
		assert.equal(usesBodyDroppingView('gh issue view 650 "--comments"'), true);
	});

	it("ignores a non-string command", () => {
		assert.equal(usesBodyDroppingView(undefined), false);
	});
});

describe("evaluateCommandUsageGuard", () => {
	it("ignores tools other than Bash", () => {
		const result = evaluateCommandUsageGuard({
			hook_event_name: "PreToolUse",
			tool_name: "Read",
			tool_input: { file_path: "/tmp/x" },
		});
		assert.equal(result.decision, "allow");
	});

	it("allows an ordinary command", () => {
		assert.equal(evaluateCommandUsageGuard(payload({ command: "git status" })).decision, "allow");
	});

	it("asks before running the published CLI, naming the local build", () => {
		const result = evaluateCommandUsageGuard(payload({ command: "npx @pfdsl/cli check x.pfdsl" }));
		assert.equal(result.decision, "ask");
		assert.match(result.reason, /packages\/cli\/dist\/cli\.js/);
	});

	it("denies a body-dropping view, naming the flag that keeps the body", () => {
		const result = evaluateCommandUsageGuard(payload({ command: "gh issue view 650 --comments" }));
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /--json body,comments/);
	});

	it("reports the deny when a command trips both rules", () => {
		const result = evaluateCommandUsageGuard(
			payload({ command: "gh issue view 650 --comments && npx @pfdsl/cli check x.pfdsl" }),
		);
		assert.equal(result.decision, "deny");
	});
});

describe("runCommandUsageGuard", () => {
	it("prints an ask payload for the published-CLI case", () => {
		const input = JSON.stringify(payload({ command: "npx @pfdsl/cli check x.pfdsl" }));
		const { shouldOutput, output } = runCommandUsageGuard(input);
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.permissionDecision, "ask");
	});

	it("prints a deny payload for the body-dropping view", () => {
		const input = JSON.stringify(payload({ command: "gh issue view 650 --comments" }));
		const { shouldOutput, output } = runCommandUsageGuard(input);
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
	});

	it("produces no output for an ordinary command", () => {
		const { shouldOutput, output } = runCommandUsageGuard(JSON.stringify(payload({ command: "git status" })));
		assert.equal(shouldOutput, false);
		assert.equal(output, undefined);
	});

	it("silently allows malformed stdin JSON", () => {
		assert.deepEqual(runCommandUsageGuard("not json{{{"), { shouldOutput: false });
	});
});
