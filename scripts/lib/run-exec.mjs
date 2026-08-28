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
import { dirname, resolve } from "node:path";

const MAX_BUFFER = 32 * 1024 * 1024;
const GIT_TARGET_ENVIRONMENT_VARIABLES = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_COMMON_DIR",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_NAMESPACE",
];

/** Copy an environment without variables that redirect Git's repository state. */
export function withoutGitTargetEnvironment(environment = process.env) {
	const sanitized = { ...environment };
	for (const variable of GIT_TARGET_ENVIRONMENT_VARIABLES) {
		delete sanitized[variable];
	}
	return sanitized;
}

/** Whether an inherited Git target override makes a guarded mutation ambiguous. */
export function hasGitTargetEnvironment(environment = process.env) {
	return GIT_TARGET_ENVIRONMENT_VARIABLES.some(
		(variable) =>
			Object.hasOwn(environment, variable) && environment[variable] !== "",
	);
}

/**
 * Run a command, returning stdout. Throws on a non-zero exit.
 * @param {string} file - executable name, never a command line
 * @param {string[]} args
 * @param {{cwd: string, input?: string, env?: object}} opts
 */
export function run(
	file,
	args,
	{ cwd, input, env, captureStderr = false } = {},
) {
	// Node echoes a child's stderr to the parent unless stdio is given, and the
	// callers here relied on that: gate-check's pnpm builds stream progress while
	// they run. Inheriting stays the default so this stays a change of how the
	// command is spelled, not of what the operator sees.
	//
	// captureStderr is for callers that probe with commands expected to fail — a
	// tag that does not exist yet, a ref from before a rename — where an
	// inherited stderr reads as breakage. Their reason then reaches tryRun's
	// `out` instead of the terminal.
	return execFileSync(file, args, {
		cwd,
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
		...(captureStderr ? { stdio: ["pipe", "pipe", "pipe"] } : {}),
		...(input === undefined ? {} : { input }),
		...(env === undefined ? {} : { env }),
	});
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
		// stderr carries the reason for most git failures; stdout is often empty.
		return {
			ok: false,
			out: e.stdout || e.stderr || e.message,
			status: e.status ?? null,
		};
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

/**
 * Resolve the current worktree and shared repository roots for `cwd`.
 * @param {string} cwd
 * @param {{exec?: (args: string[], opts: {cwd: string, env: object}) => {ok: boolean, out: string}, environment?: object}} [opts]
 * @returns {{worktreeRoot: string, commonDir: string, mainRoot: string} | null}
 */
export function resolveGitRoots(
	cwd,
	{ exec = tryGit, environment = process.env } = {},
) {
	const env = withoutGitTargetEnvironment(environment);
	const toplevel = exec(["rev-parse", "--show-toplevel"], { cwd, env });
	const common = exec(["rev-parse", "--git-common-dir"], { cwd, env });
	if (!toplevel.ok || !common.ok) return null;

	const commonDir = resolve(cwd, common.out.trim());
	return {
		worktreeRoot: toplevel.out.trim(),
		commonDir,
		mainRoot: dirname(commonDir),
	};
}

/**
 * NUL-separated paths, as `git ls-files -z` / `git diff -z --name-only`
 * both produce, split into one string per path.
 *
 * Without `-z`, git escapes any path containing a byte outside ASCII and
 * wraps it in quotes, so the caller gets `"\346\274\242.md"` where the file
 * is `漢.md`. Splitting that output on newlines then hands every consumer a
 * path that does not open — and a path containing a newline arrives as two.
 * Both go unnoticed until a repo grows such a file, at which point whichever
 * checker reaches it first crashes with ENOENT on a name nobody typed.
 * @param {string} text
 * @returns {string[]}
 */
export function splitNulSeparated(text) {
	return text.split("\0").filter(Boolean);
}

/**
 * Tracked paths matching `patterns`, one string each.
 * @param {string[]} patterns - pathspecs, passed through untouched.
 * @param {{cwd?: string, exec?: (args: string[], opts: object) => string}} [opts]
 * @returns {string[]}
 */
export function gitLsFiles(patterns, { cwd, exec = git } = {}) {
	return splitNulSeparated(exec(["ls-files", "-z", ...patterns], { cwd }));
}

/**
 * Changed paths for `git diff --name-only`, one string each.
 * @param {string[]} args - everything after `--name-only`: refs, `--cached`,
 *   `--diff-filter=…`, a `-- <pathspec>` tail. Passed through untouched.
 * @param {{cwd?: string, exec?: (args: string[], opts: object) => string}} [opts]
 * @returns {string[]}
 */
export function gitDiffNames(args, { cwd, exec = git } = {}) {
	return splitNulSeparated(
		exec(["diff", "-z", "--name-only", ...args], { cwd }),
	);
}
