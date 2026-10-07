import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	accessSync,
	constants,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isCliEntrypoint } from "./lib/cli-entrypoint.mjs";

export const LEGACY_SHIM = `#!/bin/sh
# Thin shim installed at .git/hooks/pre-commit by \`make setup\`.
# Always execs the checked-out scripts/pre-commit so the check logic stays in
# sync with the branch's tree instead of a stale copy from setup time (#411).
if [ -x ./scripts/pre-commit ]; then
  exec ./scripts/pre-commit
fi
echo "error: scripts/pre-commit is missing or not executable in this checkout, so the repository's pre-commit checks cannot run." >&2
exit 1
`;
const VERSION_LINE = /^# pfdsl-pre-commit-shim-version: ([1-9][0-9]*)$/m;
function version(text) {
	const matched = text.match(VERSION_LINE);
	const value = matched ? Number(matched[1]) : 0;
	return Number.isSafeInteger(value) ? value : 0;
}

// Future versions with a different dispatch contract require an explicit
// compatibility change; a version comment alone does not authorize a hook.
export function isCompatibleShim(installed, source) {
	return (
		version(installed) >= version(source) &&
		version(source) > 0 &&
		installed.replace(VERSION_LINE, "") === source.replace(VERSION_LINE, "")
	);
}

export function resolveHookPaths(root, env = process.env) {
	const git = (...args) =>
		spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
	const common = git("rev-parse", "--path-format=absolute", "--git-common-dir");
	const effective = git(
		"rev-parse",
		"--path-format=absolute",
		"--git-path",
		"hooks/pre-commit",
	);
	if (common.status !== 0 || effective.status !== 0)
		throw new Error(
			"Cannot resolve the effective pre-commit hook and Git common directory.",
		);
	return {
		managed: join(resolve(root, common.stdout.trim()), "hooks/pre-commit"),
		effective: resolve(root, effective.stdout.trim()),
	};
}

function isManagedPath(paths) {
	if (paths.effective === paths.managed) return true;
	try {
		return (
			realpathSync(dirname(paths.effective)) ===
			realpathSync(dirname(paths.managed))
		);
	} catch {
		return false;
	}
}

export async function ensureSharedHook(
	root = process.cwd(),
	{ env = process.env, waitMs = 5000 } = {},
) {
	const paths = resolveHookPaths(root, env);
	const source = readFileSync(
		join(root, "scripts/hooks/pre-commit-shim"),
		"utf8",
	);
	if (!version(source))
		throw new Error("The checkout's pre-commit shim has no valid version.");
	if (!isManagedPath(paths)) {
		try {
			accessSync(paths.effective, constants.X_OK);
			if (isCompatibleShim(readFileSync(paths.effective, "utf8"), source))
				return;
		} catch {
			/* A custom hook is diagnosed, never replaced. */
		}
		throw new Error(
			`custom core.hooksPath selects ${paths.effective}; install a compatible executable repository shim there or resolve the override explicitly. Setup will not change it.`,
		);
	}
	mkdirSync(dirname(paths.managed), { recursive: true });
	const lock = `${paths.managed}.pfdsl-lock`;
	const deadline = Date.now() + waitMs;
	for (;;) {
		try {
			mkdirSync(lock);
			break;
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			if (Date.now() >= deadline)
				throw new Error(
					`Timed out waiting for shared hook lock ${lock}. Confirm no installer is running before removing a stale lock.`,
				);
			await new Promise((done) => setTimeout(done, 10));
		}
	}
	const temporary = `${paths.managed}.${process.pid}.${randomUUID()}.tmp`;
	try {
		let installed;
		try {
			installed = readFileSync(paths.managed, "utf8");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		if (installed !== undefined && isCompatibleShim(installed, source)) {
			try {
				accessSync(paths.managed, constants.X_OK);
				return;
			} catch {
				/* Restore executable mode through the same atomic install. */
			}
		} else if (
			installed !== undefined &&
			installed !== LEGACY_SHIM &&
			!(
				version(installed) > 0 &&
				version(installed) < version(source) &&
				installed.replace(VERSION_LINE, "") === source.replace(VERSION_LINE, "")
			)
		) {
			throw new Error(
				`The managed hook ${paths.managed} is not a compatible repository shim; refusing to overwrite it.`,
			);
		}
		writeFileSync(
			temporary,
			installed && isCompatibleShim(installed, source) ? installed : source,
			{ mode: 0o755, flag: "wx" },
		);
		renameSync(temporary, paths.managed);
	} finally {
		rmSync(temporary, { force: true });
		rmSync(lock, { recursive: true });
	}
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	try {
		if (process.argv.length !== 3 || process.argv[2] !== "install")
			throw new Error("usage: shared-hooks.mjs install");
		await ensureSharedHook();
	} catch (error) {
		console.error(`error: ${error.message}`);
		process.exitCode = 1;
	}
}
