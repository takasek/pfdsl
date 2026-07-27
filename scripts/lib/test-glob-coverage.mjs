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
 * `node --test` itself uses to resolve its glob arguments. Delegates to
 * `node:path`'s `matchesGlob` — the same underlying engine `node --test`
 * resolves its arguments through — so this check cannot drift from the
 * behavior it is modeling the way a hand-rolled regex translation could.
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
