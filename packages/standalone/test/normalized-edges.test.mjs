import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { instances } from "./helpers/lifecycle-monaco.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

async function withTabs(run) {
	const temporary = mkdtempSync(join(packageRoot, "node_modules/.normalize-"));
	const seam = fileURLToPath(
		new URL("./helpers/lifecycle-monaco.mjs", import.meta.url),
	);
	const output = join(temporary, "document-tab.mjs");
	const dom = new JSDOM(
		"<button id='trigger'>Normalized edges</button><main></main>",
		{ pretendToBeVisual: true },
	);
	const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
	Object.defineProperty(globalThis, "document", {
		value: dom.window.document,
		configurable: true,
	});
	const tabs = [];
	try {
		await build({
			entryPoints: [join(packageRoot, "src/document-tab.ts")],
			outfile: output,
			bundle: true,
			platform: "node",
			format: "esm",
			packages: "external",
			plugins: [
				{
					name: "controlled-monaco",
					setup(builder) {
						builder.onResolve({ filter: /^monaco-editor\// }, () => ({
							path: seam,
							external: true,
						}));
					},
				},
			],
		});
		const { createDocumentTab } = await import(pathToFileURL(output).href);
		const create = (key, source, options = {}) => {
			const statuses = [];
			const tab = createDocumentTab({
				parent: dom.window.document.querySelector("main"),
				key,
				name: key,
				source,
				path: null,
				read: async () => {
					assert.fail("Normalization must not read disk");
				},
				reportStatus: (s) => statuses.push(s),
				...options,
			});
			tabs.push(tab);
			return { tab, editor: instances.at(-1), statuses };
		};
		await run({ create, document: dom.window.document, window: dom.window });
	} finally {
		for (const tab of tabs) tab.dispose();
		if (previous) Object.defineProperty(globalThis, "document", previous);
		else delete globalThis.document;
		dom.window.close();
		rmSync(temporary, { recursive: true, force: true });
	}
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

test("the production toolbar exposes normalized edge display for the active document", () => {
	const html = readFileSync(join(packageRoot, "index.html"), "utf8");
	const dom = new JSDOM(html);
	try {
		const button = dom.window.document.querySelector("#normalize");
		assert.ok(button, "Missing normalized edge toolbar entry");
		assert.equal(button.textContent, "Normalized edges");
	} finally {
		dom.window.close();
	}
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
	const temporary = mkdtempSync(
		join(packageRoot, "node_modules/.normalize-main-"),
	);
	const output = join(temporary, "main.mjs");
	const seam = fileURLToPath(
		new URL("./helpers/lifecycle-monaco.mjs", import.meta.url),
	);
	const dom = new JSDOM(readFileSync(join(packageRoot, "index.html"), "utf8"), {
		pretendToBeVisual: true,
	});
	const globals = new Map(
		["document", "window", "self"].map((name) => [
			name,
			Object.getOwnPropertyDescriptor(globalThis, name),
		]),
	);
	const start = instances.length;
	try {
		for (const name of globals.keys())
			Object.defineProperty(globalThis, name, {
				value: name === "document" ? dom.window.document : dom.window,
				configurable: true,
			});
		await build({
			entryPoints: [join(packageRoot, "src/main.ts")],
			outfile: output,
			bundle: true,
			platform: "node",
			format: "esm",
			packages: "external",
			loader: { ".css": "empty" },
			plugins: [
				{
					name: "controlled-main-editor",
					setup(builder) {
						builder.onResolve(
							{ filter: /^monaco-editor\/.*\?worker$/ },
							() => ({ path: "worker", namespace: "empty-worker" }),
						);
						builder.onLoad({ filter: /.*/, namespace: "empty-worker" }, () => ({
							contents: "export default class Worker {}",
						}));
						builder.onResolve({ filter: /^monaco-editor\// }, () => ({
							path: seam,
							external: true,
						}));
						if (process.env.PFDSL_NORMALIZE_MAIN_SOURCE)
							builder.onLoad({ filter: /\/src\/main\.ts$/ }, () => ({
								contents: readFileSync(
									process.env.PFDSL_NORMALIZE_MAIN_SOURCE,
									"utf8",
								),
								loader: "ts",
								resolveDir: join(packageRoot, "src"),
							}));
					},
				},
			],
		});
		await import(pathToFileURL(output).href);
		const docs = [...dom.window.document.querySelectorAll(".document")];
		const button = dom.window.document.querySelector("#normalize");
		button.focus();
		button.click();
		assert.equal(docs[0].querySelector(".normalized-edges").hidden, true);
		assert.equal(docs[1].querySelector(".normalized-edges").hidden, false);
		assert.equal(
			docs[1].querySelector("pre").textContent,
			"input >> build\nbuild -> output\n",
		);
		const first = instances[start];
		first.model.source = "fresh >> step -> next\n";
		dom.window.document.querySelector("#tabs button").click();
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
		dom.window.document.querySelector("#format").click();
		assert.equal(edits, 1);
		assert.match(first.getValue(), /a >> p/);
		assert.equal(docs[0].querySelector(".normalized-edges").hidden, true);
		for (
			let attempt = 0;
			attempt < 1000 && !docs.every((d) => d.querySelector("#inner svg"));
			attempt++
		)
			await new Promise((resolve) => setTimeout(resolve, 5));
		assert.ok(docs.every((d) => d.querySelector("#inner svg")));
	} finally {
		for (const instance of instances.slice(start)) instance.dispose();
		for (const [name, previous] of globals) {
			if (previous) Object.defineProperty(globalThis, name, previous);
			else delete globalThis[name];
		}
		dom.window.close();
		rmSync(temporary, { recursive: true, force: true });
	}
});
