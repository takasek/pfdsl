/**
 * Whether a criteria's stated check can be decided is not machinable in
 * general — "/pfd-cycle が期待通り動作する" names no procedure any predicate can
 * evaluate. This module takes the one subset that is: a criteria that names a
 * registry version query, where the accessor it names decides whether the
 * criteria can ever be true for anything but the newest release.
 *
 * Why the accessor decides it is stated once, in the failure message this
 * module emits — a reader who trips the check sees that text and not this
 * comment. #724 found 13 criteria in this shape; #729 promoted the rule for
 * version artifacts only, and #867 found the same shape surviving on the
 * standing package artifacts outside that scope.
 *
 * A criteria that asserts a version while naming no command at all is out of
 * scope by construction — it is undecidable for a different reason, and no
 * predicate over command strings reaches it. The predicate is textual, so a
 * criteria that names the list accessor and then indexes into it still passes;
 * widening it past the shape that has actually occurred would trade a bounded
 * check for one whose false positives nobody would keep reading.
 */

/** Commands whose output shape depends on which accessor the criteria names. */
const VERSION_QUERY_RE = /\bnpm\s+(?:show|view)\b|\bvsce\s+show\b/;
/** The plural accessor. Its presence is what distinguishes a list from a tag. */
const VERSION_LIST_RE = /\bversions\b/;

/**
 * @param {string} criteria
 * @returns {boolean} true when the criteria names a version query but reads a
 *   latest-only accessor.
 */
export function usesLatestOnlyVersionQuery(criteria) {
	if (!VERSION_QUERY_RE.test(criteria)) return false;
	return !VERSION_LIST_RE.test(criteria);
}

/**
 * `analyzeFile` is injected so the graphs are read through the same parser the
 * CLI uses rather than by matching .pfdsl text — a second parser would drift
 * from the first on every syntax change.
 *
 * @param {{
 *   listFiles: () => string[],
 *   readFile: (file: string) => string,
 *   analyzeFile: (text: string) => {frontmatter: Record<string, unknown>},
 * }} deps
 * @returns {{exitCode: 0|1, stdoutLines: string[], stderrLines: string[]}}
 */
export function runCriteriaJudgeabilityCheck({
	listFiles,
	readFile,
	analyzeFile,
}) {
	const stderrLines = [];
	let errorCount = 0;

	for (const file of listFiles()) {
		let frontmatter;
		try {
			({ frontmatter } = analyzeFile(readFile(file)));
		} catch (error) {
			// Letting this escape aborts the whole check-docs run with a stack
			// trace that names neither the file nor the check.
			stderrLines.push(`${file}: could not be parsed: ${error.message}`);
			errorCount++;
			continue;
		}
		for (const kind of ["artifact", "process"]) {
			for (const [id, node] of Object.entries(frontmatter?.[kind] ?? {})) {
				const criteria = node?.criteria;
				if (typeof criteria !== "string") continue;
				if (!usesLatestOnlyVersionQuery(criteria)) continue;
				stderrLines.push(
					`${file}: ${id}: criteria names a latest-only version query: ${criteria}`,
				);
				errorCount++;
			}
		}
	}

	if (errorCount > 0) {
		stderrLines.push(
			"\nA latest-only accessor resolves the dist-tag `latest`, so the criteria is false for every version but the newest. State membership in the version list instead (npm view <pkg> versions, vsce's versions array).",
		);
		stderrLines.push(`check-criteria-judgeability: ${errorCount} error(s)`);
		return { exitCode: 1, stdoutLines: [], stderrLines };
	}
	return {
		exitCode: 0,
		stdoutLines: ["check-criteria-judgeability: all passed"],
		stderrLines: [],
	};
}
