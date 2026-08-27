// Shared plumbing for this repo's PreToolUse/PostToolUse guard hooks (the
// scripts/*-guard.mjs and reminder wrappers wired in .claude/settings.json,
// #650 review). Every one of them reads a JSON payload from stdin and emits
// one of two hookSpecificOutput shapes — both used to be copy-pasted into
// each wrapper.

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
 * "ask" exists because an advisory cannot stand in for a decision when the harm
 * is the execution itself. What rules that out is an ordering, not a missing
 * channel. By the time a PreToolUse hook runs, the call's content is already
 * fixed — the model settled it before the hook was invoked — and no model
 * inference happens between the hook returning and the tool executing. So
 * anything that only adds context reaches the model no earlier than the call it
 * was meant to reshape, and only a decision that stops the execution puts an
 * inference boundary before the first successful write. That ordering holds
 * whatever fields the event turns out to carry. Do not rewrite this as which
 * events accept which field, or under which decision the field is dropped: that
 * enumeration has already been false more than once, and the form is the defect
 * rather than the contents (#929). It was measured in #974 — the runs and the
 * transcript evidence live in that issue's comments, not here.
 *
 * So a PreToolUse rule that should not hard-block (command-usage-guard's npx
 * case, roadmap-publish-guard) routes through the permission prompt.
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

/**
 * Build the PostToolUse hook response for an advisory. additionalContext is
 * what reaches the model. The advisory hooks are PostToolUse because an
 * advisory by definition does not block, so it cannot act on the call itself;
 * all it can do is speak about the subject the call produced — a written file,
 * a created issue, a command's output — and that subject does not exist until
 * the tool has run. Do not restate this as a list of which events accept the
 * field or under which decision they drop it: that list is the host's to
 * change, and rewriting it each time it turns out false books the next false
 * version (#929).
 * @param {string} advisory
 */
export function buildAdvisoryOutput(advisory) {
	return {
		hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext: advisory,
		},
	};
}
