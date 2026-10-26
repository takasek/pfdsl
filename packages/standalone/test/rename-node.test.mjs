import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withFormatHost } from "./helpers/format-host.mjs";
import { instances } from "./helpers/range-monaco.mjs";

test("standalone applies ID and label through one undoable edit without moving source focus", async () => {
	await withFormatHost(
		"document-tab",
		fileURLToPath(new URL("./helpers/range-monaco.mjs", import.meta.url)),
		instances,
		async ({ create, window, document }) => {
			const { tab, editor } = create("a >> p -> b\n");
			tab.activate();
			for (
				let attempt = 0;
				attempt < 1000 &&
				!tab.container.querySelector('#inner [data-node-id="p"]');
				attempt++
			)
				await new Promise((resolve) => setTimeout(resolve, 5));
			const node = tab.container.querySelector('#inner [data-node-id="p"]');
			assert.ok(node);
			node.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
			tab.container.querySelector(".connections-identity > button").click();
			tab.container.querySelector('[aria-label="Node ID"]').value = "build";
			const name = tab.container.querySelector('[aria-label="Node label"]');
			name.value = "Build result";
			name.focus();
			tab.container.querySelector("[data-save-node]").click();
			assert.match(tab.getSource(), /a >> build -> b/);
			assert.match(tab.getSource(), /label: Build result/);
			assert.equal(editor.edits.length, 1);
			assert.equal(editor.undoStops, 2);
			assert.equal(tab.container.querySelector("#node-actions").hidden, false);
			assert.ok(
				tab.container
					.querySelector("#node-actions")
					.contains(document.activeElement),
			);
		},
	);
});
