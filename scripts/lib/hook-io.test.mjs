import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildDenyOutput, parseHookPayload } from "./hook-io.mjs";

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

describe("buildDenyOutput", () => {
	it("builds a PreToolUse deny response carrying the reason", () => {
		const output = buildDenyOutput({ reason: "blocked for testing" });
		assert.deepEqual(output, {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: "blocked for testing",
			},
		});
	});
});
