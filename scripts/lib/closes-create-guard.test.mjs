import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	evaluateClosesCreateGuard,
	runClosesCreateGuard,
} from "./closes-create-guard.mjs";

function payload({ toolName = "Bash", command }) {
	return {
		hook_event_name: "PreToolUse",
		tool_name: toolName,
		tool_input: { command },
	};
}

const defaultBranch = "main";
const deps = {
	getDefaultBranch: () => defaultBranch,
	readFile: () => undefined,
};

describe("evaluateClosesCreateGuard", () => {
	it("asks when a main-bound PR body has no Closes keyword and no exemption", () => {
		const result = evaluateClosesCreateGuard(
			payload({
				command: 'gh pr create --base main --title x --body "no closes here"',
			}),
			deps,
		);
		assert.equal(result.decision, "ask");
		assert.match(result.reason, /no-issue/);
	});

	it("allows a body that includes a Closes keyword", () => {
		const result = evaluateClosesCreateGuard(
			payload({
				command: 'gh pr create --base main --title x --body "Closes #123"',
			}),
			deps,
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a body carrying the no-issue: exemption", () => {
		const result = evaluateClosesCreateGuard(
			payload({
				command:
					'gh pr create --base main --title x --body "no-issue: retro bookkeeping only"',
			}),
			deps,
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a body carrying the hotfix: exemption", () => {
		const result = evaluateClosesCreateGuard(
			payload({
				command:
					'gh pr create --base main --title x --body "hotfix: restore x"',
			}),
			deps,
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a PR whose base is not the default branch", () => {
		const result = evaluateClosesCreateGuard(
			payload({
				command:
					'gh pr create --base feat/parent --title x --body "no closes here"',
			}),
			deps,
		);
		assert.equal(result.decision, "allow");
	});

	it("allows commands that are not gh pr create", () => {
		const result = evaluateClosesCreateGuard(
			payload({ command: "gh pr edit 123 --body 'no closes here'" }),
			deps,
		);
		assert.equal(result.decision, "allow");
	});

	it("allows --web, which leaves no body to inspect", () => {
		const result = evaluateClosesCreateGuard(
			payload({ command: "gh pr create --base main --web" }),
			deps,
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a call with no body given at all", () => {
		const result = evaluateClosesCreateGuard(
			payload({ command: "gh pr create --base main --title x" }),
			deps,
		);
		assert.equal(result.decision, "allow");
	});

	it("reads the body from --body-file via the injected readFile", () => {
		const result = evaluateClosesCreateGuard(
			payload({
				command: "gh pr create --base main --title x --body-file /tmp/body.md",
			}),
			{
				getDefaultBranch: () => defaultBranch,
				readFile: (path) =>
					path === "/tmp/body.md" ? "no closes here" : undefined,
			},
		);
		assert.equal(result.decision, "ask");
	});

	it("allows when --body-file cannot be read", () => {
		const result = evaluateClosesCreateGuard(
			payload({
				command: "gh pr create --base main --title x --body-file /tmp/body.md",
			}),
			{
				getDefaultBranch: () => defaultBranch,
				readFile: () => {
					throw new Error("ENOENT");
				},
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("detects a Closes keyword inside a heredoc-quoted body", () => {
		const command = [
			"gh pr create --base main --title x --body \"$(cat <<'EOF'",
			"Summary of the change.",
			"",
			"Closes #476",
			"EOF",
			')"',
		].join("\n");
		const result = evaluateClosesCreateGuard(payload({ command }), deps);
		assert.equal(result.decision, "allow");
	});

	it("asks on a heredoc-quoted body with no keyword or exemption", () => {
		const command = [
			"gh pr create --base main --title x --body \"$(cat <<'EOF'",
			"Just a summary, nothing else.",
			"EOF",
			')"',
		].join("\n");
		const result = evaluateClosesCreateGuard(payload({ command }), deps);
		assert.equal(result.decision, "ask");
	});

	// This guard runs on every Bash call, so resolving the default branch —
	// which costs a git process — must wait until a `gh pr create` that needs
	// judging has actually been found.
	it("does not resolve the default branch for a command it never judges", () => {
		let calls = 0;
		const result = evaluateClosesCreateGuard(payload({ command: "ls -la" }), {
			getDefaultBranch: () => {
				calls++;
				return defaultBranch;
			},
			readFile: () => undefined,
		});
		assert.equal(result.decision, "allow");
		assert.equal(calls, 0);
	});

	it("ignores tools other than Bash", () => {
		const result = evaluateClosesCreateGuard(
			{
				hook_event_name: "PreToolUse",
				tool_name: "Read",
				tool_input: { file_path: "/tmp/x" },
			},
			deps,
		);
		assert.equal(result.decision, "allow");
	});
});

describe("runClosesCreateGuard", () => {
	it("emits a permission output for the ask case", () => {
		const { shouldOutput, output } = runClosesCreateGuard(
			JSON.stringify(
				payload({
					command: 'gh pr create --base main --title x --body "no closes here"',
				}),
			),
			deps,
		);
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.permissionDecision, "ask");
	});

	it("emits nothing when the command passes through", () => {
		const { shouldOutput } = runClosesCreateGuard(
			JSON.stringify(
				payload({ command: 'gh pr create --base main --body "Closes #1"' }),
			),
			deps,
		);
		assert.equal(shouldOutput, false);
	});

	it("emits nothing on malformed stdin", () => {
		const { shouldOutput } = runClosesCreateGuard("not json", deps);
		assert.equal(shouldOutput, false);
	});
});
