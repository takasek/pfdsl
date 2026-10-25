// Run after build: real Chromium/Monaco, not native chooser/filesystem/WebKit acceptance.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(
	new URL("../../vscode-extension/package.json", import.meta.url),
);
const { chromium } = require("playwright-core");
const outDir = await mkdtemp(join(tmpdir(), "pfdsl-goto-line-"));
let server;
let browser;
try {
	await build({
		root,
		logLevel: "error",
		build: { outDir, emptyOutDir: true },
		plugins: [
			{
				name: "goto-line-workspace-fixtures",
				transform(code, id) {
					if (id === join(root, "src/main.ts"))
						return `${code}
import * as navigationMonaco from "monaco-editor/editor/editor.api.js";
window.navigationWorkspace = {
 open: openDocument, active: () => active?.tab,
 tabs: () => [...opened].map(entry => entry.tab),
 editors: () => navigationMonaco.editor.getEditors(),
};`;
				},
			},
		],
	});
	server = await preview({
		root,
		logLevel: "error",
		build: { outDir },
		preview: { host: "127.0.0.1", port: 0, strictPort: false },
	});
	browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({
		viewport: { width: 1180, height: 812 },
	});
	page.setDefaultTimeout(5000);
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(server.resolvedUrls.local[0]);
	await page.waitForFunction(() => !!window.navigationWorkspace);
	await page.evaluate(() => {
		for (const [index, folder] of ["red", "blue"].entries()) {
			const source = `# ${folder}\n# navigation\na >> p -> b\n`;
			window.navigationWorkspace.open("flow.pfdsl", source, {
				id: index + 1,
				path: `/work/${folder}/shared/flow.pfdsl`,
				source,
				revision: folder,
				identity: folder,
				binding: folder,
			});
		}
	});
	const input = page.locator(".quick-input-widget:visible input");
	const source = () =>
		page.evaluate(() =>
			window.navigationWorkspace.tabs().map((tab) => tab.getSource()),
		);
	const position = (index) =>
		page.evaluate((index) => {
			const p = window.navigationWorkspace.editors()[index].getPosition();
			return { lineNumber: p.lineNumber, column: p.column };
		}, index);
	const select = async (folder) => {
		await page
			.getByRole("tab", { name: `flow.pfdsl — ${folder}/shared`, exact: true })
			.click();
		await page.evaluate(() => window.navigationWorkspace.active().focus());
	};
	const open = async () => {
		await page.keyboard.press("Control+g");
		await input.waitFor({ state: "visible" });
	};
	const close = async (key) => {
		await page.keyboard.press(key);
		await input.waitFor({ state: "hidden" });
	};
	const originals = await source();
	// #1518's exact F1 -> edit/Undo -> other tab -> Ctrl+G/Escape sequence.
	await page.evaluate(() => window.navigationWorkspace.active().focus());
	await page.keyboard.press("F1");
	await input.fill(">Go to Line");
	await page
		.locator(".quick-input-widget:visible .monaco-list-row")
		.filter({ hasText: "Go to Line" })
		.first()
		.waitFor();
	await page.keyboard.press("Enter");
	await input.fill(":3:1");
	await close("Enter");
	assert.deepEqual(await position(1), { lineNumber: 3, column: 1 });
	await page.keyboard.type("changed_");
	assert.equal(
		(await source())[1],
		originals[1].replace("a >>", "changed_a >>"),
	);
	await page.evaluate(() =>
		window.navigationWorkspace.active().command("undo"),
	);
	assert.deepEqual(await source(), originals);
	await select("red");
	const before = await position(0);
	await open();
	await input.fill(":2:1");
	await close("Escape");
	assert.deepEqual(await position(0), before);
	console.log("PASS reported F1, edit/Undo, cross-tab Ctrl+G/Escape scenario");
	await page.evaluate(() =>
		window.navigationWorkspace.editors()[0].setSelection({
			startLineNumber: 1,
			startColumn: 1,
			endLineNumber: 2,
			endColumn: 3,
		}),
	);
	const selections = () =>
		page.evaluate(() =>
			window.navigationWorkspace
				.editors()
				.map((editor) => editor.getSelection().toString()),
		);
	for (let attempt = 0; attempt < 40; attempt++) {
		const folder = attempt % 2 ? "red" : "blue";
		const index = attempt % 2 ? 0 : 1;
		await select(folder);
		const before = await position(index);
		const selected = await selections();
		await open();
		await input.fill(":2:1");
		await close("Escape");
		assert.deepEqual(await position(index), before);
		assert.deepEqual(await source(), originals);
		assert.deepEqual(await selections(), selected);
	}
	console.log(
		"PASS 40 alternating cancellations preserve both documents and positions",
	);
	await select("blue");
	await page.evaluate(() =>
		window.navigationWorkspace.active().command("redo"),
	);
	assert.equal(
		(await source())[1],
		originals[1].replace("a >>", "changed_a >>"),
	);
	await page.evaluate(() =>
		window.navigationWorkspace.active().command("undo"),
	);
	assert.deepEqual(await source(), originals);
	await select("red");
	const invalidBefore = await position(0);
	await open();
	await input.fill(":invalid");
	await close("Escape");
	assert.deepEqual(await position(0), invalidBefore);
	await open();
	await input.fill(":999:999");
	await close("Enter");
	assert.deepEqual(await position(0), { lineNumber: 4, column: 1 });
	await open();
	await input.fill(":3:999");
	await close("Enter");
	assert.deepEqual(await position(0), { lineNumber: 3, column: 12 });
	assert.deepEqual(await source(), originals);
	console.log(
		"PASS invalid input cancellation and standard out-of-range clamping",
	);
	// Exercise provider changes and existing F1 navigation in the same picker.
	await page.keyboard.press("F1");
	await input.fill(":2:2");
	await close("Enter");
	assert.deepEqual(await position(0), { lineNumber: 2, column: 2 });
	await open();
	await input.fill(">Go to Line");
	await page
		.locator(".quick-input-widget:visible .monaco-list-row")
		.filter({ hasText: "Go to Line" })
		.first()
		.waitFor();
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowUp");
	await close("Escape");
	console.log(
		"PASS F1/prefix transitions and command candidate keyboard navigation",
	);
	await open();
	await input.fill(":2:1");
	await select("blue");
	await input.waitFor({ state: "hidden" });
	await select("red");
	await input.waitFor({ state: "hidden" });
	assert.deepEqual(await source(), originals);
	// Existing Find is an independent widget and must keep its Escape behavior.
	await page.evaluate(() =>
		window.navigationWorkspace.active().command("actions.find"),
	);
	await page.waitForFunction(
		() =>
			document
				.querySelector('.document:not([style*="none"]) .find-widget')
				?.getAttribute("aria-hidden") === "false",
	);
	await page.keyboard.press("Escape");
	await page.waitForFunction(
		() =>
			document
				.querySelector('.document:not([style*="none"]) .find-widget')
				?.getAttribute("aria-hidden") === "true",
	);
	assert.deepEqual(await source(), originals);
	const retainedSelections = await selections();
	// A clean, unsaved tab exercises disposal without native inspect_document calls.
	await page.evaluate(() =>
		window.navigationWorkspace.open("Closing", "# closing\na >> p -> b\n"),
	);
	await page.evaluate(() => window.navigationWorkspace.active().focus());
	await open();
	await input.fill(":1:1");
	await page
		.getByRole("button", { name: "Close Closing", exact: true })
		.click();
	await page.waitForFunction(
		() => window.navigationWorkspace.tabs().length === 2,
	);
	await input.waitFor({ state: "hidden" });
	assert.deepEqual(await source(), originals);
	assert.deepEqual(await selections(), retainedSelections);
	assert.deepEqual(errors, []);
	console.log(
		"PASS tab-switch/close cancellation and existing Find/Escape; no page errors",
	);
} finally {
	await browser?.close();
	if (server) await new Promise((resolve) => server.httpServer.close(resolve));
	await rm(outDir, { recursive: true, force: true });
}
