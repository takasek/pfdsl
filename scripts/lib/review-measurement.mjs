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

/** Substring for `git log --grep`, so git filters instead of us reading all of history. */
export const TRAILER_GREP = "Review-Measurement:";

/**
 * Paths whose change makes a cycle in-sample. Kept beside the parser so the
 * predicate has one anchor in code; the prose statement of the same rule lives
 * in the terminal-gate section of the roadmap companion.
 */
export const IN_SAMPLE_PATH = /^(packages|scripts)\//m;

/**
 * Parse a trailer out of a commit message (subject and body).
 * A malformed record carries `error` instead of throwing — the aggregate view
 * reports it separately so it cannot be mistaken for a zero-finding cycle.
 * @param {string} text - a commit message, or any text that may contain the trailer line
 * @returns {{sample?: string, new?: number, adopted?: number, angles?: string, error?: string}|null}
 */
export function parseMeasurementTrailer(text) {
	const match = TRAILER.exec(text);
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

/**
 * Read the --since ref from argv.
 * Both accepted forms are checked explicitly, and a missing value is an error
 * rather than a silent fall-through: without a ref the script skips the
 * missing-record scan entirely and still exits 0, which reads as "nothing
 * missing" to whoever asked for the scan.
 * @param {string[]} argv
 * @returns {{since?: string, error?: string}}
 */
export function parseSinceArg(argv) {
	const inline = argv.find((a) => a.startsWith("--since="));
	if (inline) {
		const value = inline.slice("--since=".length);
		return value ? { since: value } : { error: "--since= needs a ref" };
	}

	const idx = argv.indexOf("--since");
	if (idx === -1) return { since: undefined };

	const value = argv[idx + 1];
	if (!value || value.startsWith("-")) return { error: "--since needs a ref" };
	return { since: value };
}
