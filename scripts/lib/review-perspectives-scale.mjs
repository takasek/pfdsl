/**
 * Pure functions backing check-review-perspectives-scale.mjs (#797): counts
 * each review-perspectives.md-style catalog's byte size and item count, and
 * reports whether it has grown to a size worth reviewing for a split.
 *
 * This is a notice, not a gate — exceeding the threshold is not a defect the
 * catalog can be "fixed" to clear, so evaluateCatalogScale always exits 0.
 * File I/O and the two target paths live in the CLI wrapper; this module
 * stays pure and testable.
 */

// Issue #797's own numbers, and the primary source for them (#878): every
// other statement of these values — the notice text, the CLI wrapper's
// docstring, .pfdsl/bindings/pfd-retro.md — points here or derives from here
// rather than restating a literal. No FS/CLI script measures them against a
// second data point yet; see .pfdsl/bindings/pfd-retro.md for the two
// conditions this repo chose to leave to human judgment instead of mechanizing.
export const BYTE_THRESHOLD = 20 * 1024;
export const ITEM_THRESHOLD = 40;

/**
 * The thresholds as the notice states them, derived so that changing either
 * constant cannot leave the printed phrase behind (#878).
 */
export const THRESHOLD_SUMMARY = `${BYTE_THRESHOLD / 1024}KB or ${ITEM_THRESHOLD} items`;

/**
 * Counts top-level `- **name**: ...` bullet items — the catalog's per-entry
 * unit. Indented continuation lines under a bullet (e.g. `具体例:` detail)
 * are not a new item, so the match anchors at line start with no leading
 * whitespace.
 * @param {string} content
 * @returns {number}
 */
export function countCatalogItems(content) {
	const matches = content.match(/^- \*\*/gm);
	return matches ? matches.length : 0;
}

/**
 * @param {{path: string, content: string}} file
 * @returns {{path: string, bytes: number, items: number}}
 */
export function measureCatalogScale({ path, content }) {
	return {
		path,
		bytes: Buffer.byteLength(content, "utf8"),
		items: countCatalogItems(content),
	};
}

/**
 * @param {{bytes: number, items: number}} measurement
 * @returns {boolean}
 */
export function exceedsSplitThreshold({ bytes, items }) {
	return bytes > BYTE_THRESHOLD || items > ITEM_THRESHOLD;
}

/**
 * Builds the report: one line per file, always printed (so the numbers are
 * visible even under threshold — the next reader shouldn't have to remeasure
 * them), plus a split-timing notice appended to any line whose file exceeds
 * the threshold. exitCode is always 0 (#797: never a CI-red gate).
 * @param {{path: string, bytes: number, items: number}[]} measurements
 * @returns {{exitCode: 0, stdoutLines: string[], stderrLines: []}}
 */
export function evaluateCatalogScale(measurements) {
	const stdoutLines = measurements.map((m) => {
		const base = `${m.path}: ${m.bytes} bytes, ${m.items} items`;
		return exceedsSplitThreshold(m)
			? `${base} — split threshold reached (${THRESHOLD_SUMMARY}); consider splitting`
			: base;
	});
	return { exitCode: 0, stdoutLines, stderrLines: [] };
}
