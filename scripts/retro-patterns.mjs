#!/usr/bin/env node
// The way into the retro audit-pattern catalog (#659). The patterns live one
// per file under .pfdsl/bindings/pfd-retro-patterns/; this is what reads them,
// so that "consult the catalog" is a command rather than a 74KB file read.
//
// Usage:
//   node scripts/retro-patterns.mjs tags
//   node scripts/retro-patterns.mjs list
//   node scripts/retro-patterns.mjs select [--tag <tag>]... [--word <word>]...
//   node scripts/retro-patterns.mjs near --word <word>...
//   node scripts/retro-patterns.mjs check

import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isCliEntrypoint } from "./lib/cli-entrypoint.mjs";
import { parsePatternFile } from "./lib/retro-patterns.mjs";
import { renderCommand } from "./lib/retro-patterns-render.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PATTERN_DIR = resolve(root, ".pfdsl/bindings/pfd-retro-patterns");

/**
 * Every pattern file's name and raw text, by filename.
 * @returns {{path: string, name: string, text: string}[]}
 */
function loadPatternFiles() {
	return readdirSync(PATTERN_DIR)
		.filter((f) => f.endsWith(".md"))
		.sort()
		.map((f) => ({
			path: join(PATTERN_DIR, f),
			name: basename(f, extname(f)),
			text: readFileSync(join(PATTERN_DIR, f), "utf8"),
		}));
}

/**
 * Every pattern, by filename. Catalog order died with the monolith and is not
 * worth a field to resurrect — it recorded when each pattern was appended,
 * which is in the git history and is not how anyone reads them.
 *
 * `path` is carried alongside the parsed bullet because the two names
 * disagree: the display name comes from the bullet's own Japanese heading,
 * the path is the ASCII kebab-case filename `checkPatternFile` enforces.
 * Without both, a reader who wants to open the file the display name came
 * from has nothing to search on (#803).
 * @returns {{name: string, tags: string[], body: string, path: string}[]}
 */
function loadPatterns() {
	return loadPatternFiles().map((file) => ({
		...parsePatternFile(file.text),
		path: relative(root, file.path),
	}));
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	const [command, ...rest] = process.argv.slice(2);
	try {
		const { text, ok } = renderCommand(command, rest, {
			patterns: command === "check" ? undefined : loadPatterns(),
			files: command === "check" ? loadPatternFiles() : undefined,
		});
		if (ok) console.log(text);
		else console.error(text);
		if (!ok) process.exit(1);
	} catch (e) {
		console.error(`retro-patterns: ${e.message}`);
		process.exit(1);
	}
}
