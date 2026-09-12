/**
 * Throwaway Git repositories for tests that need real `git` answers rather
 * than a stub — ignore state, index state, and the like.
 *
 * The caller owns the returned directory and is responsible for removing it.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * An initialized repository holding `gitignore` and nothing else. Pass
 * `repository: false` for a plain directory that is not a repository at all,
 * which is how a caller exercises "Git cannot answer".
 * @param {{prefix?: string, gitignore?: string, repository?: boolean}} [opts]
 * @returns {string} absolute path to the new directory
 */
export function makeGitRepository({
	prefix = "git-test-repository-",
	gitignore = "dist/\n",
	repository = true,
} = {}) {
	const root = mkdtempSync(join(tmpdir(), prefix));
	if (repository) execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, ".gitignore"), gitignore);
	return root;
}

/**
 * Commit everything in `root`, ignore rules included, so the paths under it
 * read as tracked. The identity is supplied per-command: a test machine need
 * not have one configured, and the repository's own config stays untouched.
 * @param {string} root
 */
export function commitEverything(root) {
	execFileSync("git", ["add", "-A", "-f"], { cwd: root });
	execFileSync(
		"git",
		[
			"-c",
			"user.email=test@example.com",
			"-c",
			"user.name=test",
			"commit",
			"-qm",
			"fixture",
		],
		{ cwd: root },
	);
}
