import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withFormatHost } from "./helpers/format-host.mjs";
import { instances } from "./helpers/range-monaco.mjs";

for (const scenario of [
	"separate Undo",
	"coalesced Undo",
	"comment Undo",
	"partial comment Undo",
])
	test(`standalone follows the surviving node after ${scenario}`, async () => {
		await withFormatHost(
			"document-tab",
			fileURLToPath(new URL("./helpers/range-monaco.mjs", import.meta.url)),
			instances,
			async ({ create, window }) => {
				const source = "a >> p -> b\n";
				const { tab, editor } = create(source);
				const waitUntil = async (predicate) => {
					for (let n = 0; n < 1000 && !predicate(); n++)
						await new Promise((resolve) => setTimeout(resolve, 5));
					assert.ok(predicate());
				};
				tab.activate();
				await waitUntil(() =>
					tab.container.querySelector('#inner [data-node-id="p"]'),
				);
				tab.container.querySelector('#inner [data-node-id="p"]').dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key: "Enter",
						bubbles: true,
					}),
				);
				tab.container.querySelector(".connections-identity > button").click();
				tab.container.querySelector('[aria-label="Node ID"]').value = "build";
				tab.container.querySelector("[data-save-node]").click();
				assert.match(tab.getSource(), /a >> build -> b/);
				if (scenario.includes("comment Undo")) {
					const saved = tab.getSource();
					const kept =
						scenario === "partial comment Undo"
							? `${saved}# kept comment\n`
							: saved;
					editor.model.source = kept;
					editor.callbacks.onDidChangeModelContent();
					editor.model.source = `${kept}# temporary comment\n`;
					editor.callbacks.onDidChangeModelContent();
					editor.model.source = kept;
					editor.callbacks.onDidChangeModelContent({ isUndoing: true });
					await waitUntil(() =>
						tab.container.querySelector('#inner [data-node-id="build"]'),
					);
					assert.equal(
						tab.container.querySelector("#node-actions").hidden,
						false,
					);
					assert.equal(
						tab.container.querySelector(".connections-center").textContent,
						"build",
					);
					return;
				}
				// Undo reaches the host through this Monaco content-change boundary.
				editor.model.source = source;
				editor.callbacks.onDidChangeModelContent({ isUndoing: true });
				if (scenario === "separate Undo") {
					await waitUntil(
						() => !tab.container.querySelector("[data-save-node]").disabled,
					);
					assert.equal(
						tab.container.querySelector(".connections-center").textContent,
						"p",
					);
				}
				editor.model.source = "x >> build -> y\n";
				editor.callbacks.onDidChangeModelContent();
				await waitUntil(() =>
					tab.container.querySelector('#inner [data-node-id="x"]'),
				);
				assert.equal(tab.container.querySelector("#node-actions").hidden, true);
			},
		);
	});

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
