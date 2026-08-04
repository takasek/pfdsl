/**
 * Detects the two argv-handling shapes this repo retired, so neither comes
 * back (#648, #707). Both failed the same way: they got something wrong and
 * said nothing about it — a lookup that skipped the flag it was asked for, and
 * an entrypoint check that reported "not the entrypoint" and let the CLI body
 * go unrun. Neither is visible in a passing test run, which is why a checker
 * rather than review vigilance.
 *
 * What each rule keys on is chosen to be decidable by reading one line, the
 * lesson scripts/lib/check-no-shell-strings.mjs records from its own history:
 * every attempt there to classify a call's *arguments* was slipped past by
 * some other way of writing the same code.
 *
 *   - flag lookup: a `"--name"` literal handed to indexOf/includes/startsWith.
 *     Not "is this array process.argv" — that needs dataflow. One file in the
 *     repo legitimately matches (it parses other commands' arguments) and is
 *     excluded by name below.
 *   - entrypoint: `import.meta.url` compared against something holding
 *     `process.argv[1]` with no realpath in sight. The correct forms are a
 *     call (isCliEntrypoint) or a comparison that names realpath, so neither
 *     trips it.
 */

/**
 * A flag name, not a bare "--": the latter is how a help-text formatter tells
 * a flag line from its description, and carries no argv reading.
 */
const FLAG_LOOKUP = /\.(?:indexOf|includes|startsWith)\(\s*["']--[A-Za-z]/;

const ENTRYPOINT_COMPARE =
	/(?:import\.meta\.url[^\n]*[!=]==[^\n]*process\.argv\[1\]|process\.argv\[1\][^\n]*[!=]==[^\n]*import\.meta\.url)/;

/** Whole-line comments. The retired shapes have to be quotable in prose. */
const COMMENT_LINE = /^(?:\/\/|\/?\*)/;

/**
 * Files exempt from one rule but not the other. Exempting the whole file would
 * take its entrypoint check out of the net too, and check-install-sync.mjs has
 * one — the shape #707 was about.
 */
const FLAG_LOOKUP_EXEMPT = new Set([
	// Its one flag-name lookup is the --force deprecation hint that #631 put
	// deliberately *ahead* of its strict parse, so the message survives instead
	// of being flattened into "unknown option". The lookup decides what to say,
	// not what to do.
	".claude/skills/pfd-ops/scripts/check-install-sync.mjs",
]);

/**
 * @param {string} source
 * @param {string} [file] - repo-relative path, for the per-rule exemptions
 * @returns {Array<{line: number, reason: string}>}
 */
export function findCliConventionViolations(source, file = "") {
	const findings = [];
	const flagLookupApplies = !FLAG_LOOKUP_EXEMPT.has(file);
	source.split("\n").forEach((text, i) => {
		if (COMMENT_LINE.test(text.trim())) return;
		if (flagLookupApplies && FLAG_LOOKUP.test(text)) {
			findings.push({
				line: i + 1,
				reason: "looks a flag up by name — use node:util's parseArgs with strict: true",
			});
		}
		if (ENTRYPOINT_COMPARE.test(text) && !/realpath/.test(text)) {
			findings.push({
				line: i + 1,
				reason: "compares import.meta.url against process.argv[1] verbatim — use isCliEntrypoint from scripts/lib/cli-entrypoint.mjs",
			});
		}
	});
	return findings;
}

function isExcluded(file) {
	// The detector and its tests hold the retired patterns as data.
	if (file.endsWith(".test.mjs")) return true;
	if (file === "scripts/lib/check-cli-conventions.mjs") return true;
	// Parses *other* commands' arguments, so the flag-name literals are its
	// subject rather than its own argv. Excluded by name instead of by deciding
	// whose argv an array holds — the analysis check-no-shell-strings.mjs
	// records as having failed for it.
	if (file === "scripts/lib/command-usage-guard.mjs") return true;
	// Generated mirror of hooks/ and .claude/skills/ — the sources are scanned,
	// and scripts/gen-plugin.mjs' identity gate keeps the copy equal to them.
	return file.startsWith("plugin/");
}

/**
 * Everything tracked as `.mjs` is scanned. Listing the directories instead
 * means a new one is only covered when someone remembers to add it, which is
 * how packages/vscode-extension/esbuild.config.mjs kept the retired flag
 * lookup through the sweep that was meant to remove it.
 * @param {string[]} trackedFiles - repo-relative paths, e.g. `git ls-files` output
 * @returns {string[]} the subset the gate scans
 */
export function selectScannedFiles(trackedFiles) {
	return trackedFiles.filter((file) => file.endsWith(".mjs") && !isExcluded(file));
}
