/**
 * Shared process runner for the repo's operational scripts.
 *
 * Every call takes the command and its arguments separately and goes through
 * execFileSync, so no argument is ever parsed by a shell. The scripts here take
 * refs, artifact keys and version strings from argv, and interpolating those
 * into a shell string lets a space word-split and a semicolon run whatever
 * follows (takasek/pfdsl#571, #572).
 *
 * `scripts/check-no-shell-strings.mjs` keeps new call sites on this path.
 */

import { execFileSync } from "node:child_process";

const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Run a command, returning stdout. Throws on a non-zero exit.
 * @param {string} file - executable name, never a command line
 * @param {string[]} args
 * @param {{cwd: string, input?: string}} opts
 */
export function run(file, args, { cwd, input } = {}) {
	return execFileSync(file, args, { cwd, encoding: "utf-8", maxBuffer: MAX_BUFFER, ...(input === undefined ? {} : { input }) });
}

/**
 * Run a command, reporting failure as a value.
 * `out` carries stdout when the command produced some before failing, and the
 * error message otherwise — callers print it as the reason.
 * @returns {{ok: boolean, out: string, status: number|null}}
 */
export function tryRun(file, args, opts = {}) {
	try {
		return { ok: true, out: run(file, args, opts), status: 0 };
	} catch (e) {
		return { ok: false, out: e.stdout || e.message, status: e.status ?? null };
	}
}

/** `run` bound to git, the overwhelmingly common case. */
export function git(args, opts = {}) {
	return run("git", args, opts);
}

/** `tryRun` bound to git. */
export function tryGit(args, opts = {}) {
	return tryRun("git", args, opts);
}
