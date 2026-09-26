/**
 * Lists the untracked files under generated roots, so the dist-independent
 * generator can refuse to rebuild those roots when doing so would delete a
 * file Git cannot restore.
 *
 * This module spawns one command and only one: `git ls-files --others`. Like
 * scripts/lib/git-ignore-oracle.mjs, it is exempted from the
 * `node:child_process` rule of scripts/lib/check-script-imports.mjs on the
 * strength of that fixed executable and subcommand, which
 * scripts/lib/git-ls-files.test.mjs exercises.
 */

import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

import { withoutGitTargetEnvironment } from "./git-environment.mjs";

/**
 * Files under `roots` that are not in the index, ignored ones included: a
 * rebuild deletes an ignored file as surely as any other.
 * @param {string} root - repository working tree
 * @param {string[]} roots - absolute paths
 * @returns {string[]} absolute paths
 */
export function listUntrackedFiles(root, roots) {
	// GIT_DIR and its siblings are stripped so the repository is the one `root`
	// sits in — scripts/pre-commit runs the generator from a hook.
	// GIT_INDEX_FILE is kept: a commit hook points it at the index being
	// committed, which the drift check run after the generator also reads.
	const env = withoutGitTargetEnvironment();
	if (process.env.GIT_INDEX_FILE) {
		env.GIT_INDEX_FILE = process.env.GIT_INDEX_FILE;
	}
	let output;
	try {
		output = execFileSync(
			"git",
			[
				"ls-files",
				"--others",
				"-z",
				"--",
				...roots.map((path) => relative(root, path)),
			],
			{
				cwd: root,
				env,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
	} catch (error) {
		throw new Error(
			`git ls-files could not list untracked files under ${root}: ${error.stderr || error.message}`,
		);
	}
	return output
		.split("\0")
		.filter(Boolean)
		.map((path) => resolve(root, path));
}
