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
 * Build the PreToolUse hook response for a deny decision.
 * @param {{reason: string}} result
 */
export function buildDenyOutput(result) {
	return {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: result.reason,
		},
	};
}
