/**
 * Turns a biome `--reporter=json` run into a pass/fail verdict that does not
 * depend on severity.
 *
 * biome's own exit code covers error severity, and `--error-on-warnings` adds
 * warning severity — info severity is covered by neither, so a diagnostic at
 * that level prints and exits 0 (takasek/pfdsl#747). Raising the info rules to
 * warn in biome.json closes that path only for the rules enumerated there, and
 * nothing forces a re-visit of the list when a biome release changes a rule's
 * default severity. Counting diagnostics instead makes the gate blind to
 * severity, which is what keeps it from having a per-rule list at all.
 *
 * The counts come from the report's `summary`, not from `diagnostics.length`:
 * `--max-diagnostics` caps the array (20 by default) while the summary keeps
 * counting, so the array would under-report exactly when there is most to see.
 */

/**
 * @typedef {object} BiomeVerdict
 * @property {boolean} blocking - whether the caller should fail
 * @property {{errors: number, warnings: number, infos: number}} [counts]
 * @property {string} [reason] - set when the verdict is not from the counts
 */

/**
 * @param {{ok: boolean, out: string, status: number|null}} result - a tryRun
 *   result for `biome check ... --reporter=json`; `out` is biome's stdout, and
 *   the experimental-reporter notice goes to stderr, so it stays pure JSON
 * @returns {BiomeVerdict}
 */
export function evaluateBiomeRun(result) {
	const summary = parseSummary(result.out);
	if (!summary) {
		// A run that produced no readable report has not shown the tree to be
		// clean. Reading it as zero diagnostics would leave the gate green
		// whenever biome fails to start.
		return {
			blocking: true,
			reason: `could not parse biome's --reporter=json output: ${firstLine(result.out)}`,
		};
	}
	const total = summary.errors + summary.warnings + summary.infos;
	if (total > 0) {
		return { blocking: true, counts: summary };
	}
	if (!result.ok) {
		// biome failed for a reason it did not express as a diagnostic: an
		// unreadable config, an unknown flag.
		return {
			blocking: true,
			counts: summary,
			reason: `biome exited with exit status ${result.status} without reporting a diagnostic`,
		};
	}
	return { blocking: false, counts: summary };
}

/**
 * @param {string} out
 * @returns {{errors: number, warnings: number, infos: number} | null}
 */
function parseSummary(out) {
	let report;
	try {
		report = JSON.parse(out);
	} catch {
		return null;
	}
	const summary = report?.summary;
	if (
		typeof summary?.errors !== "number" ||
		typeof summary?.warnings !== "number" ||
		typeof summary?.infos !== "number"
	) {
		return null;
	}
	return {
		errors: summary.errors,
		warnings: summary.warnings,
		infos: summary.infos,
	};
}

/** @param {string} out */
function firstLine(out) {
	const line = out.split("\n").find((l) => l.trim().length > 0) ?? "";
	return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}
