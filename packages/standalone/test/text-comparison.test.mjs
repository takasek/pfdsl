import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build, JSDOM, root } from "./helpers/host-bundle.mjs";

test("comparison reveals the first computed change in both panes once, including empty sides", async () => {
	const temp = mkdtempSync(
		join(root, "packages/standalone/node_modules/.first-diff-"),
	);
	try {
		const output = join(temp, "comparison.mjs");
		await build({
			stdin: {
				contents: `export { createTextComparison } from "./src/text-comparison.ts"; export { instances } from "monaco-editor/editor/editor.api.js";`,
				resolveDir: join(root, "packages/standalone"),
			},
			outfile: output,
			bundle: true,
			platform: "node",
			format: "esm",
			plugins: [
				{
					name: "monaco",
					setup(builder) {
						builder.onResolve({ filter: /^monaco-editor\// }, () => ({
							path: "monaco",
							namespace: "fake",
						}));
						builder.onLoad({ filter: /.*/, namespace: "fake" }, () => ({
							contents: `
					export const instances = [];
					export const editor = {
					 createModel() { return { dispose() {} }; },
					 createDiffEditor() {
					  const instance = { changes: null, reveals: [], listeners: new Set(),
					   setModel() {}, getLineChanges() { return this.changes; },
					   onDidUpdateDiff(fn) { this.listeners.add(fn); return {dispose: () => this.listeners.delete(fn)}; },
					   getOriginalEditor() { return { revealLineInCenter: line => this.reveals.push(['original', line]) }; },
					   getModifiedEditor() { return { revealLineInCenter: line => this.reveals.push(['modified', line]) }; },
					   update(changes) { this.changes = changes; for (const fn of this.listeners) fn(); },
					   dispose() {},
					  }; instances.push(instance); return instance;
					 }
					};`,
						}));
					},
				},
			],
		});
		const module = await import(pathToFileURL(output).href);
		const dom = new JSDOM("<body></body>");
		for (const [change, expected] of [
			[
				{ originalStartLineNumber: 91, modifiedStartLineNumber: 96 },
				[
					["original", 91],
					["modified", 96],
				],
			],
			[
				{ originalStartLineNumber: 0, modifiedStartLineNumber: 1 },
				[
					["original", 1],
					["modified", 1],
				],
			],
			[
				{ originalStartLineNumber: 1, modifiedStartLineNumber: 0 },
				[
					["original", 1],
					["modified", 1],
				],
			],
		]) {
			const view = module.createTextComparison(
				dom.window.document.body,
				"local",
				"disk",
			);
			const editor = module.instances.at(-1);
			assert.deepEqual(editor.reveals, []);
			editor.update([
				change,
				{ originalStartLineNumber: 200, modifiedStartLineNumber: 201 },
			]);
			assert.deepEqual(editor.reveals, expected);
			editor.update([
				{ originalStartLineNumber: 300, modifiedStartLineNumber: 301 },
			]);
			assert.deepEqual(
				editor.reveals,
				expected,
				"later diff updates must not reset scrolling",
			);
			view.dispose();
			assert.equal(editor.listeners.size, 0);
		}
		const view = module.createTextComparison(
			dom.window.document.body,
			"same",
			"same",
		);
		const editor = module.instances.at(-1);
		editor.update([]);
		assert.deepEqual(editor.reveals, []);
		view.dispose();
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
