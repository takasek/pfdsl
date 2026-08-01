// Statically verifies that every relative import in a .mjs file resolves to
// an existing file, without executing the file (many scripts/*.mjs run
// top-level side effects — git commands, process.exit — on import, so a
// dry-`import()` sweep isn't safe). Catches the class of drift seen in #536:
// a file moved to a new directory, but a sibling script's relative import
// specifier wasn't updated to match.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const IMPORT_RE = /import\s+(?:[\s\S]*?\bfrom\s+)?["']([^"']+)["']/g;

/**
 * Extract the specifier of every `import ... from "..."` (or side-effect
 * `import "..."`) statement whose specifier is relative (starts with `./` or
 * `../`). Bare specifiers (npm packages) and `node:` builtins are ignored.
 * @param {string} source
 * @returns {string[]}
 */
export function extractRelativeImports(source) {
	const specifiers = [];
	for (const match of source.matchAll(IMPORT_RE)) {
		const specifier = match[1];
		if (specifier.startsWith("./") || specifier.startsWith("../")) {
			specifiers.push(specifier);
		}
	}
	return specifiers;
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
 * of every file reached (entryFile included). Used by dist-independence
 * guards (e.g. scripts/lib/gen-skill-refs.test.mjs, scripts/lib/gen-plugin.test.mjs)
 * that need to inspect a module's whole closure, not just its direct source.
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
