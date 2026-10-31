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

test("display names use the shortest distinguishing parent and retain path-less names", async () => {
	await bundle("display-name", /^unused$/, "", async ({ displayName }) => {
		const entries = [
			{ name: "flow.pfdsl", path: "/A/shared/flow.pfdsl" },
			{ name: "flow.pfdsl", path: "/B/shared/flow.pfdsl" },
			{ name: "flow.pfdsl", path: "/other/flow.pfdsl" },
			{ name: "unique.pfdsl", path: "/A/unique.pfdsl" },
			{ name: "Sample" },
			{ name: "Sample" },
		];
		assert.deepEqual(
			entries.map((entry) => displayName(entry, entries)),
			[
				"flow.pfdsl — A/shared",
				"flow.pfdsl — B/shared",
				"flow.pfdsl — other",
				"unique.pfdsl",
				"Sample",
				"Sample",
			],
		);
	});
});

test("Open Recent labels files and folders, clears through dispatch and follows busy and empty state", async () => {
	globalThis.reviewMenuItems = [];
	try {
		await bundle(
			"native-menu",
			/^@tauri-apps\/api\/menu$/,
			menuStub,
			async ({ installNativeMenu }) => {
				const actions = [],
					opened = [],
					errors = [];
				const menu = await installNativeMenu(
					(id) => actions.push(id),
					(target) => opened.push(target),
					(error) => errors.push(error),
				);
				const flush = async () => {
					for (let i = 0; i < 1000; i++) await Promise.resolve();
				};
				const state = {
					busy: false,
					document: false,
					save: true,
					folder: false,
					sidebar: false,
					diagram: false,
					definition: false,
				};
				menu.update(state);
				menu.recent([]);
				await flush();
				const recent = globalThis.reviewMenuItems.find(
					(item) => item.text === "Open Recent",
				);
				assert.ok(recent);
				assert.equal(recent.children.at(-1).text, "Clear Menu");
				assert.equal(recent.children.at(-1).enabled, false);
				const targets = [
					{ kind: "file", path: "/A/shared/a.pfdsl" },
					{ kind: "file", path: "/B/shared/a.pfdsl" },
					{ kind: "folder", path: "/A/work" },
					{ kind: "folder", path: "/B/work" },
					{ kind: "file", path: "/A/work" },
				];
				menu.recent(targets);
				await flush();
				assert.deepEqual(
					recent.children.slice(0, -2).map((item) => item.text),
					[
						"a.pfdsl — A/shared",
						"a.pfdsl — B/shared",
						"work (Folder) — A",
						"work (Folder) — B",
						"work",
					],
				);
				assert.equal(recent.children.at(-2).item, "Separator");
				const clear = recent.children.at(-1);
				assert.equal(clear.id, "clear-recent");
				assert.equal(clear.enabled, true);
				recent.children[1].action();
				assert.deepEqual(opened, [targets[1]]);
				clear.action();
				assert.deepEqual(actions, ["clear-recent"]);
				menu.update({ ...state, busy: true });
				await flush();
				assert.equal(clear.enabled, false);
				menu.update(state);
				await flush();
				assert.equal(clear.enabled, true);
				menu.recent([]);
				await flush();
				assert.equal(recent.children.at(-1).enabled, false);
				assert.deepEqual(errors, []);
				menu.dispose();
			},
		);
	} finally {
		delete globalThis.reviewMenuItems;
	}
});

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

test("native menu reaches export, navigation, problems and comparison from the menu bar", async () => {
	globalThis.reviewMenuItems = [];
	try {
		await bundle(
			"native-menu",
			/^@tauri-apps\/api\/menu$/,
			menuStub,
			async ({ installNativeMenu }) => {
				const actions = [];
				const menu = await installNativeMenu(
					(id) => actions.push(id),
					() => {},
					(error) => assert.fail(String(error)),
				);
				const flush = async () => {
					for (let i = 0; i < 500; i++) await Promise.resolve();
				};
				const all = globalThis.reviewMenuItems;
				const app = all.find((x) => x.appMenu);
				const submenu = (parent, text) =>
					parent.children.find((x) => x.text === text);
				const ids = (parent) =>
					parent.children.map((x) => x.id).filter(Boolean);
				const exportMenu = submenu(submenu(app, "File"), "Export");
				assert.deepEqual(ids(exportMenu), [
					"pfdsl.export.dot",
					"pfdsl.export.svg",
					"pfdsl.export.pdf",
					"pfdsl.export.png",
					"pfdsl.export.tsv",
					"pfdsl.export.all",
				]);
				const go = submenu(app, "Go");
				assert.deepEqual(ids(go), [
					"editor.action.gotoLine",
					"editor.action.revealDefinition",
					"pfdsl.nextNodeOccurrence",
					"pfdsl.previousNodeOccurrence",
					"pfdsl.findAll",
					"first-problem",
					"editor.action.marker.next",
					"editor.action.marker.prev",
				]);
				const compare = submenu(submenu(app, "View"), "Compare Structure");
				assert.deepEqual(ids(compare), [
					"pfdsl.compareFile",
					"pfdsl.compareGit",
					"pfdsl.clearDiff",
				]);
				// WebView and Monaco own these keys; the label names them instead.
				for (const item of [
					...exportMenu.children,
					...go.children,
					...compare.children,
				])
					assert.equal(item.accelerator, undefined, item.id);
				assert.match(
					go.children.find((x) => x.id === "editor.action.marker.next").text,
					/\(F8\)$/,
				);
				const item = (id) => all.find((x) => x.id === id);
				menu.update({
					busy: false,
					document: false,
					save: false,
					folder: false,
					sidebar: false,
					diagram: false,
					definition: false,
				});
				await flush();
				for (const id of [
					"pfdsl.export.svg",
					"first-problem",
					"pfdsl.compareGit",
				])
					assert.equal(item(id).enabled, false, id);
				menu.update({
					busy: false,
					document: true,
					save: true,
					folder: false,
					sidebar: false,
					diagram: true,
					definition: false,
				});
				await flush();
				for (const id of [
					"pfdsl.export.svg",
					"first-problem",
					"pfdsl.compareGit",
				])
					assert.equal(item(id).enabled, true, id);
				item("editor.action.marker.next").action();
				assert.deepEqual(actions, ["editor.action.marker.next"]);
			},
		);
	} finally {
		delete globalThis.reviewMenuItems;
	}
});

const comparisonStub = `export const editor={createModel(value){const model={value,dispose(){this.disposed=true}};(globalThis.comparisonModels??=[]).push(model);return model},createDiffEditor(element,options){globalThis.diffEditor={element,options,setModel(models){this.models=models},dispose(){this.disposed=true}};return globalThis.diffEditor}};`;
test("native menu skips unchanged properties and coalesces states arriving during an update", async () => {
	globalThis.reviewMenuItems = [];
	try {
		await bundle(
			"native-menu",
			/^@tauri-apps\/api\/menu$/,
			menuStub,
			async ({ installNativeMenu }) => {
				const errors = [];
				const menu = await installNativeMenu(
					() => {},
					() => {},
					(error) => errors.push(error),
				);
				const flush = async () => {
					for (let i = 0; i < 5000; i++) await Promise.resolve();
				};
				const state = {
					busy: false,
					document: true,
					save: true,
					folder: false,
					sidebar: false,
					diagram: true,
					definition: false,
				};
				const writes = () =>
					globalThis.reviewMenuItems.reduce(
						(sum, item) => sum + item.writes.length,
						0,
					);
				menu.update(state);
				await flush();
				const before = writes();
				for (let i = 0; i < 20; i++) menu.update({ ...state });
				await flush();
				assert.equal(writes(), before);
				const first = globalThis.reviewMenuItems.find(
					(item) => item.id === "new",
				);
				const original = first.setEnabled.bind(first);
				let release,
					calls = 0;
				const held = new Promise((resolve) => {
					release = resolve;
				});
				first.setEnabled = async (value) => {
					calls++;
					if (!value) await held;
					await original(value);
				};
				menu.update({ ...state, busy: true });
				await Promise.resolve();
				for (let i = 0; i < 20; i++)
					menu.update({ ...state, document: i % 2 === 0 });
				menu.update({ ...state });
				release();
				await flush();
				assert.equal(calls, 2);
				assert.equal(
					globalThis.reviewMenuItems.find((item) => item.id === "save").enabled,
					true,
				);
				assert.deepEqual(errors, []);
				let releaseFailure;
				const failure = new Promise((resolve) => {
					releaseFailure = resolve;
				});
				first.setEnabled = async (value) => {
					if (!value) {
						await failure;
						throw new Error("native update failed");
					}
					await original(value);
				};
				menu.update({ ...state, busy: true });
				await Promise.resolve();
				menu.update({ ...state });
				releaseFailure();
				await flush();
				assert.equal(errors.length, 1);
				assert.match(String(errors[0]), /native update failed/);
				assert.equal(first.enabled, true);
				assert.equal(
					globalThis.reviewMenuItems.find((item) => item.id === "save").enabled,
					true,
				);
			},
		);
	} finally {
		delete globalThis.reviewMenuItems;
	}
});

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
