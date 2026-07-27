// Guards against a test file that exists but is never run. `node --test` takes
// explicit glob arguments (passing a bare directory makes it try to load the
// directory as a module rather than recurse into it), so a test file dropped
// outside the enumerated globs is silently skipped: it passes locally when
// invoked by hand and never runs in CI. That is how
// scripts/review-measurement.test.mjs — including its shell-injection guard —
// sat unrun.

import { matchesGlob as nodeMatchesGlob } from "node:path";

const NODE_TEST_LINE_RE = /node\s+--test\s+(.*)$/gm;
const QUOTED_ARG_RE = /"([^"]+)"/g;

/**
 * Collect the quoted glob arguments of every `node --test` invocation in a
 * Makefile recipe or workflow step. Unquoted arguments are expanded by the
 * shell before node sees them and carry no glob, so they are ignored.
 * @param {string} source
 * @returns {string[]}
 */
export function extractTestGlobs(source) {
	const globs = [];
	for (const line of source.matchAll(NODE_TEST_LINE_RE)) {
		for (const arg of line[1].matchAll(QUOTED_ARG_RE)) {
			globs.push(arg[1]);
		}
	}
	return globs;
}

/**
 * Match a repo-relative path against a single glob, with the same semantics
 * `node --test` uses to resolve its glob arguments. Delegates to `node:path`'s
 * `matchesGlob` instead of translating the glob to a regex by hand — the
 * hand-rolled version mapped every `*` to `[^/]*`, so it read a doubled `*` as
 * a plain one and reported a recursive glob argument as unable to reach
 * anything nested (#582). Agreement with what `node --test` actually collects
 * was checked against `fs.globSync` over the repo's tracked test files; the
 * `matchesGlob` cases below pin the semantics this check depends on.
 * Metacharacters other than the star — `?`, character classes, brace
 * alternation — are now interpreted as glob too, where the hand-rolled version
 * escaped them into literals. No glob written in the Makefile or the workflow
 * uses any of them today.
 * @param {string} path
 * @param {string} glob
 * @returns {boolean}
 */
export function matchesGlob(path, glob) {
	return nodeMatchesGlob(path, glob);
}

/**
 * The files that no glob reaches — i.e. the tests that are never executed.
 * @param {string[]} files - repo-relative paths
 * @param {string[]} globs
 * @returns {string[]}
 */
export function findUnrunTestFiles(files, globs) {
	return files.filter((file) => !globs.some((glob) => matchesGlob(file, glob)));
}
