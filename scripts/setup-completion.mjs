#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { isCliEntrypoint } from "./lib/cli-entrypoint.mjs";

export const SETUP_INPUTS = [
	".npmrc",
	".pnpmfile.cjs",
	"Makefile",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"scripts/hooks/pre-commit-shim",
	"scripts/lib/cli-entrypoint.mjs",
	"scripts/link-repo-skill.mjs",
	"scripts/setup-completion.mjs",
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

export function isSetupCurrent(root = process.cwd()) {
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

function runSetupUnlocked(root) {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(
			"make",
			["-f", join(root, "Makefile"), "setup-unlocked"],
			{ cwd: root, stdio: "inherit" },
		);
		child.once("error", rejectRun);
		child.once("close", (status) => resolveRun(status ?? 1));
	});
}

async function runSetup(root = process.cwd()) {
	const lock = await acquireSetupLock(root);
	try {
		if (isSetupCurrent(root)) return 0;
		return await runSetupUnlocked(root);
	} finally {
		lock.release();
	}
}

async function main(args) {
	if (args.length !== 1 || !["check", "run", "write"].includes(args[0])) {
		throw new Error("usage: setup-completion.mjs <check|run|write>");
	}
	if (args[0] === "check") {
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
