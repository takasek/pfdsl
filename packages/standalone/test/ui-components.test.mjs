import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build, JSDOM, menuStub, root } from "./helpers/host-bundle.mjs";

async function bundle(name, source, stub, run) {
	const temporary = mkdtempSync(join(tmpdir(), `pfdsl-1444-${name}-`));
	try {
		const file = join(temporary, "component.mjs");
		await build({
			entryPoints: [`${root}/packages/standalone/src/${name}.ts`],
			outfile: file,
			bundle: true,
			format: "esm",
			platform: "node",
			plugins: [
				{
					name: "component-seam",
					setup(b) {
						b.onResolve({ filter: source }, (args) => ({
							path: args.path,
							namespace: "seam",
						}));
						b.onLoad({ filter: /.*/, namespace: "seam" }, () => ({
							contents: stub,
						}));
					},
				},
			],
		});
		await run(await import(pathToFileURL(file).href));
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

test("native menu registers stable commands, applies document/busy/capability state and replaces recent items", async () => {
	globalThis.reviewMenuItems = [];
	try {
		await bundle(
			"native-menu",
			/^@tauri-apps\/api\/menu$/,
			menuStub,
			async ({ installNativeMenu }) => {
				const actions = [],
					errors = [];
				const menu = await installNativeMenu(
					(id) => actions.push(id),
					(target) => actions.push(target.path),
					(error) => errors.push(error),
				);
				const item = (id) =>
					globalThis.reviewMenuItems.find((x) => x.id === id);
				const flush = async () => {
					for (let i = 0; i < 500; i++) await Promise.resolve();
				};
				menu.update({
					busy: false,
					document: false,
					save: true,
					folder: false,
					sidebar: false,
					diagram: false,
					definition: false,
				});
				await flush();
				assert.equal(item("new").enabled, true);
				assert.equal(item("save").enabled, false);
				assert.equal(item("format").enabled, false);
				assert.equal(item("sidebar").enabled, false);
				assert.equal(item("save").accelerator, "CmdOrCtrl+S");
				assert.equal(item("format").text, "Format flows");
				assert.equal(item("format-flat").text, "Format flat");
				assert.equal(item("normalize").text, "Normalized edges");
				assert.equal(item("close-tab").accelerator, "CmdOrCtrl+W");
				menu.update({
					busy: false,
					document: true,
					save: false,
					folder: true,
					sidebar: true,
					diagram: true,
					definition: false,
				});
				await flush();
				assert.equal(item("save").enabled, false);
				assert.equal(item("format").enabled, true);
				assert.equal(item("sidebar").checked, true);
				assert.equal(item("create-definition").enabled, false);
				menu.update({
					busy: false,
					document: true,
					save: true,
					folder: true,
					sidebar: true,
					diagram: true,
					definition: true,
				});
				await flush();
				assert.equal(item("create-definition").enabled, true);
				item("format").action();
				assert.deepEqual(actions, ["format"]);
				menu.recent([{ kind: "file", path: "/A/one.pfdsl" }]);
				await flush();
				const old = item("recent-0");
				old.action();
				assert.equal(actions.at(-1), "/A/one.pfdsl");
				menu.recent([{ kind: "folder", path: "/B" }]);
				await flush();
				assert.equal(old.closed, true);
				menu.update({
					busy: true,
					document: true,
					save: true,
					folder: true,
					sidebar: true,
					diagram: true,
				});
				await flush();
				for (const id of [
					"new",
					"save",
					"format",
					"node-actions-toggle",
					"sidebar",
				])
					assert.equal(item(id).enabled, false, id);
				assert.deepEqual(errors, []);
			},
		);
	} finally {
		delete globalThis.reviewMenuItems;
	}
});

const comparisonStub = `export const editor={createModel(value){const model={value,dispose(){this.disposed=true}};(globalThis.comparisonModels??=[]).push(model);return model},createDiffEditor(element,options){globalThis.diffEditor={element,options,setModel(models){this.models=models},dispose(){this.disposed=true}};return globalThis.diffEditor}};`;
test("text comparison is read only, aligned, names both revisions and disposes every editor/model", async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
	const dom = new JSDOM("<main></main>");
	globalThis.document = dom.window.document;
	try {
		await bundle(
			"text-comparison",
			/^monaco-editor\//,
			comparisonStub,
			async ({ createTextComparison }) => {
				const comparison = createTextComparison(
					document.querySelector("main"),
					"old\n日本語\n",
					"new\n日本語\n",
				);
				assert.equal(globalThis.diffEditor.options.readOnly, true);
				assert.equal(globalThis.diffEditor.options.originalEditable, false);
				assert.equal(globalThis.diffEditor.options.renderIndicators, true);
				assert.equal(globalThis.diffEditor.options.renderSideBySide, true);
				assert.equal(
					globalThis.diffEditor.options.useInlineViewWhenSpaceIsLimited,
					false,
				);
				assert.equal(
					globalThis.diffEditor.models.original.value,
					"old\n日本語\n",
				);
				assert.equal(
					globalThis.diffEditor.models.modified.value,
					"new\n日本語\n",
				);
				assert.match(document.body.textContent, /Editor content/);
				assert.match(document.body.textContent, /Observed disk content/);
				comparison.dispose();
				assert.equal(globalThis.diffEditor.disposed, true);
				assert.ok(globalThis.comparisonModels.every((x) => x.disposed));
			},
		);
	} finally {
		if (previous) Object.defineProperty(globalThis, "document", previous);
		else delete globalThis.document;
		delete globalThis.diffEditor;
		delete globalThis.comparisonModels;
		dom.window.close();
	}
});
