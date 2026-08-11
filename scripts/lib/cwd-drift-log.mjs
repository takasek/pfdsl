// Pure logic for the cwd-drift-log PostToolUse(Bash) measurement hook. See
// scripts/cwd-drift-log.mjs for the stop condition and why this is
// measurement-only (never advisory, never blocking).

import { parseHookPayload } from "./hook-io.mjs";

/** Fields checked, in order, for response text when `tool_response` is an
 * object rather than a plain string — its shape is not documented and
 * varies by environment, so the first string field found wins. */
const RESPONSE_TEXT_FIELDS = ["stdout", "output"];

/** How much of the response head to keep. Just enough to read a `pwd`
 * output, not so much a large command's output floods the log. */
const RESPONSE_HEAD_LIMIT = 200;

/** Collapse tabs and newlines in `text` to a single space and trim the
 * result, so appending it as one of this log's tab-separated columns cannot
 * turn one record into several lines or extra columns, and a real `pwd`
 * output's trailing newline does not show up as a trailing space. */
function collapseWhitespace(text) {
	return text.replace(/[\t\r\n]+/g, " ").trim();
}

/**
 * The response text to log for `toolResponse`, or `""` when its shape does
 * not carry recognisable text. `tool_response`'s shape is undocumented and
 * environment-dependent, so this never throws on an unexpected shape (a
 * number, an array, `undefined`) — it just falls back to `""`, consistent
 * with this hook's "measurement must never block a Bash call" rule.
 * @param {unknown} toolResponse
 * @returns {string}
 */
function responseText(toolResponse) {
	if (typeof toolResponse === "string") return toolResponse;
	if (toolResponse && typeof toolResponse === "object") {
		for (const field of RESPONSE_TEXT_FIELDS) {
			const value = /** @type {Record<string, unknown>} */ (toolResponse)[
				field
			];
			if (typeof value === "string") return value;
		}
	}
	return "";
}

/**
 * Build one tab-separated log line for a PostToolUse(Bash) invocation:
 * ISO timestamp, `payload.cwd`, the hook process's own cwd, whether the two
 * matched, the command string, and the head of its response. Always
 * produces a 6-column line, even for malformed JSON or a payload missing any
 * of these fields — those cases surface as empty columns, which is itself
 * data about how often the payload fails to carry them.
 *
 * The trailing two columns exist because `payload.cwd` and `process.cwd()`
 * likely share the same harness-reported origin: if so, comparing them only
 * ever confirms that the harness agrees with itself, not whether the
 * harness's reported cwd matches where the shell actually ran. The command
 * and response columns let a reader compare `payload.cwd` against the
 * output of a command that queries the shell directly (e.g. one starting
 * with `pwd`, the form work-cycle.md already recommends) to answer that
 * question instead.
 * @param {string} inputText raw stdin payload
 * @param {{processCwd: string, now: () => string}} io `processCwd` is the
 *   hook process's `process.cwd()`; `now` is injected so tests do not depend
 *   on the wall clock.
 * @returns {string}
 */
export function buildDriftLogLine(inputText, { processCwd, now }) {
	const payload = parseHookPayload(inputText);
	const payloadCwd = typeof payload?.cwd === "string" ? payload.cwd : "";
	const matched = payloadCwd === processCwd;
	const command =
		typeof payload?.tool_input?.command === "string"
			? payload.tool_input.command
			: "";
	const response = collapseWhitespace(
		responseText(payload?.tool_response),
	).slice(0, RESPONSE_HEAD_LIMIT);
	return [
		now(),
		payloadCwd,
		processCwd,
		String(matched),
		collapseWhitespace(command),
		response,
	].join("\t");
}
