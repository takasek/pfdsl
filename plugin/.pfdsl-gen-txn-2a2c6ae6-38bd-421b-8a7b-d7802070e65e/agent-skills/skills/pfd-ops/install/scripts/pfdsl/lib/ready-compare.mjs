/**
 * Pure logic for the sweep's before/after `status ready --json` comparison
 * (issue #1125 defect 5). sweep-completed-chains.mjs compares the two
 * snapshots to make sure the sweep it is about to apply changes nothing
 * about readiness itself — only whichever ids got swept.
 *
 * A byte-for-byte comparison of the raw JSON almost does that, except for
 * one field: `empty.complete` (only present when the ready set is empty,
 * see runReady's classifyEmptyReady in packages/cli/src/index.ts) counts
 * processes whose inputs are all done and whose outputs are all done too —
 * exactly the completed-chain processes a sweep exists to remove. Comparing
 * it byte-for-byte makes the check fail on every sweep that actually does
 * anything, which is every sweep with something to sweep (#1125 defect 5).
 *
 * Every other field keeps mattering. In particular `ready[].inputs` (and
 * `.outputs`) must stay compared: a mutation that leaves the ready id set
 * unchanged but silently drops one of a process's declared inputs would
 * still read as "ready" before and after, and only a field-level compare
 * catches it. `empty.blocked` is also a count, but not one a sweep is
 * expected to change (a blocked process's inputs are untouched by sweeping
 * a completed chain elsewhere), so it stays compared like everything else.
 */

/**
 * @param {unknown} payload parsed `status ready --json` output
 * @returns {unknown} the same payload with `empty.complete` omitted, or the
 *   payload unchanged when it carries no `empty` (ready set was non-empty)
 */
export function readyComparable(payload) {
	if (
		payload === null ||
		typeof payload !== "object" ||
		!("empty" in payload) ||
		payload.empty === null ||
		typeof payload.empty !== "object"
	) {
		return payload;
	}
	const { complete: _complete, ...restEmpty } = payload.empty;
	return { ...payload, empty: restEmpty };
}

/**
 * @param {string} beforeStdout raw `status ready --json` stdout, pre-sweep
 * @param {string} afterStdout raw `status ready --json` stdout, post-sweep
 * @returns {boolean} whether the two are equal once `empty.complete` (if
 *   present on either side) is excluded from the comparison
 */
export function readyUnchanged(beforeStdout, afterStdout) {
	const before = readyComparable(JSON.parse(beforeStdout));
	const after = readyComparable(JSON.parse(afterStdout));
	return JSON.stringify(before) === JSON.stringify(after);
}
