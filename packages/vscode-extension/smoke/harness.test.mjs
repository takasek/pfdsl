import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createRunDirectory,
	findWebviewFrame,
	makeLaunchArgs,
	parseTransform,
	removeRunDirectory,
} from "./harness.mjs";
import {
	assertVisibleCount,
	resolveVSCodeExecutablePath,
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
	const page = { url: () => "workbench.html" };
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
