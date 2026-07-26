/**
 * Pure functions for the /code-review value measurement (#561).
 *
 * Records live in commit trailers rather than in a companion file or an
 * issue thread: a per-cycle append log in a file conflicts across parallel
 * worktrees (the reason ADR-0026 removed the retro execution record), and a
 * PR body does not exist yet when the terminal gate runs.
 *
 * Trailer form (one per cycle, in any commit of the range):
 *   Review-Measurement: sample=in new=2 adopted=1 angles="branch coverage; error paths"
 *   Review-Measurement: sample=out
 *
 * Process/git I/O lives in the main script; this module stays testable.
 */

/** Number of in-sample cycles to collect before deciding the skip condition. */
export const TARGET_SAMPLE_COUNT = 10;

/** Separators used by the caller's `git log --format` invocation. */
export const FIELD_SEP = "";
export const RECORD_SEP = "";

const TRAILER = /^Review-Measurement:\s*(.+)$/m;
const PAIR = /(\w+)=(?:"([^"]*)"|(\S+))/g;

/**
 * Parse a single trailer line into a record.
 * A malformed record carries `error` instead of throwing — the aggregate view
 * reports it separately so it cannot be mistaken for a zero-finding cycle.
 * @param {string} line
 * @returns {{sample?: string, new?: number, adopted?: number, angles?: string, error?: string}|null}
 */
export function parseMeasurementTrailer(line) {
	const match = TRAILER.exec(line);
	if (!match) return null;

	/** @type {Record<string, string>} */
	const fields = {};
	for (const [, key, quoted, bare] of match[1].matchAll(PAIR)) {
		fields[key] = quoted ?? bare;
	}

	const record = { sample: fields.sample, angles: fields.angles };

	if (record.sample !== "in" && record.sample !== "out") {
		return { ...record, error: `sample must be "in" or "out", got ${JSON.stringify(fields.sample ?? null)}` };
	}
	if (record.sample === "out") return record;

	for (const key of ["new", "adopted"]) {
		if (!/^\d+$/.test(fields[key] ?? "")) {
			return { ...record, error: `${key} must be a non-negative integer on an in-sample record` };
		}
		record[key] = Number(fields[key]);
	}
	if (record.adopted > record.new) {
		return { ...record, error: "adopted cannot exceed new" };
	}
	return record;
}

/**
 * Extract one record per commit from a `git log` dump.
 * @param {string} logText - records separated by RECORD_SEP, `<sha>FIELD_SEP<body>` within each
 * @returns {Array<{sha: string}>}
 */
export function extractMeasurements(logText) {
	return logText
		.split(RECORD_SEP)
		.map((entry) => {
			const [sha, body = ""] = entry.split(FIELD_SEP);
			const record = parseMeasurementTrailer(body);
			return record ? { sha: sha.trim(), ...record } : null;
		})
		.filter(Boolean);
}

/**
 * @param {Array<{sample?: string, new?: number, adopted?: number, error?: string}>} records
 */
export function summarize(records) {
	const malformed = records.filter((r) => r.error);
	const sampled = records.filter((r) => r.sample === "in" && !r.error);
	const outOfSample = records.filter((r) => r.sample === "out" && !r.error).length;
	const cyclesWithFindings = sampled.filter((r) => r.new > 0).length;

	return {
		sampled: sampled.length,
		outOfSample,
		malformed: malformed.length,
		cyclesWithFindings,
		totalNew: sampled.reduce((sum, r) => sum + r.new, 0),
		totalAdopted: sampled.reduce((sum, r) => sum + r.adopted, 0),
		// Null rather than 0 or NaN: "no data yet" and "measured zero" are different answers.
		findingRate: sampled.length === 0 ? null : cyclesWithFindings / sampled.length,
		remaining: Math.max(0, TARGET_SAMPLE_COUNT - sampled.length),
	};
}
