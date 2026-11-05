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
