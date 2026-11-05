import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	buildAdvisoryOutput,
	buildPermissionOutput,
	parseHookPayload,
} from "./hook-io.mjs";

describe("parseHookPayload", () => {
	it("parses a valid JSON payload", () => {
		const result = parseHookPayload('{"tool_name":"Bash"}');
		assert.deepEqual(result, { tool_name: "Bash" });
	});

	it("returns null for invalid JSON, so callers can exit 0 quietly", () => {
		assert.equal(parseHookPayload("not json"), null);
		assert.equal(parseHookPayload(""), null);
	});
});

describe("buildPermissionOutput", () => {
	it("builds a PreToolUse deny response carrying the reason", () => {
		const output = buildPermissionOutput({
			decision: "deny",
			reason: "blocked for testing",
		});
		assert.deepEqual(output, {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: "blocked for testing",
			},
		});
	});

	it("builds an ask response, for guards that hand the call to the human", () => {
		const output = buildPermissionOutput({
			decision: "ask",
			reason: "confirm first",
		});
		assert.deepEqual(output, {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "ask",
				permissionDecisionReason: "confirm first",
			},
		});
	});
});

describe("buildAdvisoryOutput", () => {
	it("builds a PostToolUse response carrying the advisory as additionalContext", () => {
		assert.deepEqual(buildAdvisoryOutput("note: something to fix"), {
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext: "note: something to fix",
			},
		});
	});
});
