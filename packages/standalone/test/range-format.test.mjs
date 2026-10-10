import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { Selection } from "monaco-editor/editor/common/core/selection.js";
import { instances } from "./helpers/range-monaco.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
async function withHost(entry, run) {
	const temporary = mkdtempSync(
		join(packageRoot, "node_modules/.range-format-"),
	);
	const output = join(temporary, "host.mjs");
	const seam = fileURLToPath(
		new URL("./helpers/range-monaco.mjs", import.meta.url),
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
function choose(editor, style) {
	const action = editor.actions.find(
		(a) => a.id === `pfdsl.formatSelection.${style}`,
	);
	assert.ok(action, `Missing selection ${style} action`);
	assert.equal(action.precondition, "editorHasSelection");
	assert.equal(action.contextMenuGroupId, "1_modification");
	action.run(editor);
}
function select(
	editor,
	startLineNumber,
	startColumn,
	endLineNumber,
	endColumn,
) {
	editor.selection = new Selection(
		startLineNumber,
		startColumn,
		endLineNumber,
		endColumn,
	);
}
test("selection actions use current source, expand body lines and keep unrelated text", async () => {
	await withHost("document-tab", async ({ create }) => {
		const { editor } = create("original>>p->b");
		editor.model.source = "left>>l->out\nfresh>>step->next\nright>>r->end\n";
		select(editor, 2, 4, 2, 10);
		choose(editor, "flat");
		assert.equal(
			editor.getValue(),
			"left>>l->out\nfresh >> step\nstep -> next\nright>>r->end\n",
		);
		assert.equal(editor.edits.length, 1);
		assert.equal(editor.undoStops, 2);
		assert.deepEqual(
			{ ...editor.edits[0].edits[0].range },
			{
				startLineNumber: 2,
				startColumn: 1,
				endLineNumber: 3,
				endColumn: 1,
			},
		);
		select(editor, 2, 1, 3, 13);
		choose(editor, "flows");
		assert.equal(
			editor.getValue(),
			"left>>l->out\nfresh >> step -> next\nright>>r->end\n",
		);
		assert.equal(editor.edits.length, 2);
		assert.equal(editor.undoStops, 4);
	});
});
test("frontmatter-only, empty, canonical and syntax error selections are inert", async () => {
	await withHost("document-tab", async ({ create }) => {
		const header = "---\nartifact: {a: {label: A}}\n---\n";
		const { editor } = create(`${header}a>>p->b\nother>>q->c`);
		select(editor, 1, 1, 2, 8);
		choose(editor, "flat");
		assert.equal(editor.edits.length, 0);
		select(editor, 4, 2, 4, 2);
		choose(editor, "flows");
		assert.equal(editor.edits.length, 0);
		select(editor, 2, 5, 4, 4);
		choose(editor, "flat");
		assert.equal(editor.getValue(), `${header}a >> p\np -> b\nother>>q->c`);
		select(editor, 4, 1, 5, 7);
		choose(editor, "flat");
		assert.equal(editor.edits.length, 1);
		editor.model.source = "a >>\nuntouched>>q->c";
		select(editor, 1, 1, 1, 5);
		choose(editor, "flows");
		assert.equal(editor.getValue(), "a >>\nuntouched>>q->c");
		assert.equal(editor.edits.length, 1);
	});
});
test("end-column one and EOF match existing line-expanded range semantics", async () => {
	await withHost("document-tab", async ({ create }) => {
		const { editor } = create("a>>p->b\nb>>q->c\nlast>>r->d");
		select(editor, 1, 3, 2, 1);
		choose(editor, "flat");
		assert.equal(
			editor.getValue(),
			"a >> p\np -> b\nb >> q\nq -> c\nlast>>r->d",
		);
		select(editor, 5, 2, 5, 6);
		choose(editor, "flows");
		assert.equal(
			editor.getValue(),
			"a >> p\np -> b\nb >> q\nq -> c\nlast >> r -> d\n",
		);
	});
});
test("invalid frontmatter, internal-comment chains, tab isolation and disposal stay safe", async () => {
	await withHost("document-tab", async ({ create }) => {
		const first = create("---\nlabel: a>>p->b\na>>p->b");
		select(first.editor, 3, 1, 3, 4);
		choose(first.editor, "flat");
		assert.equal(
			first.editor.edits.length,
			0,
			"Unclosed frontmatter must not be rewritten as body",
		);
		const second = create("[a,b]\n# note\n>> P -> c\n");
		select(second.editor, 1, 1, 3, 10);
		choose(second.editor, "flat");
		assert.equal(second.editor.getValue(), "[a,b]\n# note\n>> P -> c\n");
		assert.equal(second.editor.edits.length, 0);
		second.editor.model.source = "a>>p->a";
		select(second.editor, 1, 1, 1, 8);
		choose(second.editor, "flat");
		assert.equal(
			second.editor.getValue(),
			"a >> p\np -> a\n",
			"Range formatting skips full graph validation",
		);
		assert.equal(first.editor.edits.length, 0);
		second.tab.dispose();
		second.editor.model.source = "fresh>>x->y";
		choose(second.editor, "flat");
		assert.equal(second.editor.edits.length, 1);
	});
});

test("reverse selections use Monaco's normalized Range coordinates with quoted non-BMP IDs", async () => {
	await withHost("document-tab", async ({ create }) => {
		const { editor } = create('"入力😀">>work->"出力𠮷"\nuntouched>>x->y');
		select(editor, 1, 22, 1, 2);
		choose(editor, "flat");
		assert.equal(
			editor.getValue(),
			'"入力😀" >> work\nwork -> 出力𠮷\nuntouched>>x->y',
		);
	});
});

test("multiple selections format only the primary selection like the extension command", async () => {
	await withHost("document-tab", async ({ create }) => {
		const { editor } = create("a>>p->b\nsecond>>q->c");
		select(editor, 1, 2, 1, 5);
		editor.getSelections = () => [editor.selection, new Selection(2, 1, 2, 8)];
		choose(editor, "flat");
		assert.equal(editor.getValue(), "a >> p\np -> b\nsecond>>q->c");
		assert.equal(editor.edits.length, 1);
		assert.equal(editor.undoStops, 2);
	});
});
