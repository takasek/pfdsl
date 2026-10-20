import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withFormatHost } from "./helpers/format-host.mjs";
import { instances } from "./helpers/range-monaco.mjs";

test("standalone synchronizes user selection and preview navigation without edit-induced recentering", async () => {
	await withFormatHost(
		"document-tab",
		fileURLToPath(new URL("./helpers/range-monaco.mjs", import.meta.url)),
		instances,
		async ({ create, window, document }) => {
			const { tab, editor } = create(
				"---\nartifact:\n  a: {label: A}\n---\na >> p -> b\n",
			);
			tab.activate();
			for (
				let attempt = 0;
				attempt < 1000 && !tab.container.querySelector("#inner svg");
				attempt++
			)
				await new Promise((resolve) => setTimeout(resolve, 5));
			const node = (id) =>
				tab.container.querySelector(`#inner [data-node-id="${id}"]`);
			assert.ok(node("p"));
			node("p").dispatchEvent(
				new window.MouseEvent("contextmenu", { bubbles: true }),
			);
			const title = () =>
				tab.container.querySelector("#node-actions-title").textContent;
			const focusCalls = editor.focusCalls;
			tab.container.querySelector('[data-neighbor="a"]').click();
			assert.deepEqual(editor.position, { lineNumber: 3, column: 3 });
			assert.deepEqual(editor.revealed, editor.position);
			assert.equal(editor.focusCalls, focusCalls);
			assert.equal(
				tab.container
					.querySelector("#node-actions")
					.contains(document.activeElement),
				true,
			);
			const event = {
				position: { lineNumber: 5, column: 6 },
				source: "keyboard",
				reason: 3,
			};
			editor.callbacks.onDidChangeCursorPosition(event);
			assert.match(title(), /p/);
			const input = tab.container.querySelector('[data-side="left"] input');
			input.focus();
			input.value = "b";
			input.dispatchEvent(new window.Event("input"));
			tab.container
				.querySelector('[data-side="left"] [data-candidate="b"]')
				.click();
			assert.match(editor.getValue(), /b >>\? p/);
			for (
				let attempt = 0;
				attempt < 1000 &&
				!tab.container.querySelector('[data-side="left"] [data-neighbor="b"]');
				attempt++
			)
				await new Promise((resolve) => setTimeout(resolve, 5));
			assert.ok(
				tab.container.querySelector('[data-side="left"] [data-neighbor="b"]'),
			);
			for (const [source, reason] of [
				["pfdsl.preview", 3],
				["api", 3],
				["keyboard", 2],
				["mouse", 1],
			]) {
				editor.callbacks.onDidChangeCursorPosition({
					position: { lineNumber: 5, column: 1 },
					source,
					reason,
				});
				assert.match(title(), /p/);
			}
			node("a").dispatchEvent(
				new window.MouseEvent("dblclick", { bubbles: true }),
			);
			assert.equal(editor.focusCalls, focusCalls + 1);
			assert.deepEqual(editor.position, { lineNumber: 3, column: 3 });
			assert.match(title(), /A/);
		},
	);
});
