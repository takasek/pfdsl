/**
 * Lists the untracked files under generated roots, so the dist-independent
 * generator can refuse to rebuild those roots when doing so would delete a
 * file Git cannot restore.
 *
 * This module spawns one command and only one: `git ls-files --others`. Like
 * scripts/lib/git-ignore-oracle.mjs, it is exempted from the
 * `node:child_process` rule of scripts/lib/check-script-imports.mjs on the
 * strength of that fixed executable and subcommand, which
 * scripts/lib/git-untracked-files.test.mjs exercises.
 */

import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

import { withoutGitTargetEnvironment } from "./git-environment.mjs";

/**
 * Untracked files that no ignore rule matches, the same set the drift check
 * reports, under `roots`.
 * @param {string} root - repository working tree
 * @param {string[]} roots - absolute paths
 * @returns {string[]} absolute paths
 */
export function listUntrackedFiles(root, roots) {
	let output;
	try {
		// GIT_DIR and its siblings are stripped so the repository is the one
		// `root` sits in — scripts/pre-commit runs the generator from a hook.
		output = execFileSync(
			"git",
			[
				"ls-files",
				"--others",
				"--exclude-standard",
				"-z",
				"--",
				...roots.map((path) => relative(root, path)),
			],
			{
				cwd: root,
				env: withoutGitTargetEnvironment(),
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
