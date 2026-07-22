#!/usr/bin/env node
/**
 * check-script-imports.mjs
 *
 * Statically verifies that every relative import in scripts/**\/*.mjs
 * resolves to an existing file. scripts/ is plain Node ESM outside
 * packages/**, so it's covered by neither `pnpm -r typecheck` nor Biome —
 * nothing else catches a sibling script's import specifier going stale when
 * a file it points at moves (#536: two scripts kept importing
 * ./lib/github-rest.mjs after it moved to ./pfdsl/lib/github-rest.mjs,
 * undetected until `make release` broke on main).
 *
 * Doesn't execute any file (many scripts/*.mjs run top-level side effects on
 * import), so a dry-`import()` sweep would be unsafe — this only parses
 * import statements and checks the target path exists.
 *
 * Usage: node scripts/check-script-imports.mjs
 */

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findBrokenImports } from "./lib/check-script-imports.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Both patterns are needed: "scripts/**/*.mjs" only matches one-or-more
// directories deep and misses scripts/*.mjs at the top level.
const files = execSync('git ls-files "scripts/*.mjs" "scripts/**/*.mjs"', {
	encoding: "utf-8",
	cwd: root,
})
	.trim()
	.split("\n")
	.filter(Boolean)
	.map((f) => resolve(root, f))
	// dedupe: a file directly under scripts/ matches both patterns
	.filter((f, i, arr) => arr.indexOf(f) === i);

const broken = findBrokenImports(files);

if (broken.length === 0) {
	console.log(`check-script-imports: all ${files.length} script(s) resolve cleanly`);
	process.exit(0);
}

console.log("check-script-imports: broken relative import(s) found:");
for (const { file, specifier } of broken) {
	console.log(`  ${relPath(file)}: "${specifier}" does not resolve`);
}
console.log(`\ncheck-script-imports: ${broken.length} error(s)`);
process.exit(1);

function relPath(absPath) {
	return absPath.startsWith(`${root}/`) ? absPath.slice(root.length + 1) : absPath;
}
