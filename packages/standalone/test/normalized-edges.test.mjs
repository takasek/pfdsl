import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withFormatHost } from "./helpers/format-host.mjs";
import { instances } from "./helpers/lifecycle-monaco.mjs";

const seam = fileURLToPath(
	new URL("./helpers/lifecycle-monaco.mjs", import.meta.url),
);
function withTabs(run) {
	return withFormatHost(
		"document-tab",
		seam,
		instances,
		({ create, ...host }) =>
			run({
				...host,
				create: (key, source, options = {}) =>
					create(source, { key, name: key, ...options }),
			}),
		"<button id='trigger'>Normalized edges</button><main></main>",
	);
}

test("normalized output uses current unsaved source and clears immediately on edit", async () => {
	await withTabs(async ({ create }) => {
		const { tab, editor } = create("A", "a >> p -> b\n");
		editor.model.source = "[y, x] >> build -> result\n";
		tab.normalize();
		const panel = tab.container.querySelector(".normalized-edges");
		assert.equal(panel.hidden, false);
		assert.equal(
			panel.querySelector("pre").textContent,
			"x >> build\ny >> build\nbuild -> result\n",
		);
		assert.equal(editor.getValue(), "[y, x] >> build -> result\n");
		assert.equal(tab.isDirty(), true);
		editor.model.source = "fresh >> step -> next\n";
		editor.callbacks.onDidChangeModelContent();
		assert.equal(panel.hidden, true);
		assert.equal(panel.querySelector("pre").textContent, "");
		assert.equal(panel.querySelector("[role=status]").textContent, "");
		tab.normalize();
		assert.equal(
			panel.querySelector("pre").textContent,
			"fresh >> step\nstep -> next\n",
		);
	});
});

test("normalized output is private to its tab, clears invalid output, and distinguishes empty edges", async () => {
	await withTabs(async ({ create }) => {
		const a = create("A", "a >> p -> b\n");
		const b = create("B", "x >> y -> z\n");
		a.tab.normalize();
		b.tab.normalize();
		const pa = a.tab.container.querySelector(".normalized-edges");
		const pb = b.tab.container.querySelector(".normalized-edges");
		assert.equal(pa.querySelector("pre").textContent, "a >> p\np -> b\n");
		assert.equal(pb.querySelector("pre").textContent, "x >> y\ny -> z\n");
		a.editor.model.source = "a >>";
		a.tab.normalize();
		assert.equal(pa.hidden, false);
		assert.equal(pa.querySelector("pre").hidden, true);
		assert.equal(pa.querySelector("pre").textContent, "");
		assert.equal(
			pa.querySelector("[role=status]").textContent,
			"Fix errors before normalizing.",
		);
		assert.equal(pb.querySelector("pre").textContent, "x >> y\ny -> z\n");
		a.editor.model.source = "lonely\n";
		a.tab.normalize();
		assert.equal(pa.hidden, false);
		assert.equal(pa.querySelector("pre").textContent, "");
		assert.equal(
			pa.querySelector("[role=status]").textContent,
			"No normalized edges.",
		);
		assert.deepEqual(a.statuses, []);
		a.tab.dispose();
		a.tab.normalize();
		assert.equal(a.tab.container.isConnected, false);
		assert.equal(pb.isConnected, true);
	});
});

test("normalized text is inert and keyboard closure returns to the invoking control", async () => {
	await withTabs(async ({ create, document, window }) => {
		const source = '"<img src=x onerror=alert(1)>" >> p -> out\n';
		const { tab, editor } = create("A", source);
		const trigger = document.querySelector("#trigger");
		trigger.focus();
		tab.normalize();
		const panel = tab.container.querySelector(".normalized-edges");
		assert.equal(panel.querySelector("img"), null);
		assert.match(
			panel.querySelector("pre").textContent,
			/<img src=x onerror=alert\(1\)>/,
		);
		assert.equal(panel.getAttribute("aria-label"), "Normalized edges");
		assert.equal(document.activeElement, panel.querySelector("pre"));
		panel.querySelector("pre").dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
		assert.equal(panel.hidden, true);
		assert.equal(document.activeElement, trigger);
		trigger.focus();
		tab.normalize();
		panel.querySelector("button").click();
		assert.equal(panel.hidden, true);
		assert.equal(document.activeElement, trigger);
		assert.equal(editor.getValue(), source);
		assert.equal(tab.isDirty(), false);
	});
});

test("normalization stays independent of pending preset reads and disposed completions", async () => {
	await withTabs(async ({ create }) => {
		let finishRead;
		let calls = 0;
		const entry = create(
			"pending",
			"---\nextends: delayed.yaml\n---\na >> p -> b\n",
			{
				path: "/verification/entry.pfdsl",
				read: () => {
					calls++;
					return new Promise((resolve) => {
						finishRead = resolve;
					});
				},
			},
		);
		entry.tab.activate();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(calls, 1);
		entry.editor.model.source =
			"---\nextends: delayed.yaml\n---\nfresh >> step -> next\n";
		entry.tab.normalize();
		assert.equal(calls, 1);
		assert.equal(
			entry.tab.container.querySelector("pre").textContent,
			"fresh >> step\nstep -> next\n",
		);
		const statuses = [...entry.statuses];
		entry.tab.dispose();
		finishRead("{}\n");
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(entry.statuses, statuses);
		assert.equal(entry.tab.container.isConnected, false);
	});
});

test("production main routes Normalize to the active tab and preserves Format", async () => {
	await withFormatHost(
		"main",
		seam,
		instances,
		async ({ document, editors }) => {
			const docs = [...document.querySelectorAll(".document")];
			const button = document.querySelector("#normalize");
			assert.equal(button.textContent, "Normalized edges");
			button.focus();
			button.click();
			assert.equal(docs[0].querySelector(".normalized-edges").hidden, true);
			assert.equal(docs[1].querySelector(".normalized-edges").hidden, false);
			assert.equal(
				docs[1].querySelector("pre").textContent,
				"input >> build\nbuild -> output\n",
			);
			const first = editors[0];
			first.model.source = "fresh >> step -> next\n";
			document.querySelector("#tabs button").click();
			button.focus();
			button.click();
			assert.equal(
				docs[0].querySelector("pre").textContent,
				"fresh >> step\nstep -> next\n",
			);
			assert.equal(docs[1].style.display, "none");
			assert.equal(
				docs[1].querySelector("pre").textContent,
				"input >> build\nbuild -> output\n",
			);
			let edits = 0;
			first.model.getFullModelRange = () => ({});
			first.pushUndoStop = () => {};
			first.executeEdits = (_source, changes) => {
				edits++;
				first.model.source = changes[0].text;
				first.callbacks.onDidChangeModelContent();
			};
			first.model.source = "a>>p->b";
			document.querySelector("#format").click();
			assert.equal(edits, 1);
			assert.match(first.getValue(), /a >> p/);
			assert.equal(docs[0].querySelector(".normalized-edges").hidden, true);
		},
	);
});
