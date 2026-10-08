import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	accessSync,
	constants,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isCliEntrypoint } from "./lib/cli-entrypoint.mjs";

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
	if (!isManagedPath(paths)) {
		try {
			accessSync(paths.effective, constants.X_OK);
			if (readFileSync(paths.effective, "utf8") === source) return;
		} catch {
			/* A custom hook is diagnosed, never replaced. */
		}
		throw new Error(
			`custom core.hooksPath selects ${paths.effective}; install the checkout's executable repository shim there or resolve the override explicitly. Setup will not change it.`,
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
			// A dangling symlink is an existing hook, not an empty install target.
			try {
				lstatSync(paths.managed);
				throw new Error(
					`The managed hook ${paths.managed} is unreadable; refusing to overwrite it.`,
				);
			} catch (missing) {
				if (missing.code !== "ENOENT") throw missing;
			}
		}
		if (installed === source) {
			try {
				accessSync(paths.managed, constants.X_OK);
				return;
			} catch {
				/* Restore executable mode through the same atomic install. */
			}
		} else if (installed !== undefined) {
			throw new Error(
				`The managed hook ${paths.managed} differs from the checkout's repository shim; refusing to overwrite it. Inspect and replace it explicitly before running setup.`,
			);
		}
		writeFileSync(temporary, source, { mode: 0o755, flag: "wx" });
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
