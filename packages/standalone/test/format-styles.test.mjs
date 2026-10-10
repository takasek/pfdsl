import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { instances } from "./helpers/format-monaco.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
async function withHost(entry, run) {
	const temporary = mkdtempSync(
		join(packageRoot, "node_modules/.format-style-"),
	);
	const output = join(temporary, "host.mjs");
	const seam = fileURLToPath(
		new URL("./helpers/format-monaco.mjs", import.meta.url),
	);
	const dom = new JSDOM(
		entry === "main"
			? readFileSync(join(packageRoot, "index.html"), "utf8")
			: "<main></main>",
		{ pretendToBeVisual: true },
	);
	const previous = new Map(
		["document", "window", "self"].map((name) => [
			name,
			Object.getOwnPropertyDescriptor(globalThis, name),
		]),
	);
	const start = instances.length;
	const tabs = [];
	try {
		for (const name of previous.keys())
			Object.defineProperty(globalThis, name, {
				value: name === "document" ? dom.window.document : dom.window,
				configurable: true,
			});
		await build({
			entryPoints: [join(packageRoot, `src/${entry}.ts`)],
			outfile: output,
			bundle: true,
			platform: "node",
			format: "esm",
			packages: "external",
			loader: { ".css": "empty" },
			plugins: [
				{
					name: "controlled-monaco",
					setup(builder) {
						builder.onResolve(
							{ filter: /^monaco-editor\/.*\?worker$/ },
							() => ({ path: "worker", namespace: "stub-worker" }),
						);
						builder.onLoad({ filter: /.*/, namespace: "stub-worker" }, () => ({
							contents: "export default class Worker {}",
						}));
						builder.onResolve({ filter: /^monaco-editor\// }, () => ({
							path: seam,
							external: true,
						}));
					},
				},
			],
		});
		const module = await import(pathToFileURL(output).href);
		const create = (source) => {
			const tab = module.createDocumentTab({
				parent: dom.window.document.querySelector("main"),
				key: `doc-${tabs.length}`,
				name: "Test",
				source,
				path: null,
				read: async () => assert.fail("Formatting must not read disk"),
				reportStatus() {},
			});
			tabs.push(tab);
			return { tab, editor: instances.at(-1) };
		};
		await run({
			create,
			document: dom.window.document,
			editors: instances.slice(start),
		});
		if (entry === "main") {
			const docs = [...dom.window.document.querySelectorAll(".document")];
			for (
				let attempt = 0;
				attempt < 1000 && !docs.every((d) => d.querySelector("#inner svg"));
				attempt++
			)
				await new Promise((resolve) => setTimeout(resolve, 5));
			assert.ok(
				docs.every((d) => d.querySelector("#inner svg")),
				"Production preview must complete",
			);
		}
	} finally {
		for (const tab of tabs) tab.dispose();
		for (const editor of instances.slice(start)) editor.dispose();
		for (const [name, value] of previous) {
			if (value) Object.defineProperty(globalThis, name, value);
			else delete globalThis[name];
		}
		dom.window.close();
		rmSync(temporary, { recursive: true, force: true });
	}
}
test("flat formatting uses the current unsaved source and one bracketed editor edit", async () => {
	await withHost("document-tab", async ({ create }) => {
		const { tab, editor } = create("original >> work -> result\n");
		editor.model.source = "fresh>>step->next";
		tab.format("flat");
		assert.equal(editor.getValue(), "fresh >> step\nstep -> next\n");
		assert.equal(editor.edits.length, 1);
		assert.equal(editor.undoStops, 2);
		assert.equal(editor.edits[0].origin, "pfdsl.format");
		assert.equal(tab.isDirty(), true);
		tab.format("flat");
		assert.equal(editor.edits.length, 1);
		assert.equal(editor.undoStops, 2);
	});
});
test("default flows and explicit flows retain grouping and error/no-op behavior", async () => {
	await withHost("document-tab", async ({ create }) => {
		const { tab, editor } = create("a>>p\np->b");
		tab.format();
		assert.equal(editor.getValue(), "a >> p -> b\n");
		assert.equal(editor.edits.length, 1);
		assert.equal(editor.undoStops, 2);
		tab.format("flows");
		assert.equal(editor.edits.length, 1);
		for (const source of [
			"a >>",
			"a>>p->a",
			"---\nartifact: [\n---\na >> p -> b",
		]) {
			editor.model.source = source;
			tab.format("flat");
			tab.format("flows");
			assert.equal(editor.getValue(), source);
			assert.equal(editor.edits.length, 1);
			assert.equal(editor.undoStops, 2);
		}
		// V003 is a warning, so noncanonical text still formats.
		editor.model.source = "a>>p";
		tab.format("flat");
		assert.equal(editor.getValue(), "a >> p\n");
		assert.equal(editor.edits.length, 2);
		assert.equal(editor.undoStops, 4);
	});
});
test("production toolbar formats only the switched active document in the chosen style", async () => {
	await withHost("main", async ({ document, editors }) => {
		const flat = document.querySelector("#format-flat");
		assert.equal(document.querySelector("#format").textContent, "Format flows");
		assert.ok(flat, "Missing Flat format choice");
		assert.equal(flat.textContent, "Format flat");
		editors[1].model.source = "fresh>>step->next";
		flat.click();
		assert.equal(editors[1].getValue(), "fresh >> step\nstep -> next\n");
		assert.equal(editors[0].edits.length, 0);
		document.querySelector("#tabs button").click();
		editors[0].model.source = "a>>p->b";
		flat.click();
		assert.equal(editors[0].getValue(), "a >> p\np -> b\n");
		assert.equal(editors[1].edits.length, 1);
		document.querySelector("#format").click();
		assert.equal(editors[0].getValue(), "a >> p -> b\n");
		assert.equal(editors[0].edits.length, 2);
		assert.equal(editors[0].undoStops, 4);
	});
});
