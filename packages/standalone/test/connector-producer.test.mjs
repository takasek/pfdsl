import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withFormatHost } from "./helpers/format-host.mjs";
import { instances } from "./helpers/range-monaco.mjs";

test("standalone repair reports new warnings through the existing single edit path", async () => {
	await withFormatHost(
		"document-tab",
		fileURLToPath(new URL("./helpers/range-monaco.mjs", import.meta.url)),
		instances,
		async ({ create }) => {
			const { tab, editor, statuses } = create("a >> p -> b\na >>? p\n");
			tab.activate();
			for (
				let attempt = 0;
				attempt < 1000 && !tab.container.querySelector("#preview-error button");
				attempt++
			)
				await new Promise((resolve) => setTimeout(resolve, 5));
			const button = tab.container.querySelectorAll("#preview-error button")[1];
			assert.ok(button);
			button.click();
			assert.equal(tab.getSource(), "p -> b\na >>? p\n");
			assert.equal(editor.edits.length, 1);
			assert.equal(editor.undoStops, 2);
			assert.match(
				statuses.at(-1),
				/^Removed the normal input 'a' >> 'p'\. W008: /,
			);
		},
	);
});

test("standalone ordinary delete retains its existing status", async () => {
	await withFormatHost(
		"document-tab",
		fileURLToPath(new URL("./helpers/range-monaco.mjs", import.meta.url)),
		instances,
		async ({ create, window }) => {
			const { tab, editor, statuses } = create("a >> p -> b\n");
			tab.activate();
			for (
				let attempt = 0;
				attempt < 1000 &&
				!tab.container.querySelector('#inner g[data-node-id="p"]');
				attempt++
			)
				await new Promise((resolve) => setTimeout(resolve, 5));
			const node = tab.container.querySelector('#inner g[data-node-id="p"]');
			assert.ok(node);
			node.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
			tab.container.querySelector('[data-side="left"] [data-edge]').click();
			tab.container.querySelector("[data-delete-edge]").click();
			assert.ok(tab.getSource().endsWith("\np -> b\n"));
			assert.equal(editor.edits.length, 1);
			assert.equal(editor.undoStops, 2);
			assert.equal(
				statuses.at(-1),
				"Preview edit applied. Complete any required metadata.",
			);
		},
	);
});

test("production standalone refusal retains text, clean state, input and undo boundaries", async () => {
	await withFormatHost(
		"document-tab",
		fileURLToPath(new URL("./helpers/range-monaco.mjs", import.meta.url)),
		instances,
		async ({ create, window }) => {
			const source = "a >> p -> b\nc >> q -> d\n";
			const { tab, editor, statuses } = create(source);
			tab.activate();
			for (
				let attempt = 0;
				attempt < 1000 &&
				!tab.container.querySelector('#inner g[data-node-id="q"]');
				attempt++
			)
				await new Promise((resolve) => setTimeout(resolve, 5));
			const node = tab.container.querySelector('#inner g[data-node-id="q"]');
			assert.ok(node);
			node.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
			const input = tab.container.querySelector('[data-side="right"] input');
			input.value = "b";
			input.dispatchEvent(new window.Event("input"));
			const candidate = tab.container.querySelector('[data-candidate="b"]');
			assert.equal(candidate, null);
			assert.equal(tab.getSource(), source);
			assert.equal(tab.hasUnsavedText(), false);
			assert.equal(editor.edits.length, 0);
			assert.equal(editor.undoStops, 0);
			assert.equal(input.value, "b");
			// Change the editor before its next preview update: the host must reject the old candidate snapshot.
			editor.model.source = `${source}p -> free\n`;
			input.value = "free";
			input.dispatchEvent(new window.Event("input"));
			tab.container.querySelector('[data-side="right"] [data-create]').click();
			assert.equal(tab.getSource(), `${source}p -> free\n`);
			assert.equal(editor.edits.length, 0);
			assert.equal(editor.undoStops, 0);
			assert.equal(input.value, "free");
			assert.equal(tab.container.querySelector("#node-actions").hidden, false);
			assert.match(statuses.at(-1), /document changed/);
			assert.match(
				tab.container.querySelector("#node-actions-error").textContent,
				/document changed/,
			);
		},
	);
});
