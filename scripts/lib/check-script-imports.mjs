// Statically verifies that every relative import in a .mjs file resolves to
// an existing file, without executing the file (many scripts/*.mjs run
// top-level side effects — git commands, process.exit — on import, so a
// dry-`import()` sweep isn't safe). Catches the class of drift seen in #536:
// a file moved to a new directory, but a sibling script's relative import
// specifier wasn't updated to match.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Each form that can name a module. `[^;]*?` rather than `[\s\S]*?` so a
// clause cannot bridge a statement boundary to borrow the next statement's
// `from` — that is what let `export const path = "./x.mjs";` pair up with an
// unrelated import further down the file.
const IMPORT_RE = /\bimport\b(?:[^;]*?\bfrom\b)?\s*["']([^"']+)["']/g;
const EXPORT_FROM_RE = /\bexport\b[^;]*?\bfrom\b\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Extract the specifier of every statement that names another module and whose
 * specifier is relative (starts with `./` or `../`): static `import`,
 * side-effect `import "..."`, `export ... from`, `export * from`, and dynamic
 * `import()` given a string literal. Bare specifiers (npm packages) and `node:`
 * builtins are ignored. A specifier named more than once is returned once.
 *
 * A dynamic `import()` whose argument is *not* a literal cannot be resolved
 * statically at all — see findUnanalyzableImports, which reports those instead.
 * @param {string} source
 * @returns {string[]}
 */
export function extractRelativeImports(source) {
	const specifiers = new Set();
	for (const re of [IMPORT_RE, EXPORT_FROM_RE, DYNAMIC_IMPORT_RE]) {
		for (const match of source.matchAll(re)) {
			const specifier = match[1];
			if (specifier.startsWith("./") || specifier.startsWith("../")) {
				specifiers.add(specifier);
			}
		}
	}
	return [...specifiers];
}

// A dynamic import whose argument does not open with a string literal: an
// identifier, a template literal, a concatenation. Matched against
// comment-stripped source, because several scripts in this repo *explain* the
// construct in prose — including this module's own header. The extraction above
// deliberately does not strip comments: stripComments drops from `//` to the
// end of the line, so a URL inside a string would take a real import sharing
// that line with it. Losing an edge is the worse error there; here it only
// costs a missed warning.
const UNANALYZABLE_IMPORT_RE = /\bimport\s*\(\s*(?!["'])/g;

/**
 * Count the dynamic `import()` calls whose target cannot be determined without
 * running the code. Callers that reason about a whole module closure need this:
 * such an edge is invisible to the walk, so a closure-wide claim ("nothing here
 * touches packages/cli/dist") would quietly stop covering whatever it reaches.
 *
 * A count rather than positions, because the offsets would be into the
 * comment-stripped copy and so would not point where a reader expects.
 * @param {string} source
 * @returns {number}
 */
export function countUnanalyzableImports(source) {
	return [...stripComments(source).matchAll(UNANALYZABLE_IMPORT_RE)].length;
}

/**
 * For each file, resolve every relative import specifier against that
 * file's own directory and report the ones that don't exist on disk.
 * @param {string[]} files - absolute paths to .mjs files
 * @returns {Array<{file: string, specifier: string, resolved: string}>}
 */
export function findBrokenImports(files) {
	const broken = [];
	for (const file of files) {
		const source = readFileSync(file, "utf-8");
		for (const specifier of extractRelativeImports(source)) {
			const resolved = resolve(dirname(file), specifier);
			if (!existsSync(resolved)) {
				broken.push({ file, specifier, resolved });
			}
		}
	}
	return broken;
}

/**
 * Walks the relative-import graph starting at entryFile and returns the set
 * of every file reached (entryFile included). Used by guards (e.g.
 * scripts/lib/gen-plugin.test.mjs, scripts/lib/gen-plugin-trigger.test.mjs)
 * that assert something of a module's whole closure, not just its direct
 * source.
 *
 * Throws when a file in the closure contains a dynamic import this walk cannot
 * follow. Every caller states a property of the *entire* closure, so an edge
 * the walk misses does not weaken the answer visibly — it shrinks the set the
 * property is checked against while the assertion still passes. Refusing to
 * return is the only outcome those callers can act on.
 * @param {string} entryFile - absolute path
 * @returns {Set<string>}
 */
export function collectModuleClosure(entryFile) {
	const seen = new Set();
	const queue = [entryFile];
	while (queue.length > 0) {
		const file = queue.pop();
		if (seen.has(file)) continue;
		seen.add(file);
		const source = readFileSync(file, "utf-8");
		const unanalyzable = countUnanalyzableImports(source);
		if (unanalyzable > 0) {
			throw new Error(
				`${file}: ${unanalyzable} dynamic import(s) with a non-literal specifier — the module closure cannot be computed statically. Give the import a literal specifier, or drop the closure-wide guard that reads this file.`,
			);
		}
		for (const specifier of extractRelativeImports(source)) {
			queue.push(resolve(dirname(file), specifier));
		}
	}
	return seen;
}

// Strips `//` and `/* */` comments before scanning for forbidden references,
// so a file is free to *explain in prose* why it avoids packages/cli/dist
// without that explanation itself tripping the check.
function stripComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Flags files that import node:child_process or reference packages/cli/dist
 * outside of a comment — the two ways a "dist-independent" script could
 * secretly gain a build dependency (either by spawning the CLI, or by
 * reading its dist output directly).
 * @param {string[]} files - absolute paths
 * @returns {Array<{file: string, reason: string}>}
 */
export function findDistDependentFiles(files) {
	const violations = [];
	for (const file of files) {
		const code = stripComments(readFileSync(file, "utf-8"));
		if (/node:child_process/.test(code)) {
			violations.push({ file, reason: "imports node:child_process (that's how CLI dist gets invoked)" });
		}
		if (/dist[\\/]cli\.js|cli[\\/]dist/.test(code)) {
			violations.push({ file, reason: "references packages/cli/dist" });
		}
	}
	return violations;
}
