// Asks for `make release-status` before a new publish process is declared in
// roadmap.pfdsl (#650 candidate I). Registering the next version without
// checking what is already published writes the drift that release-status
// exists to show: an already-released version entered as the upcoming one, with
// every artifact hanging off it now describing the past.
//
// Ask, not deny: whether release-status was consulted is not visible in the
// payload, so a deny would block the retry too and there would be no way
// through. The prompt puts the question where it can still be answered.
//
// Only declarations count — `publish_ext_v0016:` opening a process block, not
// the flow lines that reference an existing publish process. Adding an
// implementation artifact to an existing publish process's inputs is the
// routine case and says nothing about release state.

/** A process declaration whose name marks it as a publish step. */
const PUBLISH_DECLARATION = /^\s*(publish_[a-z0-9_]+):/gm;

/** @param {string} text @returns {string[]} */
function declaredPublishProcesses(text) {
	if (typeof text !== "string") return [];
	return [...text.matchAll(PUBLISH_DECLARATION)].map((match) => match[1]);
}

/**
 * The publish processes `after` declares that `before` did not — for an Edit,
 * the text being inserted against the text being replaced, so reformatting an
 * existing declaration does not read as a new one.
 * @param {string} after
 * @param {string} before
 * @returns {string[]}
 */
export function addedPublishProcesses(after, before) {
	const existing = new Set(declaredPublishProcesses(before));
	return declaredPublishProcesses(after).filter((name) => !existing.has(name));
}

/**
 * Decide whether a PreToolUse Edit/Write may proceed.
 * @param {object} payload PreToolUse hook payload
 * @returns {{decision: "allow"} | {decision: "ask", reason: string}}
 */
export function evaluateRoadmapPublishGuard(payload) {
	if (payload?.tool_name !== "Edit" && payload?.tool_name !== "Write") return { decision: "allow" };

	const filePath = payload?.tool_input?.file_path;
	if (typeof filePath !== "string" || !filePath.endsWith("roadmap.pfdsl")) return { decision: "allow" };

	const input = payload.tool_input;
	const added =
		payload.tool_name === "Write"
			? addedPublishProcesses(input.content, "")
			: addedPublishProcesses(input.new_string, input.old_string);
	if (added.length === 0) return { decision: "allow" };

	return {
		decision: "ask",
		reason:
			`This adds the publish process ${added.join(", ")} to the roadmap. ` +
			"Run 'make release-status' first and check what is already published — registering a released version as the " +
			"upcoming one makes every artifact under it describe the past. Approve once the released version is confirmed.",
	};
}
