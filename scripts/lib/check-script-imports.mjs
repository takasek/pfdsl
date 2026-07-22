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
