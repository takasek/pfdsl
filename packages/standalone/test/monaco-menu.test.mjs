import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { closeDocuments, DocumentSession } from "../src/document-session.ts";

// Real installed Monaco modules; only CSS and unavailable DOM measurement are adapted.
test("the production document-tab entry loads real Monaco menu contributions", async (t) => {
	const packageRoot = fileURLToPath(new URL("../", import.meta.url));
	const temporary = mkdtempSync(
		join(packageRoot, "node_modules/.monaco-menu-"),
	);
	const dom = new JSDOM("<main></main>", {
		pretendToBeVisual: true,
		url: "http://localhost/",
	});
	const globals = [
		"window",
		"document",
		"navigator",
		"self",
		"customElements",
		"Element",
		"Node",
		"MouseEvent",
		"KeyboardEvent",
		"CSS",
		"HTMLElement",
		"HTMLCanvasElement",
		"MutationObserver",
		"ResizeObserver",
		"requestAnimationFrame",
		"cancelAnimationFrame",
	];
	const previous = new Map(
		globals.map((name) => [
			name,
			Object.getOwnPropertyDescriptor(globalThis, name),
		]),
	);
	try {
		dom.window.CSS = {
			escape: (text) =>
				String(text).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
		};
		dom.window.HTMLCanvasElement.prototype.getContext = () =>
			new Proxy(
				{
					measureText: (text) => ({
						width: text.length * 8,
						actualBoundingBoxLeft: 0,
						actualBoundingBoxRight: text.length * 8,
					}),
					getImageData: () => ({ data: new Uint8ClampedArray(4) }),
					createImageData: () => ({ data: new Uint8ClampedArray(4) }),
				},
				{ get: (object, key) => object[key] ?? (() => {}) },
			);
		dom.window.matchMedia = () => ({
			matches: false,
			addEventListener() {},
			removeEventListener() {},
			addListener() {},
			removeListener() {},
		});
		for (const name of globals)
			Object.defineProperty(globalThis, name, {
				value:
					name === "self"
						? dom.window
						: name === "ResizeObserver"
							? class {
									observe() {}
									unobserve() {}
									disconnect() {}
								}
							: name.endsWith("AnimationFrame")
								? dom.window[name].bind(dom.window)
								: dom.window[name],
				configurable: true,
			});
		const output = join(temporary, "host.mjs");
		await build({
			stdin: {
				contents: `
				import { createDocumentTab } from "./src/document-tab.ts";
				import * as monaco from "monaco-editor/editor/editor.api.js";
				import { EditorExtensionsRegistry } from "monaco-editor/editor/browser/editorExtensions.js";
				import { MenuId } from "monaco-editor/platform/actions/common/actions.js";
				export { createDocumentTab, monaco, EditorExtensionsRegistry, MenuId };
			`,
				resolveDir: packageRoot,
			},
			external: ["@pfdsl/editor", "@pfdsl/editor/*"],
			outfile: output,
			bundle: true,
			platform: "node",
			format: "esm",
			loader: { ".css": "empty" },
			logLevel: "silent",
		});
		const host = await import(pathToFileURL(output).href);

		async function withEditors(source, check) {
			const tabs = [];
			const create = () => {
				const tab = host.createDocumentTab({
					parent: document.querySelector("main"),
					key: `language-${tabs.length}`,
					name: "Language",
					source,
					path: null,
					read: async () => null,
					reportStatus() {},
				});
				tabs.push(tab);
				return host.monaco.editor.getEditors().at(-1);
			};
			try {
				await check(create, tabs);
			} finally {
				for (const tab of tabs) tab.dispose();
				await new Promise((resolve) => setImmediate(resolve));
			}
		}
		await t.test(
			"editing then undoing invalidates a pending close decision through the production tab",
			async () => {
				await withEditors("a >> p", async (create, tabs) => {
					const editor = create();
					const tab = tabs[0];
					const session = new DocumentSession(tab, null);
					tab.setSource("local >> p");
					let disposed = 0;
					const closed = await closeDocuments(
						[session],
						async () => {
							tab.setSource("newer >> p");
							await editor.getModel().undo();
							assert.equal(tab.getSource(), "local >> p");
							return "discard";
						},
						async () => assert.fail("Discard must not save"),
						() => {
							disposed++;
						},
					);
					assert.equal(closed, false);
					assert.equal(disposed, 0);
					assert.equal(session.isDirty(), true);
					assert.equal(tab.container.isConnected, true);
				});
			},
		);
		await t.test("document models use PFDSL square brackets", async () => {
			await withEditors("[a, b] >> p", async (create) => {
				const model = create().getModel();
				assert.equal(model.getLanguageId(), "pfdsl");
				assert.deepEqual(
					model.bracketPairs.matchBracket(new host.monaco.Position(1, 1)),
					[
						new host.monaco.Range(1, 1, 1, 2),
						new host.monaco.Range(1, 6, 1, 7),
					],
				);
			});
		});
		await t.test(
			"shared word rules recognize Unicode letters and numbers",
			() => {
				const { wordPattern } = JSON.parse(
					readFileSync(
						new URL(
							"../../vscode-extension/language-configuration.json",
							import.meta.url,
						),
						"utf8",
					),
				);
				const pattern =
					typeof wordPattern === "string"
						? new RegExp(wordPattern)
						: new RegExp(wordPattern.pattern, wordPattern.flags);
				assert.deepEqual(
					"[入力-data_2, 𐐀node, ٣] >> 処理 -> 結果!?".match(
						new RegExp(pattern.source, `${pattern.flags}g`),
					),
					["入力-data_2", "𐐀node", "٣", "処理", "-", "結果"],
				);
			},
		);
		await t.test("document word lookup uses PFDSL Unicode ranges", async () => {
			await withEditors("[入力-data_2, 𐐀node] >> 処理", async (create) => {
				const model = create().getModel();
				for (const [column, expected] of [
					[5, { word: "入力-data_2", startColumn: 2, endColumn: 11 }],
					[14, { word: "𐐀node", startColumn: 13, endColumn: 19 }],
					[21, null],
				]) {
					assert.deepEqual(
						model.getWordAtPosition({ lineNumber: 1, column }),
						expected,
					);
				}
				assert.deepEqual(
					model.getWordUntilPosition({ lineNumber: 1, column: 6 }),
					{
						word: "入力-d",
						startColumn: 2,
						endColumn: 6,
					},
				);
			});
		});
		await t.test(
			"word lookup survives edits containing incomplete quoted text",
			async () => {
				await withEditors("input >> process", async (create) => {
					const editor = create();
					editor.setValue('"未完-𐐀2');
					assert.deepEqual(
						editor.getModel().getWordAtPosition({ lineNumber: 1, column: 6 }),
						{
							word: "未完-𐐀2",
							startColumn: 2,
							endColumn: 8,
						},
					);
				});
			},
		);
		await t.test(
			"typing configured pairs autocloses and overtypes",
			async () => {
				await withEditors("", async (create) => {
					const editor = create();
					for (const [open, close] of [
						["[", "]"],
						['"', '"'],
					]) {
						editor.setValue("");
						editor.setPosition(new host.monaco.Position(1, 1));
						editor.trigger("keyboard", "type", { text: open });
						assert.equal(editor.getValue(), open + close);
						assert.equal(editor.getPosition().column, 2);
						editor.trigger("keyboard", "type", { text: close });
						assert.equal(editor.getValue(), open + close);
						assert.equal(editor.getPosition().column, 3);
					}
					editor.setValue("");
					editor.trigger("keyboard", "type", { text: "(" });
					assert.equal(editor.getValue(), "(");
				});
			},
		);
		await t.test(
			"configured pairs surround Unicode selections with Undo/Redo",
			async () => {
				await withEditors("成果𐐀", async (create) => {
					const editor = create();
					for (const [open, close] of [
						["[", "]"],
						['"', '"'],
					]) {
						editor.setValue("成果𐐀");
						editor.setSelection(new host.monaco.Selection(1, 1, 1, 5));
						editor.trigger("keyboard", "type", { text: open });
						assert.equal(editor.getValue(), `${open}成果𐐀${close}`);
						await editor.getModel().undo();
						assert.equal(editor.getValue(), "成果𐐀");
						await editor.getModel().redo();
						assert.equal(editor.getValue(), `${open}成果𐐀${close}`);
					}
				});
			},
		);
		await t.test(
			"line comments toggle through a real action and stay tab-local",
			async () => {
				const source = "a>>p->b\nc>>q->d\n";
				await withEditors(source, async (create) => {
					const editor = create();
					const other = create();
					editor.setSelection(new host.monaco.Selection(1, 1, 2, 9));
					const action = editor.getAction("editor.action.commentLine");
					assert.ok(
						action?.isSupported(),
						"the production entry loads the comment action",
					);
					await action.run();
					assert.equal(editor.getValue(), "# a>>p->b\n# c>>q->d\n");
					assert.equal(other.getValue(), source);
					await editor.getModel().undo();
					assert.equal(editor.getValue(), source);
					await editor.getModel().redo();
					await action.run();
					assert.equal(editor.getValue(), source);
				});
			},
		);
		await t.test("Shift+F10 has a controller and command", () => {
			const contributions =
				host.EditorExtensionsRegistry.getEditorContributions().map((c) => c.id);
			const actions = host.EditorExtensionsRegistry.getEditorActions().map(
				(a) => a.id,
			);
			assert.ok(contributions.includes("editor.contrib.contextmenu"));
			assert.ok(actions.includes("editor.action.showContextMenu"));
		});
		await t.test("F1 has the standalone command-palette action", () => {
			assert.ok(
				host.EditorExtensionsRegistry.getEditorActions().some(
					(a) => a.id === "editor.action.quickCommand",
				),
			);
		});
		await t.test(
			"the real editor exposes selection actions through its rendered context menu",
			async () => {
				const source = "a>>p->b\nc>>q->d\n";
				const tab = host.createDocumentTab({
					parent: dom.window.document.querySelector("main"),
					key: "real-menu",
					name: "Menu",
					source,
					path: null,
					read: async () => null,
					reportStatus() {},
				});
				const editor = host.monaco.editor.getEditors().at(-1);
				try {
					editor.layout({ width: 600, height: 400 });
					editor.setSelection(new host.monaco.Selection(1, 2, 1, 3));
					assert.ok(editor.getContribution("editor.contrib.contextmenu"));
					editor.focus();
					await editor.getAction("editor.action.showContextMenu").run();
					const contextRoot =
						editor.getDomNode().querySelector(".context-view") ??
						[...editor.getDomNode().querySelectorAll("*")]
							.map((element) =>
								element.shadowRoot?.querySelector(".context-view"),
							)
							.find(Boolean);
					const menu =
						dom.window.document.querySelector(".context-view") ?? contextRoot;
					assert.ok(menu, "actual Monaco context-view is rendered");
					assert.match(menu.textContent, /Format selection \(Flows\)/);
					assert.match(menu.textContent, /Format selection \(Flat\)/);
					// Invoke the actual MenuService action, not the test seam's addAction array.
					const controller = editor.getContribution(
						"editor.contrib.contextmenu",
					);
					const items = controller._getMenuActions(
						editor.getModel(),
						host.MenuId.EditorContext,
					);
					const flat = items.find((action) =>
						action.id.endsWith(":pfdsl.formatSelection.flat"),
					);
					assert.ok(flat?.enabled);
					await flat.run();
					assert.equal(editor.getValue(), "a >> p\np -> b\nc>>q->d\n");
					await editor.getModel().undo();
					assert.equal(editor.getValue(), source);
					await editor.getModel().redo();
					assert.equal(editor.getValue(), "a >> p\np -> b\nc>>q->d\n");
					editor.setPosition({ lineNumber: 1, column: 1 });
					assert.equal(
						editor.getAction("pfdsl.formatSelection.flat").isSupported(),
						false,
					);
					assert.ok(
						controller
							._getMenuActions(editor.getModel(), host.MenuId.EditorContext)
							.every((action) => !action.id.includes("pfdsl.formatSelection")),
					);
					const otherTab = host.createDocumentTab({
						parent: dom.window.document.querySelector("main"),
						key: "second-menu",
						name: "Second",
						source,
						path: null,
						read: async () => null,
						reportStatus() {},
					});
					const other = host.monaco.editor.getEditors().at(-1);
					try {
						other.setSelections([
							new host.monaco.Selection(1, 2, 1, 3),
							new host.monaco.Selection(2, 2, 2, 3),
						]);
						const actions = other
							.getContribution("editor.contrib.contextmenu")
							._getMenuActions(other.getModel(), host.MenuId.EditorContext);
						await actions
							.find((action) =>
								action.id.endsWith(":pfdsl.formatSelection.flat"),
							)
							.run();
						assert.equal(
							other.getValue(),
							"a >> p\np -> b\nc>>q->d\n",
							"only the primary selection is formatted",
						);
						assert.equal(
							editor.getValue(),
							"a >> p\np -> b\nc>>q->d\n",
							"other editor is unchanged",
						);
					} finally {
						otherTab.dispose();
					}
				} finally {
					tab.dispose();
					// Allow the product's already scheduled preview refresh to settle before closing DOM.
					await new Promise((resolve) => setImmediate(resolve));
				}
			},
		);
	} finally {
		for (const [name, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete globalThis[name];
		}
		dom.window.close();
		rmSync(temporary, { recursive: true, force: true });
	}
});
