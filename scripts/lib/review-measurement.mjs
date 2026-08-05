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

import { parseArgs } from "node:util";

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
 * The review tools the rule allows, in descending expected yield.
 * The rate is meaningless pooled across them: `/code-review` fans out further
 * than `/simplify`, so a pooled figure measures which tool ran that cycle
 * rather than what review is worth. Records written before the field existed
 * carry no tool and are summarised as `unspecified`.
 */
export const REVIEW_TOOLS = ["code-review", "code-reviewer-agent", "simplify"];

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
	if (fields.tool !== undefined) {
		if (!REVIEW_TOOLS.includes(fields.tool)) {
			return {
				...record,
				error: `tool must be one of ${REVIEW_TOOLS.join(", ")}, got ${JSON.stringify(fields.tool)}`,
			};
		}
		record.tool = fields.tool;
	}

	if (record.sample !== "in" && record.sample !== "out") {
		return {
			...record,
			error: `sample must be "in" or "out", got ${JSON.stringify(fields.sample ?? null)}`,
		};
	}
	if (record.sample === "out") return record;

	for (const key of ["new", "adopted"]) {
		if (!/^\d+$/.test(fields[key] ?? "")) {
			return {
				...record,
				error: `${key} must be a non-negative integer on an in-sample record`,
			};
		}
		record[key] = Number(fields[key]);
	}
	if (record.adopted > record.new) {
		return { ...record, error: "adopted cannot exceed new" };
	}
	return record;
}

/**
 * Every record in one blob of commit messages.
 *
 * A cycle writes one trailer per review pass, and `parseMeasurementTrailer`
 * reads only the first it finds, so the blob has to be cut at each trailer
 * before parsing. Both callers — the merged-history audit and the pre-PR gate —
 * need the same cut, and the split pattern is the sort of thing that drifts
 * silently when it lives in two places.
 * @param {string} text - concatenated commit messages
 * @returns {Array<object>} one parsed record per trailer, in order
 */
export function parseMeasurementRecords(text) {
	return text
		.split(/^(?=Review-Measurement:)/m)
		.map(parseMeasurementTrailer)
		.filter(Boolean);
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
/**
 * Collapse one cycle's review passes into a single record.
 * A cycle commonly reviews more than once — the self review, the tool, then
 * the fixes the tool prompted — and each pass writes its own trailer. Counting
 * those as separate cycles inflated the denominator the rate divides by.
 * @param {Array<{sample?: string, new?: number, adopted?: number, tool?: string, angles?: string, error?: string}>} records
 * @returns {{sample: string, new: number, adopted: number, tools: string[], angles: string[], error?: string}|null}
 */
export function mergeCycleRecords(records) {
	if (records.length === 0) return null;

	const malformed = records.find((r) => r.error);
	// Any pass claiming in-sample makes the cycle in-sample: a cycle that
	// changed code stays in the denominator even if another pass said out.
	const sample = records.some((r) => r.sample === "in") ? "in" : "out";
	const merged = {
		sample,
		new: 0,
		adopted: 0,
		tools: [],
		angles: [],
		...(malformed ? { error: malformed.error } : {}),
	};
	for (const r of records) {
		if (r.error || r.sample !== "in") continue;
		merged.new += r.new;
		merged.adopted += r.adopted;
		if (r.tool && !merged.tools.includes(r.tool)) merged.tools.push(r.tool);
		if (r.angles && !merged.angles.includes(r.angles))
			merged.angles.push(r.angles);
	}
	return merged;
}

/**
 * @param {Array<{records: Array<object>}>} cycles - one entry per cycle, in any order
 */
export function summarize(cycles) {
	const merged = cycles
		.map((c) => mergeCycleRecords(c.records))
		.filter(Boolean);
	const malformed = merged.filter((r) => r.error);
	const sampled = merged.filter((r) => r.sample === "in" && !r.error);
	const outOfSample = merged.filter(
		(r) => r.sample === "out" && !r.error,
	).length;
	const cyclesWithFindings = sampled.filter((r) => r.new > 0).length;

	// Per review pass, not per cycle: a cycle that ran two tools is one cycle
	// but two data points about what each tool finds.
	/** @type {Record<string, {passes: number, withFindings: number, totalNew: number, totalAdopted: number}>} */
	const byTool = {};
	for (const c of cycles) {
		for (const r of c.records) {
			if (r.error || r.sample !== "in") continue;
			const key = r.tool ?? "unspecified";
			byTool[key] ??= {
				passes: 0,
				withFindings: 0,
				totalNew: 0,
				totalAdopted: 0,
			};
			const bucket = byTool[key];
			bucket.passes += 1;
			if (r.new > 0) bucket.withFindings += 1;
			bucket.totalNew += r.new;
			bucket.totalAdopted += r.adopted;
		}
	}

	return {
		byTool,
		sampled: sampled.length,
		outOfSample,
		malformed: malformed.length,
		cyclesWithFindings,
		totalNew: sampled.reduce((sum, r) => sum + r.new, 0),
		totalAdopted: sampled.reduce((sum, r) => sum + r.adopted, 0),
		// Null rather than 0 or NaN: "no data yet" and "measured zero" are different answers.
		findingRate:
			sampled.length === 0 ? null : cyclesWithFindings / sampled.length,
		remaining: Math.max(0, TARGET_SAMPLE_COUNT - sampled.length),
	};
}

/**
 * Read the --since ref from argv.
 * Anything unrecognised is an error rather than a silent fall-through: without
 * a ref the script skips the missing-record scan entirely and still exits 0,
 * which reads as "nothing missing" to whoever asked for the scan — and a
 * mistyped flag lands in exactly that state (#648). Node's strict parse
 * supplies the rejections (unknown flag, dash-leading or absent value, stray
 * positional); only the empty inline form has to be caught here, since
 * `--since=` parses cleanly to an empty string.
 * @param {string[]} argv
 * @returns {{since?: string, error?: string}}
 */
export function parseSinceArg(argv) {
	let values;
	try {
		({ values } = parseArgs({
			args: argv,
			options: { since: { type: "string" } },
			strict: true,
			allowPositionals: false,
		}));
	} catch (err) {
		return { error: err.message };
	}
	if (values.since === undefined) return { since: undefined };
	if (values.since === "") return { error: "--since needs a ref" };
	return { since: values.since };
}

/**
 * How many trailers a cycle's commits carry. More than one is expected — a
 * cycle reviews more than once — and mergeCycleRecords folds them into one
 * record so the cycle is still counted once.
 * @param {string} text - the concatenated commit messages of one cycle
 */
export function countMeasurementTrailers(text) {
	return (text.match(/^Review-Measurement:/gm) ?? []).length;
}

/**
 * Judge one cycle against its own diff.
 * Trailer presence alone is not enough: `sample=` is written by hand and the
 * paths it claims are checkable, so a cycle that changed code and declared
 * itself out of sample silently leaves the denominator. A cycle that recorded
 * several passes is not a problem — it reviewed several times.
 * @param {{changedFiles: string, trailerCount: number, sample?: string}} cycle
 * @returns {{inSampleByPath: boolean, issues: Array<{type: string, detail: string}>}}
 */
export function classifyCycle({ changedFiles, trailerCount, sample }) {
	const inSampleByPath = IN_SAMPLE_PATH.test(changedFiles);
	const issues = [];

	if (trailerCount === 0) {
		if (inSampleByPath)
			issues.push({
				type: "missing",
				detail: "changed code but carries no record",
			});
		return { inSampleByPath, issues };
	}

	if (inSampleByPath && sample === "out") {
		issues.push({
			type: "mismatch",
			detail: "changed code but recorded sample=out",
		});
	} else if (!inSampleByPath && sample === "in") {
		issues.push({
			type: "mismatch",
			detail: "changed no code but recorded sample=in",
		});
	}
	return { inSampleByPath, issues };
}
