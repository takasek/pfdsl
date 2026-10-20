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
		"DOMParser",
		"navigator",
		"self",
		"customElements",
		"Element",
		"Node",
		"MouseEvent",
		"UIEvent",
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
				import { StandaloneServices } from "monaco-editor/editor/standalone/browser/standaloneServices.js";
				import { ILanguageFeaturesService } from "monaco-editor/editor/common/services/languageFeatures.js";
				import { errorHandler } from "monaco-editor/base/common/errors.js";
				import { IBulkEditService } from "monaco-editor/editor/browser/services/bulkEditService.js";
				import { ICommandService } from "monaco-editor/platform/commands/common/commands.js";
				import { IOpenerService } from "monaco-editor/platform/opener/common/opener.js";
				import { renderMarkdown } from "monaco-editor/base/browser/markdownRenderer.js";
				errorHandler.unexpectedErrorHandler = error => { throw error; };
				const languageFeatures = StandaloneServices.get(ILanguageFeaturesService);
				const applyEdit = edit => StandaloneServices.get(IBulkEditService).apply(edit);
				const execute = (id, ...args) => StandaloneServices.get(ICommandService).executeCommand(id, ...args);
				const openLink = url => StandaloneServices.get(IOpenerService).open(url);
				export { createDocumentTab, monaco, EditorExtensionsRegistry, MenuId, languageFeatures, applyEdit, execute, openLink, renderMarkdown };
			`,
				resolveDir: packageRoot,
			},
			external: ["@pfdsl/core", "@pfdsl/editor", "@pfdsl/editor/*"],
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
			const create = (options = {}) => {
				const tab = host.createDocumentTab({
					parent: document.querySelector("main"),
					key: `language-${tabs.length}`,
					name: "Language",
					source,
					path: null,
					read: async () => null,
					reportStatus() {},
					...options,
				});
				tabs.push(tab);
				return host.monaco.editor.getEditors().at(-1);
			};
			try {
				await check(create, tabs);
			} finally {
				for (const tab of tabs) tab.dispose();
				for (const panel of document.querySelectorAll(".export-results"))
					panel.remove();
				await new Promise((resolve) => setImmediate(resolve));
			}
		}
		await t.test(
			"structural comparison and whole-graph export coexist in the same tab",
			async () => {
				const source =
					'---\nartifact: {a: {label: Before, location: "child.pfdsl"}}\n---\na >> p -> b\n';
				await withEditors(source, async (create, tabs) => {
					const saved = [];
					const editor = create({
						referenceServices: {
							context: async () => "/work/a.pfdsl",
							inspect: async () => "file",
							list: async () => [],
							open: async () => {},
							run: async () => {},
							compareFile: async () => ({ source, label: "Baseline" }),
							compareGit: async () => ({ source, label: "HEAD" }),
						},
						exportServices: {
							choose: async () => ({ id: 9 }),
							write: async (_id, format, bytes) => {
								saved.push(new TextDecoder().decode(bytes));
								return `/chosen/a.${format}`;
							},
							release: async () => {},
							pdf: async () => new Uint8Array(),
						},
					});
					tabs[0].setSource(source.replace("Before", "After"));
					await editor.getAction("pfdsl.compareFile").run();
					const panel = tabs[0].container.querySelector("#diff-panel");
					assert.match(panel.textContent, /~ node.*a/);
					const diff = panel.textContent,
						revision = editor.getModel().getVersionId();
					await editor.getAction("pfdsl.export.dot").run();
					assert.equal(panel.textContent, diff);
					assert.equal(editor.getModel().getVersionId(), revision);
					assert.match(saved[0], /After/);
					assert.ok(!saved[0].includes("diff-added"));
					await editor.getAction("pfdsl.clearDiff").run();
					await editor.getAction("pfdsl.export.dot").run();
					assert.equal(saved.length, 2);
					assert.equal(
						tabs[0].container.querySelector(".reference-comparison").hidden,
						true,
					);
					editor.trigger("coexist-test", "undo", null);
					assert.equal(editor.getValue(), source);
				});
			},
		);
		await t.test(
			"export actions capture the unsaved document and show actual partial outcomes without changing Undo",
			async () => {
				const source =
					"---\nartifact: {a: {label: Before}}\n---\na >> p -> b\n";
				await withEditors(source, async (create, tabs) => {
					const saved = [],
						released = [];
					let cancel = false;
					const editor = create({
						exportServices: {
							choose: async () => (cancel ? null : { id: 7 }),
							write: async (_id, format, bytes) => {
								saved.push([format, new TextDecoder().decode(bytes)]);
								return `/chosen/日本語.${format}`;
							},
							release: async (id) => released.push(id),
							pdf: async () => {
								throw new Error("PDF unavailable");
							},
						},
					});
					tabs[0].setSource(source.replace("Before", "After"));
					const revision = editor.getModel().getVersionId();
					await editor.getAction("pfdsl.export.all").run();
					assert.equal(editor.getModel().getVersionId(), revision);
					assert.deepEqual(
						saved.map(([format]) => format),
						["dot", "svg", "tsv"],
					);
					assert.ok(saved.every(([, value]) => value.includes("After")));
					const panel = document.querySelector(".export-results");
					assert.match(panel.textContent, /DOT: Saved \/chosen\/日本語.dot/);
					assert.match(
						panel.textContent,
						/PDF: conversion-failed:.*PDF unavailable/,
					);
					assert.deepEqual(released, [7]);
					cancel = true;
					await editor.getAction("pfdsl.export.dot").run();
					assert.equal(saved.length, 3);
					await editor.trigger("export-test", "undo", null);
					assert.equal(editor.getValue(), source);
				});
			},
		);
		await t.test(
			"compact arrows and an unfinished quoted ID recover according to the lexer",
			async () => {
				for (const source of ["a>>p->b", "a-b>>p-q->b-c"]) {
					const tokens = host.monaco.editor.tokenize(source, "pfdsl")[0];
					for (const arrow of [">>", "->"]) {
						const offset = source.indexOf(arrow);
						assert.ok(
							tokens.some(
								(token) =>
									token.offset === offset &&
									token.type.includes("keyword.operator"),
							),
							`${source}: ${arrow} must retain its own operator token`,
						);
					}
				}
			},
		);
		await t.test("unfinished quoted IDs stop at their line boundary", () => {
			for (const quoted of ['"', '"oops', '"oops\\', '"oops\\x']) {
				for (const gap of ["\n", "\n\n"]) {
					const lines = host.monaco.editor.tokenize(
						`${quoted}${gap}a >> p -> "b" # note`,
						"pfdsl",
					);
					const following = lines.at(-1);
					assert.ok(
						following.some((token) => token.type.includes("keyword.operator")),
						"an unterminated ID cannot turn the following flow line into a string",
					);
					assert.ok(following.some((token) => token.type.includes("comment")));
				}
			}
		});
		await t.test(
			"PFDSL syntax distinguishes frontmatter, body arrows, Unicode IDs and comments",
			async () => {
				const lines = host.monaco.editor.tokenize(
					'---\nartifact:\n  "入力": {label: "Input"}\n---\n[入力, b] >>? 処理 -> c # note',
					"pfdsl",
				);
				assert.ok(lines[1].some((token) => /type/.test(token.type)));
				assert.ok(lines[4].some((token) => /keyword/.test(token.type)));
				assert.ok(lines[4].some((token) => /comment/.test(token.type)));
				assert.ok(lines[4].some((token) => /variable/.test(token.type)));
			},
		);
		await t.test(
			"language providers use semantic quoted keys, show metadata, and isolate tabs",
			async () => {
				const source =
					'---\nartifact:\n  "入力": {label: Input, owner: Team}\nprocess:\n  p: {command: "echo hello"}\n---\n入力 >> p -> 出力\n入力 >> p\n';
				await withEditors(source, async (create, tabs) => {
					const editor = create();
					const other = create();
					const model = editor.getModel();
					const position = { lineNumber: 7, column: 1 };
					const token = {
						isCancellationRequested: false,
						onCancellationRequested() {
							return { dispose() {} };
						},
					};
					const providers = (kind) =>
						host.languageFeatures[kind].ordered(model);
					assert.ok(editor.getContribution("editor.contrib.contentHover"));
					assert.ok(
						editor.getContribution("editor.contrib.codeActionController"),
						JSON.stringify(
							host.EditorExtensionsRegistry.getEditorContributions().map(
								(entry) => entry.id,
							),
						),
					);
					assert.ok(editor.getContribution("editor.contrib.InlayHints"));
					const hover = (
						await Promise.all(
							providers("hoverProvider").map((p) =>
								p.provideHover(model, position, token),
							),
						)
					).find(Boolean);
					assert.match(
						hover.contents.map((c) => c.value).join("\n"),
						/Input[\s\S]*owner[\s\S]*Team/,
					);
					const definition = (
						await Promise.all(
							providers("definitionProvider").map((p) =>
								p.provideDefinition(model, position, token),
							),
						)
					)
						.flat()
						.filter(Boolean);
					assert.equal(definition[0].range.startLineNumber, 3);
					const fields = { lineNumber: 3, column: 16 };
					assert.ok(
						(
							await Promise.all(
								providers("hoverProvider").map((p) =>
									p.provideHover(model, fields, token),
								),
							)
						).every((h) => !h),
					);
					const hints = (
						await Promise.all(
							providers("inlayHintsProvider").map((p) =>
								p.provideInlayHints(model, model.getFullModelRange(), token),
							),
						)
					).filter(Boolean);
					assert.equal(hints.flatMap((h) => h.hints).length, 1);
					editor.setPosition(position);
					await editor.getAction("pfdsl.jumpToDefinition").run();
					assert.equal(editor.getSelection().startLineNumber, 3);
					await editor.getAction("pfdsl.nextNodeOccurrence").run();
					assert.equal(editor.getSelection().startLineNumber, 7);
					await editor.getAction("pfdsl.previousNodeOccurrence").run();
					assert.equal(editor.getSelection().startLineNumber, 3);
					await editor.getAction("pfdsl.findAll").run();
					assert.equal(
						editor.getContribution("editor.contrib.findController").getState()
							.searchString,
						"入力",
					);
					assert.equal(other.getValue(), source);
					tabs[0].dispose();
					assert.equal(
						host.languageFeatures.hoverProvider.ordered(other.getModel())
							.length > 0,
						true,
					);
				});
			},
		);
		await t.test(
			"Quick Fix and sort act on real Monaco models with Undo and unchanged failure",
			async () => {
				await withEditors("a >> p -> b\n", async (create) => {
					const editor = create();
					const other = create();
					const model = editor.getModel();
					editor.setPosition({ lineNumber: 1, column: 1 });
					await editor.getAction("pfdsl.insertDefinition").run();
					assert.match(editor.getValue(), /artifact:[\s\S]*a:[\s\S]*label:/);
					assert.equal(model.getValueInRange(editor.getSelection()), "");
					await model.undo();
					assert.equal(editor.getValue(), "a >> p -> b\n");
					await model.redo();
					assert.equal(other.getValue(), "a >> p -> b\n");
					editor.setValue(
						"---\nartifact:\n  b: {label: B} # keep\n  a: {label: A}\n---\na >> p -> b\n",
					);
					const unsorted = editor.getValue();
					await editor.getAction("pfdsl.sort.id").run();
					assert.ok(
						editor.getValue().indexOf("a:") < editor.getValue().indexOf("b:"),
					);
					assert.match(editor.getValue(), /# keep/);
					await model.undo();
					assert.equal(editor.getValue(), unsorted);
					editor.setValue("---\nartifact: [\n---\na >> p");
					const invalid = editor.getValue();
					await editor.getAction("pfdsl.sort.id").run();
					assert.equal(editor.getValue(), invalid);
				});
			},
		);
		await t.test(
			"code actions reject a stale model version and apply one undoable edit with label focus",
			async () => {
				await withEditors("a >> p -> b\r\n", async (create) => {
					const editor = create();
					const other = create();
					const model = editor.getModel();
					const token = {
						isCancellationRequested: false,
						onCancellationRequested() {
							return { dispose() {} };
						},
					};
					const actions = async () =>
						(
							await Promise.all(
								host.languageFeatures.codeActionProvider
									.ordered(model)
									.map((provider) =>
										provider.provideCodeActions(
											model,
											new host.monaco.Range(1, 11, 1, 12),
											{ trigger: 1 },
											token,
										),
									),
							)
						)
							.filter(Boolean)
							.flatMap((result) => result.actions);
					const stale = (await actions())[0];
					assert.ok(stale.edit);
					editor.executeEdits("typing", [
						{ range: new host.monaco.Range(1, 1, 1, 1), text: "new >> p\r\n" },
					]);
					const typed = editor.getValue();
					await assert.rejects(host.applyEdit(stale.edit), /changed|version/i);
					assert.equal(editor.getValue(), typed);
					editor.setValue("a >> p -> b\r\n");
					const fresh = (await actions())[0];
					await host.applyEdit(fresh.edit);
					await host.execute(fresh.command.id, ...fresh.command.arguments);
					assert.equal(model.getValueInRange(editor.getSelection()), "");
					const caret = model.getOffsetAt(
						editor.getSelection().getStartPosition(),
					);
					assert.equal(editor.getValue().slice(caret - 1, caret + 1), '""');
					assert.match(editor.getValue(), /a >> p -> b\r\n$/);
					assert.equal(other.getValue(), "a >> p -> b\r\n");
					await model.undo();
					assert.equal(editor.getValue(), "a >> p -> b\r\n");
					await model.redo();
					assert.match(editor.getValue(), /artifact:/);
				});
			},
		);
		await t.test(
			"metadata sort accepts ordered keys and cancellation keeps editor state",
			async () => {
				const source =
					"---\nartifact:\n  z: {label: Z, group: g}\n  b: {label: B, group: g}\n  a: {label: A, group: h}\ngroup:\n  g: {label: G}\n  h: {label: H}\n---\n[a, b] >> p -> z\n";
				await withEditors(source, async (create) => {
					const editor = create();
					await editor.getAction("pfdsl.sortMeta").run();
					let panel = editor
						.getContainerDomNode()
						.parentElement.querySelector(".metadata-sort");
					assert.ok(panel);
					panel.querySelector('[type="button"]').click();
					assert.equal(editor.getValue(), source);
					await editor.getAction("pfdsl.sortMeta").run();
					panel = editor
						.getContainerDomNode()
						.parentElement.querySelector(".metadata-sort");
					panel.querySelectorAll("select")[0].value = "group";
					panel.querySelectorAll("select")[1].value = "id";
					panel.dispatchEvent(
						new dom.window.Event("submit", { bubbles: true, cancelable: true }),
					);
					assert.ok(
						editor.getValue().indexOf("b:") < editor.getValue().indexOf("z:"),
					);
					assert.ok(
						editor.getValue().indexOf("z:") < editor.getValue().indexOf("a:"),
					);
					await editor.getModel().undo();
					assert.equal(editor.getValue(), source);
				});
			},
		);
		await t.test(
			"authored hover Markdown cannot acquire executable command trust",
			async () => {
				const source =
					'---\nartifact: {a: {label: "[Open documentation](command:fake-run)", description: "[More](command:fake-run)", location: "<command:autolink-run>"}}\nprocess: {p: {command: "printf marker"}}\n---\na >> p -> b\n';
				await withEditors(source, async (create) => {
					const editor = create({ referenceServices: {} });
					const model = editor.getModel();
					const hovers = await Promise.all(
						host.languageFeatures.hoverProvider
							.ordered(model)
							.map((p) =>
								p.provideHover(
									model,
									{ lineNumber: 5, column: 1 },
									{ isCancellationRequested: false },
								),
							),
					);
					const contents = hovers.filter(Boolean).flatMap((h) => h.contents);
					assert.ok(
						contents.some((c) => c.value.includes("Open documentation")),
					);
					for (const content of contents.filter((c) => c.isTrusted)) {
						assert.ok(!content.value.includes("<command:"));
						assert.match(content.value, /\[Open location\]/);
					}
					for (const content of contents.filter((c) =>
						c.value.includes("fake-run"),
					))
						assert.equal(
							content.isTrusted,
							false,
							"document-authored Markdown is separate from trusted generated actions",
						);
				});
			},
		);
		await t.test(
			"group declaration hover shows metadata and members without widening node navigation",
			async () => {
				for (const source of [
					'---\nartifact: {a: {group: g}}\nprocess: {p: {group: g}}\ngroup:\n  "g": {label: Group, color: "#c0ffee", parent: outer}\n  outer: {label: Outer}\n---\na >> p -> b\n',
					"---\nartifact: {a: {group: g}}\nprocess: {p: {group: g}}\ngroup: {'g': {label: Group, color: '#c0ffee', parent: outer}, outer: {label: Outer}}\n---\na >> p -> b\n",
				])
					await withEditors(source, async (create) => {
						const editor = create();
						const model = editor.getModel();
						const line =
							source
								.split("\n")
								.findIndex((line) => line.includes("label: Group")) + 1;
						const column =
							model
								.getLineContent(line)
								.indexOf(source.includes('"g"') ? '"g"' : "'g'") + 2;
						const hovers = await Promise.all(
							host.languageFeatures.hoverProvider
								.ordered(model)
								.map((p) =>
									p.provideHover(
										model,
										{ lineNumber: line, column },
										{ isCancellationRequested: false },
									),
								),
						);
						const contents = hovers.filter(Boolean).flatMap((h) => h.contents);
						const text = contents.map((c) => c.value).join("\n");
						for (const expected of ["Group", "#c0ffee", "outer", "📄 a", "▶️ p"])
							assert.ok(
								text.includes(expected),
								`missing group hover metadata: ${expected}`,
							);
						assert.ok(
							!text.includes("Go to definition"),
							"group hover must not advertise artifact/process-only navigation",
						);
						for (const content of contents.filter((c) =>
							c.value.includes("#c0ffee"),
						))
							assert.equal(content.isTrusted, false);
						const field = model.getLineContent(line).indexOf("color") + 2;
						const fieldHovers = await Promise.all(
							host.languageFeatures.hoverProvider
								.ordered(model)
								.map((p) =>
									p.provideHover(
										model,
										{ lineNumber: line, column: field },
										{ isCancellationRequested: false },
									),
								),
						);
						assert.ok(
							fieldHovers.every((h) => !h),
							"metadata field names do not become group declarations",
						);
						editor.setPosition({ lineNumber: line, column });
						await editor.getAction("pfdsl.nextNodeOccurrence").run();
						assert.deepEqual(
							{ ...editor.getPosition() },
							{ lineNumber: line, column },
						);
					});
			},
		);
		await t.test(
			"directory references retain readable siblings and report failures only without candidates",
			async () => {
				const source =
					"---\nartifact: {a: {location: docs}}\n---\na >> p -> b\n";
				for (const mode of [
					"partial",
					"all-unreadable",
					"root-unreadable",
					"empty",
				]) {
					const opened = [],
						statuses = [];
					await withEditors(source, async (create) => {
						const editor = create({
							reportStatus: (value) => statuses.push(value),
							referenceServices: {
								context: async () => "/work/a.pfdsl",
								inspect: async () => "directory",
								list: async (path) => {
									if (mode === "empty") return [];
									if (mode === "root-unreadable" || path.endsWith("locked"))
										throw new Error("Permission denied: locked");
									if (path === "/work/docs")
										return [
											{ name: "readable", isDirectory: true },
											{ name: "locked", isDirectory: true },
										];
									return mode === "partial"
										? [{ name: "good.md", isDirectory: false }]
										: [];
								},
								open: async (target) => opened.push(target),
								run: async () => {},
							},
						});
						const token = { isCancellationRequested: false };
						const links = (
							await Promise.all(
								host.languageFeatures.linkProvider
									.ordered(editor.getModel())
									.map((p) => p.provideLinks(editor.getModel(), token)),
							)
						)
							.filter(Boolean)
							.flatMap((r) => r.links);
						assert.equal(links.length, 1);
						await host.openLink(links[0].url);
						if (mode === "partial") {
							assert.deepEqual(opened, [
								{ kind: "path", value: "/work/docs/readable/good.md" },
							]);
							assert.deepEqual(statuses, []);
						} else {
							assert.deepEqual(opened, []);
							assert.match(
								statuses.at(-1),
								mode === "empty" ? /No files found/ : /Permission denied/,
							);
						}
					});
				}
			},
		);
		await t.test(
			"rendered hover links retain parentheses in paths and commands",
			async () => {
				const source = `---\nartifact: {a: {location: "draft).md"}}\nprocess: {p: {command: 'printf ")"'}}\n---\na >> p -> b\n`;
				await withEditors(source, async (create) => {
					const editor = create({ referenceServices: {} });
					for (const [column, expected] of [
						[1, ["location", "draft).md"]],
						[6, ['printf ")"']],
					]) {
						const hovers = await Promise.all(
							host.languageFeatures.hoverProvider
								.ordered(editor.getModel())
								.map((p) =>
									p.provideHover(
										editor.getModel(),
										{ lineNumber: 5, column },
										{ isCancellationRequested: false },
									),
								),
						);
						const trusted = hovers
							.filter(Boolean)
							.flatMap((h) => h.contents)
							.filter((c) => c.isTrusted);
						const rendered = trusted.map((content) =>
							host.renderMarkdown(content),
						);
						try {
							const links = rendered.flatMap((item) => [
								...item.element.querySelectorAll("a"),
							]);
							const link = links.find((link) =>
								link.textContent.includes(
									column === 1 ? "Open location" : "Run in Terminal",
								),
							);
							assert.ok(link);
							const href =
								link.getAttribute("data-href") ?? link.getAttribute("href");
							assert.deepEqual(
								JSON.parse(
									decodeURIComponent(href.slice(href.indexOf("?") + 1)),
								).slice(1),
								expected,
							);
						} finally {
							for (const item of rendered) item.dispose();
						}
					}
				});
			},
		);
		await t.test(
			"reference links, explicit process commands and metadata comparison reach their owning services",
			async () => {
				const source =
					'---\nbasePath: ../assets\nartifact: {a: {label: After, location: "read me.txt"}}\nprocess: {p: {command: "printf 日本語\\nprintf done", subflow: "child.pfdsl"}}\n---\na >> p -> b\n';
				const opened = [],
					runs = [],
					statuses = [];
				const services = {
					context: async () => "/work/docs/a.pfdsl",
					inspect: async () => "file",
					list: async () => [],
					open: async (target) => opened.push(target),
					run: async (...args) => runs.push(args),
					compareFile: async () => ({
						label: "comparison.pfdsl",
						source: source.replace("After", "Before"),
					}),
					compareGit: async (ref) => ({
						label: `Git ${ref}`,
						source: source.replace("After", "Before"),
					}),
				};
				await withEditors(source, async (create, tabs) => {
					const editor = create({
						referenceServices: services,
						reportStatus: (value) => statuses.push(value),
					});
					const other = create();
					assert.equal(opened.length + runs.length, 0);
					const model = editor.getModel(),
						token = {
							isCancellationRequested: false,
							onCancellationRequested() {
								return { dispose() {} };
							},
						};
					const results = await Promise.all(
						host.languageFeatures.linkProvider
							.ordered(model)
							.map((p) => p.provideLinks(model, token)),
					);
					const links = results
						.filter(Boolean)
						.flatMap((result) => result.links);
					assert.equal(links.length, 2);
					await host.openLink(links[0].url);
					assert.deepEqual(opened.at(-1), {
						kind: "path",
						value: "/work/assets/read me.txt",
					});
					await host.openLink(links[1].url);
					assert.deepEqual(opened.at(-1), {
						kind: "path",
						value: "/work/docs/child.pfdsl",
					});
					editor.setPosition({ lineNumber: 4, column: 11 });
					await editor.getAction("pfdsl.runGhostty").run();
					assert.deepEqual(runs.at(-1), [
						"printf 日本語\nprintf done",
						"/work/assets",
						"ghostty",
					]);
					await editor.getAction("pfdsl.compareFile").run();
					assert.match(
						tabs[0].container.querySelector(".reference-comparison")
							.textContent,
						/comparison.pfdsl.*including metadata/,
					);
					assert.match(
						tabs[0].container.querySelector("#diff-panel").textContent,
						/~ node.*a/,
					);
					assert.equal(editor.getValue(), source);
					assert.equal(other.getValue(), source);
					await editor.getAction("pfdsl.clearDiff").run();
					assert.equal(
						tabs[0].container.querySelector(".reference-comparison").hidden,
						true,
					);
					editor.setValue(`${source}b >> q -> c\n`);
					const count = opened.length;
					await host.openLink(links[0].url);
					assert.equal(
						opened.length,
						count,
						"old links cannot open after editing",
					);
				});
			},
		);
		for (const [before, after] of [
			["\r\n", "\n"],
			["\n", "\r\n"],
		]) {
			await t.test(
				`disk reload adopts EOL ${JSON.stringify(before)} -> ${JSON.stringify(after)} without dirty state`,
				async () => {
					await withEditors(
						`a >> p${before}p -> b${before}`,
						async (create, tabs) => {
							const editor = create();
							const tab = tabs[0];
							const oldSource = tab.getSource();
							const original = {
								id: 1,
								path: "/a.pfdsl",
								binding: "dir:a",
								identity: "inode:a",
								source: oldSource,
								revision: "old",
							};
							const session = new DocumentSession(tab, original);
							const source = `a >> p${after}p -> c${after}`;
							const replacement = { ...original, source, revision: "new" };
							await session.checkExternal(async () => replacement);
							assert.equal(tab.getSource(), source);
							assert.equal(session.isDirty(), false);
							await editor.getModel().undo();
							await editor.getModel().undo();
							assert.equal(tab.getSource(), oldSource);
							assert.equal(session.isDirty(), true);
							await editor.getModel().redo();
							await editor.getModel().redo();
							assert.equal(tab.getSource(), source);
							assert.equal(session.isDirty(), false);
							await session.save(
								session.plan("save", replacement),
								async (plan) => {
									assert.equal(plan.editor, source);
									return { outcome: "saved", current: replacement };
								},
							);
						},
					);
				},
			);
		}
		for (const before of ["\n", "\r\n"]) {
			await t.test(
				`mixed-EOL reload acknowledges Monaco normalization from ${JSON.stringify(before)}`,
				async () => {
					await withEditors(
						`a >> p${before}p -> b${before}`,
						async (create, tabs) => {
							const editor = create();
							const tab = tabs[0];
							const original = {
								id: 1,
								path: "/a.pfdsl",
								binding: "dir:a",
								identity: "inode:a",
								source: tab.getSource(),
								revision: "old",
							};
							const session = new DocumentSession(tab, original);
							const mixed = "a >> p\np -> c\r\n";
							const replacement = {
								...original,
								source: mixed,
								revision: "mixed",
							};
							const normalized = "a >> p\r\np -> c\r\n";
							await session.checkExternal(async () => replacement);
							assert.equal(tab.getSource(), normalized);
							assert.equal(session.savedSource, normalized);
							assert.equal(session.disk.source, mixed);
							assert.equal(session.isDirty(), false);
							await session.checkExternal(async () => replacement);
							assert.equal(session.isDirty(), false);
							const count = before === "\n" ? 2 : 1;
							for (let i = 0; i < count; i++) await editor.getModel().undo();
							assert.equal(tab.getSource(), original.source);
							assert.equal(session.isDirty(), true);
							for (let i = 0; i < count; i++) await editor.getModel().redo();
							assert.equal(tab.getSource(), normalized);
							assert.equal(session.isDirty(), false);
							let disposed = false;
							assert.equal(
								await closeDocuments(
									[session],
									async () => assert.fail("clean reload must not prompt"),
									async () =>
										assert.fail("close must not rewrite mixed disk bytes"),
									() => {
										disposed = true;
									},
								),
								true,
							);
							assert.equal(disposed, true);
						},
					);
				},
			);
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
		await t.test(
			"independent Japanese workflow: cycle matches, replace one/all, undo/redo, comment, isolate tabs",
			async () => {
				const source =
					"入力 >> 処理 -> 結果\n結果 >> 検査 -> 入力\n入力 >> 保存 -> 記録\n";
				await withEditors(source, async (create, tabs) => {
					const editor = create();
					const other = create();
					const tab = tabs[0];
					await editor.getAction("actions.find").run();
					const controller = editor.getContribution(
						"editor.contrib.findController",
					);
					controller
						.getState()
						.change(
							{ searchString: "入力", isRegex: false, matchCase: true },
							true,
						);
					assert.equal(controller.getState().matchesCount, 3);
					const positions = [];
					for (let i = 0; i < 4; i++) {
						await editor.getAction("editor.action.nextMatchFindAction").run();
						const selection = editor.getSelection();
						assert.equal(editor.getModel().getValueInRange(selection), "入力");
						positions.push([selection.startLineNumber, selection.startColumn]);
					}
					assert.equal(
						new Set(positions.slice(0, 3).map(JSON.stringify)).size,
						3,
					);
					assert.deepEqual(
						positions[3],
						positions[0],
						"next match wraps after all three occurrences",
					);
					await editor.getAction("editor.action.previousMatchFindAction").run();
					assert.deepEqual(
						[
							editor.getSelection().startLineNumber,
							editor.getSelection().startColumn,
						],
						positions[2],
					);
					await editor.getAction("editor.action.startFindReplaceAction").run();
					controller
						.getState()
						.change({ searchString: "入力", replaceString: "受領" }, true);
					const range = editor.getSelection();
					const model = editor.getModel();
					const start = model.getOffsetAt(range.getStartPosition());
					const end = model.getOffsetAt(range.getEndPosition());
					const single = `${source.slice(0, start)}受領${source.slice(end)}`;
					controller.replace();
					assert.equal(
						tab.getSource(),
						single,
						"single replacement changes only selected occurrence",
					);
					assert.equal((editor.getValue().match(/入力/g) ?? []).length, 2);
					assert.equal(other.getValue(), source);
					await model.undo();
					assert.equal(tab.getSource(), source);
					await model.redo();
					assert.equal(tab.getSource(), single);
					controller
						.getState()
						.change({ searchString: "入力", replaceString: "受領" }, true);
					controller.replaceAll();
					const all = source.replaceAll("入力", "受領");
					assert.equal(tab.getSource(), all);
					assert.equal(other.getValue(), source);
					await model.undo();
					assert.equal(
						tab.getSource(),
						single,
						"replace-all Undo preserves previous single replace",
					);
					await model.redo();
					assert.equal(tab.getSource(), all);
					controller.closeFindWidget();
					editor.setSelection(new host.monaco.Selection(1, 1, 1, 16));
					await editor.getAction("editor.action.commentLine").run();
					assert.equal(tab.getSource(), `# ${all}`);
					assert.equal(other.getValue(), source);
					await model.undo();
					assert.equal(tab.getSource(), all);
					await model.redo();
					assert.equal(tab.getSource(), `# ${all}`);
					await editor.getAction("editor.action.commentLine").run();
					assert.equal(tab.getSource(), all);
					assert.equal(other.getValue(), source);
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
