import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createRunDirectory,
	expectEventually,
	findWebviewFrame,
	makeLaunchArgs,
	parseTransform,
	readTransform,
	removeRunDirectory,
} from "./harness.mjs";
import {
	appendCleanupDiagnostics,
	assertVisibleCount,
	cleanupSmokeSession,
	resolveVSCodeExecutablePath,
	waitForVisibleCount,
	waitForWorkbenchPage,
} from "./run.mjs";

test("makeLaunchArgs isolates the run and opens the fixture", () => {
	assert.deepEqual(
		makeLaunchArgs({
			repoRoot: "/repo",
			profileDir: "/tmp/profile",
			extensionsDir: "/tmp/extensions",
			port: 9337,
			fixturePath: "/repo/docs/samples/01-simple-chain.pfdsl",
		}),
		[
			"--new-window",
			"--skip-welcome",
			"--disable-workspace-trust",
			"--user-data-dir=/tmp/profile",
			"--extensions-dir=/tmp/extensions",
			"--remote-debugging-port=9337",
			"--extensionDevelopmentPath=/repo/packages/vscode-extension",
			"/repo/docs/samples/01-simple-chain.pfdsl",
		],
	);
});

test("parseTransform reads the webview translate and scale", () => {
	assert.deepEqual(parseTransform("translate(12.5px, -8px) scale(1.1)"), {
		panX: 12.5,
		panY: -8,
		scale: 1.1,
	});
});

test("expectEventually reports the last observed value", async () => {
	await assert.rejects(
		expectEventually(
			"scale changes",
			async () => 1,
			(value) => value > 1,
			{
				timeoutMs: 10,
			},
		),
		/scale changes.*last observed: 1/,
	);
});

test("readTransform reads the inline preview transform", async () => {
	const frame = {
		locator: (selector) => {
			assert.equal(selector, "#inner");
			return {
				evaluate: async (read) =>
					read({ style: { transform: "translate(12.5px, -8px) scale(1.1)" } }),
			};
		},
	};
	assert.deepEqual(await readTransform(frame), {
		panX: 12.5,
		panY: -8,
		scale: 1.1,
	});
});

test("findWebviewFrame ignores the outer and fake-empty frames", async () => {
	const frames = [
		{ url: () => "workbench.html", locator: () => ({ count: async () => 0 }) },
		{
			url: () => "vscode-webview://one/index.html",
			locator: () => ({ count: async () => 0 }),
		},
		{
			url: () => "vscode-webview://one/fake.html",
			locator: () => ({ count: async () => 1 }),
		},
	];
	assert.equal(await findWebviewFrame({ frames: () => frames }), frames[2]);
});

test("assertVisibleCount rejects an invisible preview element", async () => {
	const locator = {
		count: async () => 1,
		nth: () => ({ isVisible: async () => false }),
	};
	await assert.rejects(
		assertVisibleCount(locator, 1, "preview SVG"),
		/preview SVG: expected 1 visible element, observed 0/,
	);
});

test("waitForVisibleCount waits for the preview to render", async () => {
	let reads = 0;
	const locator = {
		count: async () => 1,
		nth: () => ({ isVisible: async () => reads++ > 0 }),
	};
	assert.equal(
		await waitForVisibleCount(locator, 1, "preview SVG", {
			retryIntervalMs: 0,
			timeoutMs: 100,
		}),
		1,
	);
});

test("resolveVSCodeExecutablePath handles recent macOS Code bundles", () => {
	const electronPath = "/tmp/Visual Studio Code.app/Contents/MacOS/Electron";
	const codePath = "/tmp/Visual Studio Code.app/Contents/MacOS/Code";
	assert.equal(
		resolveVSCodeExecutablePath(electronPath, {
			platform: "darwin",
			exists: (path) => path === codePath,
		}),
		codePath,
	);
});

test("waitForWorkbenchPage waits for the CDP workbench page", async () => {
	const page = {
		url: () =>
			"vscode-file://vscode-app/out/vs/code/electron-browser/workbench/workbench.html",
	};
	let reads = 0;
	const browser = {
		contexts: () => [{ pages: () => (reads++ === 0 ? [] : [page]) }],
	};
	assert.equal(
		await waitForWorkbenchPage(browser, {
			delay: async () => {},
			timeoutMs: 1_000,
		}),
		page,
	);
});

test("waitForWorkbenchPage ignores a non-workbench first page", async () => {
	const workbenchPage = {
		url: () =>
			"vscode-file://vscode-app/out/vs/code/electron-browser/workbench/workbench.html",
	};
	const browser = {
		contexts: () => [
			{
				pages: () => [
					{ url: () => "devtools://devtools/bundled/inspector.html" },
					workbenchPage,
				],
			},
		],
	};
	assert.equal(await waitForWorkbenchPage(browser), workbenchPage);
});

test("appendCleanupDiagnostics preserves the rendering diagnostic", () => {
	const primary = new Error(
		"preview SVG: expected 1 visible element, observed 0\nframe URLs: vscode-webview://preview\nstdout:\nextension host",
	);
	const combined = appendCleanupDiagnostics(primary, [
		new Error("remove run directory failed"),
	]);
	assert.match(combined.message, /preview SVG/);
	assert.match(combined.message, /vscode-webview:\/\/preview/);
	assert.match(combined.message, /remove run directory failed/);
});

test("cleanupSmokeSession removes the run directory after a browser cleanup failure", async () => {
	const runDir = await createRunDirectory();
	let closed;
	let killed = false;
	const vscodeProcess = {
		exitCode: null,
		signalCode: null,
		kill: () => {
			killed = true;
			vscodeProcess.exitCode = 0;
			closed();
		},
		once: (_event, callback) => {
			closed = callback;
		},
	};
	const errors = await cleanupSmokeSession({
		browser: {
			close: async () => Promise.reject(new Error("browser close failed")),
		},
		runDir,
		vscodeProcess,
	});
	assert.equal(errors.length, 1);
	assert.match(errors[0].message, /browser close failed/);
	assert.equal(killed, true);
	await assert.rejects(access(runDir), { code: "ENOENT" });
});

test("removeRunDirectory refuses an unissued lookalike path", async () => {
	const lookalike = await mkdtemp(join(tmpdir(), "pfdsl-vscode-smoke-"));
	await writeFile(join(lookalike, "keep.txt"), "keep");
	await assert.rejects(removeRunDirectory(lookalike), /non-run directory/);
	await access(join(lookalike, "keep.txt"));
	await rm(lookalike, { recursive: true, force: true });
});

test("removeRunDirectory removes an issued run directory", async () => {
	const runDirectory = await createRunDirectory();
	await writeFile(join(runDirectory, "owned.txt"), "owned");
	await removeRunDirectory(runDirectory);
	await assert.rejects(access(runDirectory), { code: "ENOENT" });
});
