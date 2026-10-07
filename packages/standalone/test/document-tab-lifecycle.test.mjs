import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import {
	instances,
	markerCalls,
	snapshotCalls,
} from "./helpers/lifecycle-monaco.mjs";

async function waitFor(predicate) {
	for (let attempt = 0; attempt < 1000; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.fail("Document preview did not finish rendering");
}

test("standalone document host disposal blocks pending snapshots and queued editor repaint without affecting the next document", async () => {
	const packageRoot = fileURLToPath(new URL("../", import.meta.url));
	const temporary = mkdtempSync(join(packageRoot, "node_modules/.lifecycle-"));
	const output = join(temporary, "document-tab.mjs");
	const seam = fileURLToPath(
		new URL("./helpers/lifecycle-monaco.mjs", import.meta.url),
	);
	const dom = new JSDOM("<main></main>", { pretendToBeVisual: true });
	const previousDocument = Object.getOwnPropertyDescriptor(
		globalThis,
		"document",
	);
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
					name: "controlled-editor",
					setup(builder) {
						builder.onResolve({ filter: /lifecycle-monaco\.mjs$/ }, () => ({
							path: seam,
							external: true,
						}));
						builder.onResolve({ filter: /^monaco-editor\// }, () => ({
							path: seam,
							external: true,
						}));
						builder.onResolve({ filter: /^\.\/processing\.js$/ }, () => ({
							path: "snapshot-completion",
							namespace: "observe-snapshot",
						}));
						builder.onLoad(
							{ filter: /.*/, namespace: "observe-snapshot" },
							() => ({
								contents: `
import { processSnapshot as process, formatSnapshot } from ${JSON.stringify(join(packageRoot, "src/processing.ts"))};
import { snapshotCalls } from ${JSON.stringify(seam)};
export { formatSnapshot };
export async function processSnapshot(...args) {
  const call = { source: args[0], finished: false };
  snapshotCalls.push(call);
  try { return await process(...args); }
  finally { call.finished = true; }
}`,
								resolveDir: packageRoot,
							}),
						);
					},
				},
			],
		});
		const { createDocumentTab } = await import(pathToFileURL(output).href);
		const parent = dom.window.document.querySelector("main");
		let finishRead;
		const statuses = [];
		const options = {
			parent,
			path: "/verification/entry.pfdsl",
			read: () =>
				new Promise((resolve) => {
					finishRead = resolve;
				}),
			reportStatus: (status) => statuses.push(status),
		};
		const first = createDocumentTab({
			...options,
			key: "first",
			name: "First",
			source: "a >> p -> b\n",
		});
		tabs.push(first);
		first.activate();
		await waitFor(() => first.container.querySelector("#inner svg"));
		const oldEditor = instances.at(-1);
		oldEditor.model.source = "---\nextends: delayed.yaml\n---\na >> p -> b\n";
		oldEditor.callbacks.onDidChangeModelContent();
		await waitFor(() => finishRead);
		const pendingSnapshot = snapshotCalls.at(-1);
		assert.equal(pendingSnapshot.finished, false);
		const markersBefore = markerCalls.filter(
			(c) => c.model === oldEditor.model,
		).length;
		oldEditor.callbacks.onDidChangeCursorSelection();
		first.dispose();
		const rendersAtDisposal = oldEditor.renders;
		assert.equal(oldEditor.disposed, true);
		assert.equal(oldEditor.model.disposed, true);
		assert.equal(first.container.isConnected, false);
		const next = createDocumentTab({
			...options,
			key: "next",
			name: "Next",
			source: "x >> y -> z\n",
		});
		tabs.push(next);
		next.activate();
		await waitFor(() => next.container.querySelector("#inner svg"));
		const nextMarkup = next.container.innerHTML;
		finishRead("{}\n");
		await waitFor(() => pendingSnapshot.finished);
		await Promise.resolve();
		assert.equal(oldEditor.renders, rendersAtDisposal);
		assert.equal(
			markerCalls.filter((c) => c.model === oldEditor.model).length,
			markersBefore,
		);
		assert.equal(next.container.innerHTML, nextMarkup);
		assert.equal(
			next.container.querySelector('g[data-node-id="y"]') !== null,
			true,
		);
		assert.deepEqual(statuses, []);
	} finally {
		for (const tab of tabs) tab.dispose();
		if (previousDocument)
			Object.defineProperty(globalThis, "document", previousDocument);
		else delete globalThis.document;
		dom.window.close();
		rmSync(temporary, { recursive: true, force: true });
	}
});
