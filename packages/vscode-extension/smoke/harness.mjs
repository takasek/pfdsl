import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

const runDirectoryPrefix = `${resolve(tmpdir())}${sep}pfdsl-vscode-smoke-`;
const issuedRunDirectories = new Set();

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

export async function removeRunDirectory(path) {
	const target = resolve(path);
	if (!issuedRunDirectories.has(target)) {
		throw new Error(`Refusing to remove non-run directory: ${path}`);
	}
	await rm(target, { recursive: true, force: true });
	issuedRunDirectories.delete(target);
}
