/**
 * Detects shell command lines built by interpolation in scripts/**\/*.mjs.
 *
 * `execSync` hands its argument to a shell, so any value spliced into it is
 * parsed as shell syntax: a space word-splits and a semicolon starts another
 * command. Refs, artifact keys, tags and paths all reach these scripts from
 * argv or from other commands' output (takasek/pfdsl#571, #572).
 *
 * A constant command line is left alone — nothing can be injected into it, and
 * the repo has several (`git ls-files "<glob>"`) where the shell does no harm.
 * The rule is about interpolation, not about execSync as such.
 */

/** Shell-executing calls. `execFileSync`/`spawnSync` take argv and are safe. */
const SHELL_CALL = /\b(execSync|exec)\s*\(/g;

/**
 * @param {string} source
 * @returns {Array<{line: number, snippet: string}>}
 */
export function findShellStringInterpolations(source) {
	const findings = [];
	for (const match of source.matchAll(SHELL_CALL)) {
		const argStart = match.index + match[0].length;
		const arg = readFirstArgument(source, argStart);
		if (arg === null) continue;
		if (!isInterpolated(arg)) continue;
		findings.push({
			line: source.slice(0, match.index).split("\n").length,
			snippet: arg.length > 80 ? `${arg.slice(0, 77)}...` : arg,
		});
	}
	return findings;
}

/**
 * Read the first argument's source text, stopping at the comma or the closing
 * paren that ends it. Nesting is tracked so a call inside the argument does not
 * end it early.
 */
function readFirstArgument(source, start) {
	let depth = 0;
	for (let i = start; i < source.length; i++) {
		const ch = source[i];
		if (ch === "(" || ch === "[" || ch === "{") depth++;
		else if (ch === ")" || ch === "]" || ch === "}") {
			if (depth === 0) return source.slice(start, i);
			depth--;
		} else if (ch === "," && depth === 0) return source.slice(start, i);
		else if (ch === "\n" && depth === 0 && source.slice(start, i).trim().length > 0) {
			// A bare newline inside the first argument only happens in a template
			// literal, which the depth counter does not track; keep reading.
			continue;
		}
	}
	return null;
}

/** A template literal with a substitution, or a string joined with `+`. */
function isInterpolated(arg) {
	const text = arg.trim();
	if (text.includes("${")) return true;
	return /^["'`][^"'`]*["'`]\s*\+/.test(text) || /\+\s*["'`]/.test(text);
}
