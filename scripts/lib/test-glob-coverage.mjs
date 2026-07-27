// Guards against a test file that exists but is never run. `node --test` takes
// explicit glob arguments (it has no recursive directory mode we can use here —
// passing a bare directory makes it try to load the directory as a module), so a
// test file dropped outside the enumerated directories is silently skipped: it
// passes locally when invoked by hand and never runs in CI. That is how
// scripts/review-measurement.test.mjs — including its shell-injection guard —
// sat unrun.

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
 * Match a repo-relative path against a single glob, with `*` standing for any
 * run of characters other than the path separator (node's own `--test` glob
 * semantics). Every other character is literal.
 * @param {string} path
 * @param {string} glob
 * @returns {boolean}
 */
export function matchesGlob(path, glob) {
	const pattern = glob
		.split("*")
		.map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("[^/]*");
	return new RegExp(`^${pattern}$`).test(path);
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
