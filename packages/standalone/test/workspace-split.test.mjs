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

test("keeps the divider's range within the pane minimum widths", async () => {
	await withFormatHost(
		"document-tab",
		fileURLToPath(new URL("./helpers/format-monaco.mjs", import.meta.url)),
		instances,
		async ({ create, window }) => {
			window.document.documentElement.style.setProperty(
				"--editor-min-width",
				"440px",
			);
			window.document.documentElement.style.setProperty(
				"--preview-min-width",
				"260px",
			);
			const { tab } = create("a >> p -> b\n");
			tab.container.getBoundingClientRect = () =>
				new window.DOMRect(0, 0, 800, 600);
			const divider = tab.container.querySelector('[role="separator"]');
			const key = (name) =>
				divider.dispatchEvent(
					new window.KeyboardEvent("keydown", { key: name, bubbles: true }),
				);
			// 794px between the panes: the editor needs 440 (55.4%), the preview 260.
			key("Home");
			assert.equal(divider.getAttribute("aria-valuenow"), "55");
			assert.equal(divider.getAttribute("aria-valuemin"), "55");
			key("ArrowRight");
			assert.equal(divider.getAttribute("aria-valuenow"), "60");
			key("End");
			assert.equal(divider.getAttribute("aria-valuenow"), "67");
			assert.equal(divider.getAttribute("aria-valuemax"), "67");
			key("ArrowLeft");
			assert.equal(divider.getAttribute("aria-valuenow"), "62");
			// A narrower host (window or sidebar) moves the range with it.
			key("End");
			tab.container.getBoundingClientRect = () =>
				new window.DOMRect(0, 0, 750, 600);
			window.dispatchEvent(new window.Event("resize"));
			assert.equal(divider.getAttribute("aria-valuemax"), "65");
			assert.equal(divider.getAttribute("aria-valuenow"), "65");
			// At the native minimum, both panes exactly fill the available space.
			tab.container.getBoundingClientRect = () =>
				new window.DOMRect(0, 0, 706, 600);
			window.dispatchEvent(new window.Event("resize"));
			for (const name of ["Home", "End", "ArrowLeft", "ArrowRight"]) {
				key(name);
				assert.equal(divider.getAttribute("aria-valuemin"), "63");
				assert.equal(divider.getAttribute("aria-valuemax"), "63");
				assert.equal(divider.getAttribute("aria-valuenow"), "63");
				assert.ok(
					Math.abs(
						Number(tab.container.style.getPropertyValue("--source-ratio")) *
							700 -
							440,
					) < 1e-10,
				);
			}
			tab.dispose();
		},
	);
});
