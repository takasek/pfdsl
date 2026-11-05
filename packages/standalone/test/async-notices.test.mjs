import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build, JSDOM, root } from "./helpers/host-bundle.mjs";
import { instances, linkOpeners } from "./helpers/lifecycle-monaco.mjs";

async function until(predicate) {
	for (let i = 0; i < 1000; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.fail("The controlled native request did not start");
}

test("async action notices belong to the initiating document revision", async (t) => {
	const temp = mkdtempSync(
		join(root, "packages/standalone/node_modules/.async-notices-"),
	);
	const output = join(temp, "tab.mjs");
	const seam = `${root}/packages/standalone/test/helpers/lifecycle-monaco.mjs`;
	const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
	const previousCapture = Object.getOwnPropertyDescriptor(
		globalThis,
		"captureNoticePreview",
	);
	const previews = [];
	globalThis.captureNoticePreview = (options) => previews.push(options);
	try {
		await build({
			entryPoints: [`${root}/packages/standalone/src/document-tab.ts`],
			outfile: output,
			bundle: true,
			platform: "node",
			format: "esm",
			packages: "external",
			plugins: [
				{
					name: "controlled-boundaries",
					setup(b) {
						b.onResolve({ filter: /^monaco-editor\// }, () => ({
							path: seam,
							external: true,
						}));
						b.onResolve({ filter: /^@pfdsl\/editor\/preview$/ }, () => ({
							path: "preview",
							namespace: "capture",
						}));
						b.onLoad({ filter: /.*/, namespace: "capture" }, () => ({
							contents: `import { mountPreview as mount } from ${JSON.stringify(`${root}/packages/editor/dist/preview.js`)}; export function mountPreview(parent, options) { globalThis.captureNoticePreview(options); return mount(parent, options); }`,
							resolveDir: root,
						}));
					},
				},
			],
		});
		const { createDocumentTab } = await import(pathToFileURL(output).href);
		for (const route of [
			"export",
			"preview",
			"link",
			"command",
			"command-success",
		]) {
			for (const change of ["none", "edit", "edit-undo", "dispose"])
				await t.test(`${route}: ${change}`, async () => {
					const dom = new JSDOM("<main></main>");
					globalThis.document = dom.window.document;
					const notices = [];
					let complete, tab;
					const wait = () =>
						new Promise((resolve, reject) => {
							complete = route === "command-success" ? resolve : reject;
						});
					try {
						tab = createDocumentTab({
							parent: document.querySelector("main"),
							key: `${route}-${change}`,
							name: "a.pfdsl",
							path: "/a.pfdsl",
							source:
								'---\nartifact:\n  a: {location: "https://example.com"}\nprocess:\n  p: {command: "echo demo"}\n---\na >> p -> b\n',
							read: async () => null,
							reportStatus: (message) => notices.push(message),
							referenceServices: {
								context: async () => "/a.pfdsl",
								open: wait,
								run: wait,
							},
							exportServices: { choose: wait },
						});
						const editor = instances.at(-1);
						tab.activate();
						editor.getPosition = () => ({ lineNumber: 7, column: 6 });
						await until(() => tab.getDiagnosticsSummary() !== "Checking…");
						let pending;
						if (route === "export")
							pending = editor.actions.get("pfdsl.export.dot").run();
						else if (route === "preview")
							previews
								.at(-1)
								.postMessage({ type: "openUrl", url: "https://example.com" });
						else if (route === "link")
							pending = linkOpeners.at(-1).open({
								scheme: "pfdsl-reference",
								path: `/${editor.getId()}`,
								query: JSON.stringify({
									version: editor.model.getVersionId(),
									index: 0,
								}),
							});
						else pending = editor.actions.get("pfdsl.runTerminal").run();
						await until(() => complete);
						if (change === "edit" || change === "edit-undo") {
							const before = editor.model.source;
							editor.model.source += "\n";
							editor.model.version++;
							editor.callbacks.onDidChangeModelContent();
							if (change === "edit-undo") {
								editor.model.source = before;
								editor.model.version++;
								editor.callbacks.onDidChangeModelContent();
							}
						}
						if (change === "dispose") tab.dispose();
						complete(
							route === "command-success"
								? undefined
								: new Error("Late native failure"),
						);
						await pending;
						await new Promise(setImmediate);
						const relevant = notices.filter((message) =>
							/Late native failure|Command sent/.test(message),
						);
						assert.equal(relevant.length, change === "none" ? 1 : 0);
					} finally {
						if (change !== "dispose") tab?.dispose();
						dom.window.close();
					}
				});
		}
	} finally {
		if (previousCapture)
			Object.defineProperty(
				globalThis,
				"captureNoticePreview",
				previousCapture,
			);
		else delete globalThis.captureNoticePreview;
		if (previous) Object.defineProperty(globalThis, "document", previous);
		else delete globalThis.document;
		rmSync(temp, { recursive: true, force: true });
	}
});
