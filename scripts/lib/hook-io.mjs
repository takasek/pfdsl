// Shared plumbing for this repo's PreToolUse/PostToolUse guard hooks
// (delegation-guard, worktree-write-guard, main-commit-guard, md-write-check,
// #650 review). Every one of them reads a JSON payload from stdin and, for
// the PreToolUse deny cases, emits the same hookSpecificOutput shape — this
// used to be copy-pasted into each wrapper.

/**
 * Read all of stdin as text. Not unit-tested here (it is I/O, not logic);
 * callers hand its result to parseHookPayload, which is.
 * @returns {Promise<string>}
 */
export async function readStdinText() {
	let input = "";
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) {
		input += chunk;
	}
	return input;
}

/**
 * Parse a hook payload, or null when it is not valid JSON — callers exit 0
 * quietly rather than crash on a malformed payload.
 * @param {string} text
 * @returns {object | null}
 */
export function parseHookPayload(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Build the PreToolUse hook response for a permission decision.
 *
 * "ask" exists because a PreToolUse hook has no advisory channel that reaches
 * the model: `hookSpecificOutput.additionalContext` is PostToolUse-only, and
 * stderr on exit 0 is not fed back. So a PreToolUse rule that should not hard-
 * block (command-usage-guard's npx case, roadmap-publish-guard) routes through
 * the permission prompt instead of printing a note nobody reads.
 * @param {{decision: "deny" | "ask", reason: string}} result
 */
export function buildPermissionOutput(result) {
	return {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: result.decision,
			permissionDecisionReason: result.reason,
		},
	};
}
