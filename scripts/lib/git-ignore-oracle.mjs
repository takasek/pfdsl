/**
 * Answers "does this repository's Git ignore this path", for the maintained
 * source topology check in scripts/lib/harness-source-decoder.mjs.
 *
 * This module spawns one command and only one: `git check-ignore`. That
 * narrowness is the point. The dist-independent generator's module closure
 * may not reach the generic `run(file, args)` of scripts/lib/run-exec.mjs —
 * an argument-taking runner would let any file in that closure invoke the CLI
 * build the generator exists to run without, and the guard's other rule (no
 * `packages/cli` build path in the source text) only catches that when the
 * path is spelled literally. scripts/lib/check-script-imports.mjs exempts this
 * file from its `node:child_process` rule on the strength of the fixed
 * executable and fixed subcommand below; scripts/lib/git-ignore-oracle.test.mjs
 * holds them fixed.
 */

import { execFileSync } from "node:child_process";

import { withoutGitTargetEnvironment } from "./git-environment.mjs";

const CHECK_IGNORE_ARGUMENTS = ["check-ignore", "-q", "--"];

/**
 * `git check-ignore`'s exit status: 0 when the path is ignored, 1 when it is
 * not, anything else (or null) when the question never reached Git's ignore
 * rules at all.
 * @returns {number|null}
 */
function runCheckIgnore(root, queryPath) {
	try {
		// GIT_DIR and its siblings are stripped so the answer comes from the
		// repository `root` sits in — a Git hook exports them, and the decoder
		// runs from one via scripts/pre-commit.
		execFileSync("git", [...CHECK_IGNORE_ARGUMENTS, queryPath], {
			cwd: root,
			env: withoutGitTargetEnvironment(),
			stdio: ["ignore", "ignore", "ignore"],
		});
		return 0;
	} catch (error) {
		return error.status ?? null;
	}
}

/**
 * A memoized ignore test for paths relative to `root`, with a trailing "/" on
 * a path the caller knows to be a directory.
 *
 * `check-ignore` consults the index, so it answers "untracked *and* matched by
 * an ignore rule": a force-added `dist/` still reads as maintained. When Git
 * cannot answer at all — no binary, `root` outside a repository — every later
 * query is answered "not ignored" without asking again, which leaves the
 * caller reporting the entry it was already about to report.
 * @param {string} root
 * @param {{checkIgnore?: (root: string, queryPath: string) => number|null}} [opts]
 * @returns {(queryPath: string) => boolean}
 */
export function createGitIgnoreOracle(
	root,
	{ checkIgnore = runCheckIgnore } = {},
) {
	const answers = new Map();
	let answerable = true;
	return (queryPath) => {
		if (!answerable) return false;
		if (answers.has(queryPath)) return answers.get(queryPath);
		const status = checkIgnore(root, queryPath);
		if (status !== 0 && status !== 1) {
			answerable = false;
			return false;
		}
		const ignored = status === 0;
		answers.set(queryPath, ignored);
		return ignored;
	};
}
