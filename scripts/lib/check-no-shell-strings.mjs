/**
 * Detects shell-executing calls in scripts/**\/*.mjs.
 *
 * `execSync` hands its argument to a shell, so any value spliced into it is
 * parsed as shell syntax: a space word-splits and a semicolon starts another
 * command. Refs, artifact keys, tags and paths all reach these scripts from
 * argv or from other commands' output (takasek/pfdsl#571, #572).
 *
 * The rule is the *import*, not the argument. An earlier version tried to flag
 * only interpolated command lines and let constant ones through, which meant
 * deciding what a call's first argument was by scanning characters. Every way
 * of writing the vulnerable code that did not look like the expected shape
 * slipped past it: assigning the template to a variable one line earlier, a
 * `)` inside a `--format="%h)"` string, an aliased import, `{shell: true}` on
 * a call that otherwise takes argv. Banning the import needs no such analysis
 * — `scripts/lib/run-exec.mjs` covers every use in this repo.
 */

/** `shell: true` turns the argv-taking calls into shell-executing ones. */
const SHELL_OPTION = /\bshell\s*:\s*true\b/;

/** Names that execute through a shell when imported from child_process. */
const SHELL_EXECUTORS = new Set(["exec", "execSync"]);

const IMPORT_FROM_CHILD_PROCESS =
	/import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?child_process["']/g;
const REQUIRE_CHILD_PROCESS =
	/require\(\s*["'](?:node:)?child_process["']\s*\)/;

/**
 * Files the gate leaves alone. Everything else tracked as `.mjs` is scanned:
 * enumerating the directories to scan instead means a new one is only covered
 * when someone remembers to add it, and `hooks/` — which runs on every Bash
 * tool call in an adopting repo — went uncovered that way (#605).
 */
function isExcluded(file) {
	// The detector and its tests hold the offending patterns as data.
	if (file.endsWith(".test.mjs")) return true;
	if (file === "scripts/lib/check-no-shell-strings.mjs") return true;
	// Generated mirror of hooks/ and .claude/skills/ — the sources are scanned,
	// and scripts/gen-plugin.mjs' identity gate keeps the copy equal to them.
	return file.startsWith("plugin/");
}

/**
 * @param {string[]} trackedFiles - repo-relative paths, e.g. `git ls-files` output
 * @returns {string[]} the subset the gate scans
 */
export function selectScannedFiles(trackedFiles) {
	return trackedFiles.filter(
		(file) => file.endsWith(".mjs") && !isExcluded(file),
	);
}

/**
 * @param {string} source
 * @returns {Array<{line: number, reason: string}>}
 */
export function findShellExecutors(source) {
	const findings = [];

	for (const match of source.matchAll(IMPORT_FROM_CHILD_PROCESS)) {
		for (const clause of match[1].split(",")) {
			// `execSync as sh` still names execSync on the left of `as`.
			const imported = clause
				.trim()
				.split(/\s+as\s+/)[0]
				.trim();
			if (!SHELL_EXECUTORS.has(imported)) continue;
			findings.push({
				line: lineOf(source, match.index),
				reason: `imports ${imported} from child_process`,
			});
		}
	}

	if (REQUIRE_CHILD_PROCESS.test(source)) {
		const idx = source.search(REQUIRE_CHILD_PROCESS);
		findings.push({
			line: lineOf(source, idx),
			reason: "requires child_process",
		});
	}

	source.split("\n").forEach((text, i) => {
		if (SHELL_OPTION.test(text))
			findings.push({ line: i + 1, reason: "passes shell: true" });
	});

	return findings;
}

function lineOf(source, index) {
	return source.slice(0, index).split("\n").length;
}
