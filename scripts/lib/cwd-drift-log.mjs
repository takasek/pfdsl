// Pure logic for the cwd-drift-log PostToolUse(Bash) measurement hook. See
// scripts/cwd-drift-log.mjs for the stop condition and why this is
// measurement-only (never advisory, never blocking).

import { parseHookPayload } from "./hook-io.mjs";

/**
 * Build one tab-separated log line for a PostToolUse(Bash) invocation:
 * ISO timestamp, `payload.cwd`, the hook process's own cwd, and whether the
 * two matched. Always produces a 4-column line, even for malformed JSON or a
 * payload with no `cwd` field — those cases surface as an empty second
 * column (and thus `false`), which is itself data about how often the
 * payload fails to carry a cwd at all.
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
	return [now(), payloadCwd, processCwd, String(matched)].join("\t");
}
