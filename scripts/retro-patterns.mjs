#!/usr/bin/env node
// The way into the retro audit-pattern catalog (#659). The patterns live one
// per file under .pfdsl/bindings/pfd-retro-patterns/; this is what reads them,
// so that "consult the catalog" is a command rather than a 74KB file read.
//
// Usage:
//   node scripts/retro-patterns.mjs tags
//   node scripts/retro-patterns.mjs list
//   node scripts/retro-patterns.mjs select [--tag <tag>]... [--word <word>]...
//   node scripts/retro-patterns.mjs check

import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isCliEntrypoint } from "./lib/cli-entrypoint.mjs";
import {
	checkPatternFile,
	collectTags,
	groupTagsByAxis,
	parsePatternFile,
	select,
	summaryOf,
} from "./lib/retro-patterns.mjs";

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
 * @returns {{name: string, tags: string[], body: string}[]}
 */
function loadPatterns() {
	return loadPatternFiles().map(({ text }) => parsePatternFile(text));
}

/**
 * Repeated `--tag` / `--word` options, read by walking argv rather than
 * searching it: a lookup that misses its flag reports nothing (#707).
 * @param {string[]} argv
 * @returns {{tags: string[], words: string[]}}
 */
function parseQuery(argv) {
	/** @type {{tags: string[], words: string[]}} */
	const query = { tags: [], words: [] };
	for (let i = 0; i < argv.length; i += 1) {
		const value = argv[i + 1];
		if (argv[i] === "--tag" || argv[i] === "--word") {
			if (value === undefined) throw new Error(`${argv[i]} needs a value`);
			(argv[i] === "--tag" ? query.tags : query.words).push(value);
			i += 1;
		} else {
			throw new Error(`unknown option: ${argv[i]}`);
		}
	}
	return query;
}

/** @param {{name: string, tags: string[], body: string}} pattern */
function printPattern({ name, tags, body }) {
	console.log(`${name}  [${tags.join(", ")}]`);
	console.log(`  ${summaryOf(body)}`);
}

/** @param {{name: string, tags: string[], body: string}[]} patterns */
function printTags(patterns) {
	for (const { axis, tags } of groupTagsByAxis(collectTags(patterns))) {
		console.log(`[${axis || "no axis"}]`);
		for (const { tag, count } of tags) console.log(`  ${tag}  ${count}`);
	}
	console.log(
		`\n${patterns.length} pattern(s). Pick the tags whose condition held this cycle; --tag unions them.`,
	);
}

/**
 * @param {{name: string, tags: string[], body: string}[]} patterns
 * @param {{tags: string[], words: string[]}} query
 */
function printSelection(patterns, query) {
	const { tagged, wordOnly, always } = select(patterns, query);

	console.log(`## tagged (${tagged.length})`);
	for (const p of tagged) printPattern(p);

	console.log(`\n## word-only (${wordOnly.length}) — what the tags missed`);
	if (query.words.length === 0) {
		console.log(
			"  no --word given. Tags only answer what someone anticipated; pass a few",
		);
		console.log(
			"  concrete terms from this cycle's diff to see what they did not.",
		);
	}
	for (const { pattern, hits } of wordOnly) {
		printPattern(pattern);
		for (const h of hits) console.log(`    L${h.line} ${h.word}: ${h.text}`);
	}

	console.log(`\n## always (${always.length})`);
	for (const p of always) printPattern(p);

	const read = tagged.length + wordOnly.length + always.length;
	console.log(`\nRead ${read} of ${patterns.length}.`);
}

/**
 * Every pattern file's violations, printed as `path: reason`. Runs
 * checkPatternFile per file rather than through loadPatterns/parsePatternFile,
 * so a single unparsable file is reported as one violation among the rest
 * instead of aborting the whole command.
 * @param {{path: string, name: string, text: string}[]} files
 * @returns {boolean} whether every file was clean.
 */
function printCheck(files) {
	let clean = true;
	for (const file of files) {
		for (const reason of checkPatternFile(file)) {
			clean = false;
			console.log(`${file.path}: ${reason}`);
		}
	}
	if (clean) console.log(`${files.length} pattern file(s), no violations.`);
	return clean;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	const [command, ...rest] = process.argv.slice(2);
	try {
		if (command === "check") {
			if (!printCheck(loadPatternFiles())) process.exit(1);
		} else {
			const patterns = loadPatterns();
			if (command === "tags") printTags(patterns);
			else if (command === "list") for (const p of patterns) printPattern(p);
			else if (command === "select") printSelection(patterns, parseQuery(rest));
			else {
				console.error(
					"usage: retro-patterns.mjs tags | list | select [...] | check",
				);
				process.exit(1);
			}
		}
	} catch (e) {
		console.error(`retro-patterns: ${e.message}`);
		process.exit(1);
	}
}
