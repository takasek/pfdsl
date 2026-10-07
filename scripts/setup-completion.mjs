#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isCliEntrypoint } from "./lib/cli-entrypoint.mjs";
import {
	decideSkillLinkAction,
	SKILL_LINK_TARGET,
} from "./lib/repo-skill-link.mjs";
import { isCompatibleShim } from "./shared-hooks.mjs";

export const SETUP_INPUTS = [
	".npmrc",
	".pnpmfile.cjs",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
];

const MARKER = "node_modules/.pfdsl-setup-complete";
const LOCK_DIRECTORY = ".pfdsl-setup.lock";
const LOCK_OWNER = "owner.json";
const LOCK_WAIT_MS = 240_000;
const LOCK_POLL_MS = 100;
const LOCK_HEARTBEAT_MS = 1_000;
const MALFORMED_LOCK_STALE_MS = 10_000;

export function setupInputs(root = process.cwd()) {
	let workspaceManifests = [];
	try {
		workspaceManifests = readdirSync(join(root, "packages"), {
			withFileTypes: true,
		})
			.filter((entry) => entry.isDirectory())
			.map((entry) => `packages/${entry.name}/package.json`)
			.sort();
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	return [...SETUP_INPUTS, ...workspaceManifests];
}

export function setupFingerprint(
	root = process.cwd(),
	inputs = setupInputs(root),
) {
	const hash = createHash("sha256");
	for (const path of inputs) {
		hash.update(path);
		hash.update("\0");
		try {
			hash.update("file\0");
			hash.update(readFileSync(join(root, path)));
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
			hash.update("missing\0");
		}
		hash.update("\0");
	}
	return hash.digest("hex");
}

function hasDeclaredDependencyLinks(root, inputs = setupInputs(root)) {
	for (const manifestPath of inputs.filter((path) =>
		path.endsWith("package.json"),
	)) {
		let manifest;
		try {
			manifest = JSON.parse(readFileSync(join(root, manifestPath), "utf8"));
		} catch {
			// A manifest that cannot be read or parsed says nothing about the
			// installed tree; the fingerprint already covers its content.
			continue;
		}
		const dependencyNames = [
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.devDependencies ?? {}),
		];
		const manifestDirectory = join(root, dirname(manifestPath));
		for (const name of dependencyNames) {
			const dependencyDirectory = join(manifestDirectory, "node_modules", name);
			if (!existsSync(dependencyDirectory)) return false;

			let dependency;
			try {
				dependency = JSON.parse(
					readFileSync(join(dependencyDirectory, "package.json"), "utf8"),
				);
			} catch {
				return false;
			}

			const binNames = dependencyBinNames(name, dependency);
			if (
				binNames.some(
					(binName) =>
						!isExecutableShim(
							join(manifestDirectory, "node_modules", ".bin", binName),
						),
				)
			)
				return false;
		}
	}
	return true;
}

function dependencyBinNames(dependencyName, dependency) {
	const bin = dependency?.bin;
	if (typeof bin === "string")
		return [basename(dependency?.name ?? dependencyName)];
	if (bin !== null && typeof bin === "object" && !Array.isArray(bin))
		return Object.keys(bin).map((binName) => basename(binName));
	return [];
}

function isExecutableShim(path) {
	try {
		const stats = statSync(path);
		return stats.isFile() && (stats.mode & 0o111) !== 0;
	} catch {
		return false;
	}
}

export function areDependenciesCurrent(root = process.cwd()) {
	try {
		const inputs = setupInputs(root);
		return (
			readFileSync(join(root, MARKER), "utf8").trim() ===
				setupFingerprint(root, inputs) &&
			hasDeclaredDependencyLinks(root, inputs)
		);
	} catch {
		return false;
	}
}

export function isSetupCurrent(root = process.cwd(), options = {}) {
	return (
		areDependenciesCurrent(root) &&
		inspectSkillLink(root).reason === null &&
		inspectHooksPath(root, options).reason === null
	);
}

function inspectSkillLink(root) {
	const link = join(root, ".claude/skills/pfdsl");
	const target = resolve(dirname(link), SKILL_LINK_TARGET, "SKILL.md");
	try {
		if (!statSync(target).isFile()) throw new Error("not a skill file");
	} catch {
		return {
			managed: false,
			reason:
				"Cannot find the tracked skill file generated/skills/pfdsl/SKILL.md, owned by scripts/gen-skill.mjs. Restore the tracked target from Git before rerunning make setup; setup only manages the link.",
		};
	}
	let state = { present: false };
	try {
		const stats = lstatSync(link);
		state = {
			present: true,
			isSymlink: stats.isSymbolicLink(),
			linkTarget: stats.isSymbolicLink() ? readlinkSync(link) : undefined,
		};
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	const { action } = decideSkillLinkAction(state, SKILL_LINK_TARGET);
	if (action === "ok") {
		let reachesTarget = false;
		try {
			reachesTarget =
				realpathSync(join(link, "SKILL.md")) === realpathSync(target);
		} catch {
			// A relocated parent can make the correct relative target dangling.
		}
		if (!reachesTarget)
			return {
				managed: false,
				reason:
					".claude/skills/pfdsl does not reach the tracked generated/skills/pfdsl/SKILL.md. Restore the repo-local .claude/skills parent directory before rerunning make setup; setup only manages the pfdsl link.",
			};
	}
	return {
		managed: true,
		reason:
			action === "ok"
				? null
				: ".claude/skills/pfdsl must link to the tracked generated skill. Run make setup to repair it.",
	};
}

function sameDirectory(left, right) {
	try {
		return realpathSync(dirname(left)) === realpathSync(dirname(right));
	} catch {
		return resolve(left) === resolve(right);
	}
}

// Check the pre-commit Git will run. Setup owns the common-dir hooks, where it
// installs the shim, and may repair it there (`managed`). It never executes or
// rewrites a custom hooks directory or the user's Git configuration.
export function inspectHooksPath(
	root = process.cwd(),
	{ env = process.env } = {},
) {
	const git = (args) =>
		spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
	const configured = git([
		"config",
		"--show-origin",
		"--get",
		"core.hooksPath",
	]);
	if (configured.status !== 0 && configured.status !== 1)
		return {
			reason: "Cannot inspect core.hooksPath: Git configuration lookup failed.",
			managed: false,
		};
	const common = git([
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
	]);
	if (common.status !== 0)
		return {
			reason:
				"Cannot resolve the Git common directory for the pre-commit hook.",
			managed: false,
		};
	const managedPath = join(
		resolve(root, common.stdout.trim()),
		"hooks/pre-commit",
	);
	let path = managedPath;
	if (configured.status === 0) {
		const effective = git([
			"rev-parse",
			"--path-format=absolute",
			"--git-path",
			"hooks/pre-commit",
		]);
		if (effective.status !== 0)
			return {
				reason: "Cannot resolve the effective core.hooksPath pre-commit.",
				managed: false,
			};
		path = resolve(root, effective.stdout.trim());
	}
	const managed = sameDirectory(path, managedPath);
	const repair = managed
		? `Run 'make setup' to install the repo's scripts/hooks/pre-commit-shim at ${path}.`
		: `core.hooksPath (${configured.stdout.trim()}) selects ${path}. Install the repo's executable scripts/hooks/pre-commit-shim there or resolve the override explicitly; setup will not change Git configuration or custom hooks.`;
	const failed = (problem) => ({ reason: `${problem} ${repair}`, managed });
	if (!isExecutableShim(path))
		return failed("The effective pre-commit is missing or not executable.");
	try {
		if (
			!isCompatibleShim(
				readFileSync(path, "utf8"),
				readFileSync(join(root, "scripts/hooks/pre-commit-shim"), "utf8"),
			)
		)
			return failed(
				"The effective hook differs from a compatible repo shim; cannot verify that it runs the gate.",
			);
	} catch {
		return failed("Cannot read the effective pre-commit shim.");
	}
	if (!isExecutableShim(join(root, "scripts/pre-commit")))
		return failed(
			"The checkout's scripts/pre-commit is missing or not executable.",
		);
	return { reason: null, managed };
}

export function setupLockPath(root = process.cwd()) {
	return join(root, dirname(MARKER), LOCK_DIRECTORY);
}

function processIsAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

function readLockOwner(lock) {
	try {
		const owner = JSON.parse(readFileSync(join(lock, LOCK_OWNER), "utf8"));
		return Number.isInteger(owner?.pid) && typeof owner?.token === "string"
			? owner
			: null;
	} catch {
		return null;
	}
}

function reclaimStaleLock(lock, staleMs) {
	const owner = readLockOwner(lock);
	if (owner !== null) {
		if (processIsAlive(owner.pid)) return { owner, reclaimed: false };
		rmSync(lock, { force: true, recursive: true });
		return { owner, reclaimed: true };
	}

	try {
		if (Date.now() - statSync(lock).mtimeMs < staleMs)
			return { owner: null, reclaimed: false };
		rmSync(lock, { force: true, recursive: true });
		return { owner: null, reclaimed: true };
	} catch (error) {
		if (error?.code === "ENOENT") return { owner: null, reclaimed: true };
		throw error;
	}
}

function wait(milliseconds) {
	return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

export async function acquireSetupLock(
	root = process.cwd(),
	{
		heartbeatMs = LOCK_HEARTBEAT_MS,
		pollMs = LOCK_POLL_MS,
		staleMs = MALFORMED_LOCK_STALE_MS,
		waitMs = LOCK_WAIT_MS,
	} = {},
) {
	const lock = setupLockPath(root);
	mkdirSync(dirname(lock), { recursive: true });
	const deadline = Date.now() + waitMs;
	let lastOwner = null;
	for (;;) {
		try {
			mkdirSync(lock);
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
			const state = reclaimStaleLock(lock, staleMs);
			lastOwner = state.owner;
			if (state.reclaimed) continue;
			if (Date.now() >= deadline) {
				const owner =
					lastOwner === null ? "unknown owner" : `owner pid ${lastOwner.pid}`;
				throw new Error(`timed out waiting for setup lock ${lock} (${owner})`);
			}
			await wait(Math.min(pollMs, Math.max(1, deadline - Date.now())));
			continue;
		}

		const token = randomUUID();
		try {
			writeFileSync(
				join(lock, LOCK_OWNER),
				`${JSON.stringify({ pid: process.pid, token })}\n`,
			);
		} catch (error) {
			rmSync(lock, { force: true, recursive: true });
			throw error;
		}

		const heartbeat = setInterval(() => {
			try {
				const now = new Date();
				utimesSync(lock, now, now);
			} catch {
				// A missing lock is handled by the token check during release.
			}
		}, heartbeatMs);
		heartbeat.unref();
		return {
			release() {
				clearInterval(heartbeat);
				if (readLockOwner(lock)?.token === token)
					rmSync(lock, { force: true, recursive: true });
			},
		};
	}
}

export function writeSetupMarker(
	root = process.cwd(),
	inputs = setupInputs(root),
	{ rename = renameSync } = {},
) {
	const marker = join(root, MARKER);
	mkdirSync(dirname(marker), { recursive: true });
	const temporary = `${marker}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${setupFingerprint(root, inputs)}\n`);
		rename(temporary, marker);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function runSetupUnlocked(root, target = "setup-unlocked") {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn("make", ["-f", join(root, "Makefile"), target], {
			cwd: root,
			stdio: "inherit",
		});
		child.once("error", rejectRun);
		child.once("close", (status) => resolveRun(status ?? 1));
	});
}

async function runSetup(root = process.cwd()) {
	// A hook setup does not manage is refused untouched; a missing or stale
	// shim in the setup-managed directory is what setup itself installs.
	const hooks = inspectHooksPath(root);
	if (hooks.reason !== null && !hooks.managed) throw new Error(hooks.reason);
	const lock = await acquireSetupLock(root);
	try {
		const skill = inspectSkillLink(root);
		if (skill.reason !== null && !skill.managed) throw new Error(skill.reason);
		if (isSetupCurrent(root)) return 0;
		const dependenciesCurrent = areDependenciesCurrent(root);
		const status = await runSetupUnlocked(
			root,
			dependenciesCurrent ? "setup-artifacts" : "setup-unlocked",
		);
		if (status === 0) {
			const skill = inspectSkillLink(root);
			if (skill.reason !== null) {
				rmSync(join(root, MARKER), { force: true });
				throw new Error(skill.reason);
			}
			const checked = inspectHooksPath(root);
			if (checked.reason !== null) throw new Error(checked.reason);
		}
		return status;
	} finally {
		lock.release();
	}
}

async function main(args) {
	if (args.length !== 1 || !["check", "run", "write"].includes(args[0])) {
		throw new Error("usage: setup-completion.mjs <check|run|write>");
	}
	if (args[0] === "check") {
		const hooks = inspectHooksPath();
		if (hooks.reason !== null) {
			console.error(hooks.reason);
			process.exitCode = 1;
			return;
		}
		const skill = inspectSkillLink(process.cwd());
		if (skill.reason !== null) {
			console.error(skill.reason);
			process.exitCode = 1;
			return;
		}
		process.exitCode = isSetupCurrent() ? 0 : 1;
		return;
	}
	if (args[0] === "write") {
		writeSetupMarker();
		return;
	}
	process.exitCode = await runSetup();
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	try {
		await main(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
