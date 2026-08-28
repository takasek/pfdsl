import {
	access,
	mkdir,
	mkdtemp,
	rm,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

const runDirectoryPrefix = `${resolve(tmpdir())}${sep}pfdsl-vscode-smoke-`;
const issuedRunDirectories = new Set();
const cacheLockName = ".pfdsl-vscode-smoke-download.lock";
export const cacheLockWaitTimeoutMs = 8 * 60_000;
const cacheLockHeartbeatIntervalMs = 5_000;
const defaultStaleCacheLockMs = 15 * 60_000;

export function makeVSCodeCachePath(
	repoRoot,
	{ temporaryDirectory = tmpdir() } = {},
) {
	return join(
		resolve(temporaryDirectory),
		"pfdsl-vscode-smoke-cache",
		basename(resolve(repoRoot)),
	);
}

export async function prepareVSCodeCachePath(repoRoot, options) {
	const cachePath = makeVSCodeCachePath(repoRoot, options);
	await mkdir(cachePath, { recursive: true });
	return cachePath;
}

export function makeVSCodeCacheLockPath(cachePath) {
	return join(cachePath, cacheLockName);
}

function makeVSCodeCacheMarkerPath(cachePath, version) {
	return join(cachePath, `.pfdsl-vscode-smoke-${version}.complete`);
}

async function cacheMarkerExists(markerPath) {
	try {
		await access(markerPath);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
}

function delay(milliseconds) {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function populateVSCodeCache(
	cachePath,
	version,
	populate,
	{
		clearIntervalFn = clearInterval,
		heartbeatIntervalMs = cacheLockHeartbeatIntervalMs,
		now = () => Date.now(),
		retryIntervalMs = 100,
		setIntervalFn = setInterval,
		staleLockMs = defaultStaleCacheLockMs,
		timeoutMs = cacheLockWaitTimeoutMs,
		wait = delay,
	} = {},
) {
	await mkdir(cachePath, { recursive: true });
	const markerPath = makeVSCodeCacheMarkerPath(cachePath, version);
	if (await cacheMarkerExists(markerPath)) return null;
	const lockPath = makeVSCodeCacheLockPath(cachePath);
	const startedAt = now();
	while (true) {
		try {
			await mkdir(lockPath);
			break;
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
			let lockStatus;
			try {
				lockStatus = await stat(lockPath);
			} catch (statError) {
				if (statError?.code === "ENOENT") continue;
				throw statError;
			}
			const ageMs = now() - lockStatus.mtimeMs;
			if (ageMs >= staleLockMs) {
				throw new Error(
					`stale VS Code cache lock at ${lockPath}: ${Math.floor(ageMs)}ms old`,
				);
			}
			if (now() - startedAt >= timeoutMs) {
				throw new Error(
					`timed out waiting for VS Code cache lock at ${lockPath}`,
				);
			}
			await wait(retryIntervalMs);
		}
	}
	const heartbeat = async () => {
		try {
			const timestamp = new Date(now());
			await utimes(lockPath, timestamp, timestamp);
		} catch {
			// A missing or unwritable lock stops refreshing and lets waiters fail closed.
		}
	};
	let heartbeatTimer;
	try {
		await writeFile(
			join(lockPath, "owner.json"),
			`${JSON.stringify({ pid: process.pid, startedAt: now() })}\n`,
		);
		await heartbeat();
		heartbeatTimer = setIntervalFn(heartbeat, heartbeatIntervalMs);
		if (await cacheMarkerExists(markerPath)) return null;
		const result = await populate();
		await writeFile(markerPath, `${version}\n`);
		return result;
	} finally {
		if (heartbeatTimer !== undefined) clearIntervalFn(heartbeatTimer);
		await rm(lockPath, { recursive: true, force: true });
	}
}

export async function createRunDirectory() {
	const runDirectory = await mkdtemp(runDirectoryPrefix);
	issuedRunDirectories.add(resolve(runDirectory));
	return runDirectory;
}

export function makeLaunchArgs({
	repoRoot,
	profileDir,
	extensionsDir,
	port,
	fixturePath,
}) {
	return [
		"--new-window",
		"--skip-welcome",
		"--disable-workspace-trust",
		`--user-data-dir=${profileDir}`,
		`--extensions-dir=${extensionsDir}`,
		`--remote-debugging-port=${port}`,
		`--extensionDevelopmentPath=${repoRoot}/packages/vscode-extension`,
		fixturePath,
	];
}

export async function findWebviewFrame(page) {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		for (const frame of page.frames()) {
			if (!frame.url().startsWith("vscode-webview://")) continue;
			if ((await frame.locator("#root").count()) > 0) return frame;
		}
		await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));
	}
	throw new Error(
		"Timed out waiting for a vscode-webview frame containing #root",
	);
}

export function parseTransform(value) {
	const match =
		/^translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)$/.exec(value);
	if (!match) throw new Error(`Unexpected preview transform: ${value}`);
	return {
		panX: Number(match[1]),
		panY: Number(match[2]),
		scale: Number(match[3]),
	};
}

export async function readTransform(frame) {
	return parseTransform(
		await frame.locator("#inner").evaluate((inner) => inner.style.transform),
	);
}

export async function expectEventually(
	label,
	read,
	predicate,
	{ timeoutMs = 1_000, retryIntervalMs = 20 } = {},
) {
	const deadline = performance.now() + timeoutMs;
	let lastObserved;
	do {
		lastObserved = await read();
		if (predicate(lastObserved)) return lastObserved;
		await new Promise((resolveTimer) =>
			setTimeout(resolveTimer, retryIntervalMs),
		);
	} while (performance.now() < deadline);
	throw new Error(
		`${label}: condition was not met; last observed: ${JSON.stringify(lastObserved)}`,
	);
}

export async function removeRunDirectory(path) {
	const target = resolve(path);
	if (!issuedRunDirectories.has(target)) {
		throw new Error(`Refusing to remove non-run directory: ${path}`);
	}
	await rm(target, { recursive: true, force: true });
	issuedRunDirectories.delete(target);
}
