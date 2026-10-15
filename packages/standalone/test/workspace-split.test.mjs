import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withFormatHost } from "./helpers/format-host.mjs";
import { instances } from "./helpers/format-monaco.mjs";

test("resizes the linked panes by keyboard without recreating the document, and releases listeners on dispose", async () => {
	await withFormatHost(
		"document-tab",
		fileURLToPath(new URL("./helpers/format-monaco.mjs", import.meta.url)),
		instances,
		async ({ create, window }) => {
			const { tab, editor } = create("a >> p -> b\n");
			const divider = tab.container.querySelector('[role="separator"]');
			assert.ok(divider);
			assert.equal(divider.getAttribute("aria-valuenow"), "50");
			assert.equal(divider.getAttribute("aria-orientation"), "vertical");
			divider.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "ArrowRight",
					bubbles: true,
				}),
			);
			assert.equal(divider.getAttribute("aria-valuenow"), "55");
			assert.equal(
				tab.container.style.getPropertyValue("--source-width"),
				"55%",
			);
			assert.equal(tab.getSource(), "a >> p -> b\n");
			assert.equal(editor.edits.length, 0);
			tab.command("delete");
			assert.equal(editor.lastCommand, "deleteRight");
			tab.activate();
			assert.equal(divider.getAttribute("aria-valuenow"), "55");
			divider.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "Home" }),
			);
			assert.equal(divider.getAttribute("aria-valuenow"), "10");
			divider.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "End" }),
			);
			assert.equal(divider.getAttribute("aria-valuenow"), "90");
			tab.dispose();
			divider.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "ArrowLeft" }),
			);
			assert.equal(divider.getAttribute("aria-valuenow"), "90");
		},
	);
});
