import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withFormatHost } from "./helpers/format-host.mjs";
import { instances } from "./helpers/format-monaco.mjs";

const withHost = (entry, run) =>
	withFormatHost(
		entry,
		fileURLToPath(new URL("./helpers/format-monaco.mjs", import.meta.url)),
		instances,
		run,
	);

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
