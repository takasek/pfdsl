import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withFormatHost } from "./helpers/format-host.mjs";
import { instances, Selection } from "./helpers/range-monaco.mjs";

test("standalone syncs non-preview cursor changes and ignores preview-edit recentering", async () => {
	await withFormatHost(
		"document-tab",
		fileURLToPath(new URL("./helpers/range-monaco.mjs", import.meta.url)),
		instances,
		async ({ create, window, document }) => {
			const { tab, editor } = create(
				"---\nartifact:\n  a: {label: A}\n  b: {label: B}\n---\na >> p -> b\n",
			);
			const root = tab.container.querySelector("#root");
			const inner = tab.container.querySelector("#inner");
			Object.defineProperties(root, {
				clientWidth: { value: 800 },
				clientHeight: { value: 600 },
			});
			Object.defineProperties(inner, {
				offsetWidth: { value: 600 },
				offsetHeight: { value: 400 },
			});
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
				position: {
					lineNumber:
						editor
							.getValue()
							.split("\n")
							.findIndex((line) => line.startsWith("a >> p -> b")) + 1,
					column: 6,
				},
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
			const previewEditCursor = editor.cursorEvents.findLast(
				(event) => event.source === "pfdsl.preview",
			);
			assert.ok(previewEditCursor);
			assert.match(title(), /p/);
			// Re-deliver the observed edit event after refresh to exercise the source guard.
			editor.callbacks.onDidChangeCursorPosition(previewEditCursor);
			assert.match(title(), /p/);
			const definitionLine =
				editor
					.getValue()
					.split("\n")
					.findIndex((line) => line.startsWith("  b:")) + 1;
			assert.ok(definitionLine > 0);
			const definitionColumn =
				editor.getValue().split("\n")[definitionLine - 1].indexOf("b:") + 1;
			editor.setSelection(
				new Selection(
					definitionLine,
					definitionColumn + 1,
					definitionLine,
					definitionColumn,
				),
			);
			assert.equal(editor.getModel().getValueInRange(editor.selection), "b");
			assert.match(title(), /b/);
			assert.equal(node("b").classList.contains("pfdsl-focus-cue"), true);
			assert.equal(node("p").classList.contains("pfdsl-focus-cue"), false);
			const editedFlowLine = editor
				.getValue()
				.split("\n")
				.findIndex((line) => line.startsWith("b >>? p"));
			assert.ok(editedFlowLine >= 0);
			for (const [source, reason, column] of [
				[
					"keyboard",
					2,
					{
						lineNumber: editedFlowLine + 1,
						column:
							editor.getValue().split("\n")[editedFlowLine].indexOf("p") + 1,
					},
				],
				[
					"mouse",
					1,
					{
						lineNumber: editedFlowLine + 1,
						column: 1,
					},
				],
			]) {
				editor.callbacks.onDidChangeCursorPosition({
					position: column,
					source,
					reason,
				});
				assert.match(title(), source === "keyboard" ? /p/ : /b/);
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
