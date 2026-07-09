#!/usr/bin/env node
/**
 * get-spec-id.mjs
 *
 * Given a `(SPEC_<id>)` definition id, prints the enclosing block's text to
 * stdout, following the range rules in ADR-0027 ("レンジ規則"). Lets an LLM
 * pull just the referenced block instead of reading all of spec.md — the
 * get-by-ID tool (#402).
 *
 * Usage:
 *   node scripts/get-spec-id.mjs SPEC_xxx [files...]
 *   (no files → all git-tracked docs/**\/*.md files, same default as
 *   check-spec-ids.mjs)
 *
 * Exit codes:
 *   0 — exactly one definition found; block text on stdout, "file:start-end"
 *       location on stderr.
 *   1 — zero or more than one definition found; error on stderr.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { findSpecIdDefinitions } from "./lib/spec-id-check.mjs";
import { computeRange } from "./lib/spec-id-range.mjs";

const [id, ...fileArgs] = process.argv.slice(2);

if (!id) {
	console.error("usage: node scripts/get-spec-id.mjs SPEC_xxx [files...]");
	process.exit(1);
}

const files =
	fileArgs.length > 0
		? fileArgs
		: execSync('git ls-files "docs/**/*.md"', { encoding: "utf8" })
				.trim()
				.split("\n")
				.filter(Boolean);

const matches = [];
const textByFile = new Map();
for (const file of files) {
	const text = readFileSync(file, "utf8");
	textByFile.set(file, text);
	for (const hit of findSpecIdDefinitions(text)) {
		if (hit.id === id) matches.push({ file, ...hit });
	}
}

if (matches.length === 0) {
	console.error(`get-spec-id: id "${id}" is not defined in the scanned files`);
	process.exit(1);
}

if (matches.length > 1) {
	console.error(`get-spec-id: id "${id}" is defined more than once:`);
	for (const match of matches) {
		console.error(`  ${match.file}:${match.line}`);
	}
	process.exit(1);
}

const [match] = matches;
const text = textByFile.get(match.file);
const { startLine, endLine } = computeRange(text, match.line);
const block = text.split("\n").slice(startLine - 1, endLine).join("\n");

console.log(block);
console.error(`${match.file}:${startLine}-${endLine}`);
