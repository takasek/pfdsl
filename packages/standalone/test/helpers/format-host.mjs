import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
export async function withFormatHost(entry, seam, instances, run) {
	const temporary = mkdtempSync(
		join(packageRoot, "node_modules/.format-style-"),
	);
	const output = join(temporary, "host.mjs");
	const dom = new JSDOM(
		entry === "main"
			? readFileSync(join(packageRoot, "index.html"), "utf8")
			: "<main></main>",
		{ pretendToBeVisual: true },
	);
	const previous = new Map(
		["document", "window", "self"].map((name) => [
			name,
			Object.getOwnPropertyDescriptor(globalThis, name),
		]),
	);
	const start = instances.length;
	const tabs = [];
	try {
		for (const name of previous.keys())
			Object.defineProperty(globalThis, name, {
				value: name === "document" ? dom.window.document : dom.window,
				configurable: true,
			});
		await build({
			entryPoints: [join(packageRoot, `src/${entry}.ts`)],
			outfile: output,
			bundle: true,
			platform: "node",
			format: "esm",
			packages: "external",
			loader: { ".css": "empty" },
			plugins: [
				{
					name: "controlled-monaco",
					setup(builder) {
						builder.onResolve(
							{ filter: /^monaco-editor\/.*\?worker$/ },
							() => ({ path: "worker", namespace: "stub-worker" }),
						);
						builder.onLoad({ filter: /.*/, namespace: "stub-worker" }, () => ({
							contents: "export default class Worker {}",
						}));
						builder.onResolve({ filter: /^monaco-editor\// }, () => ({
							path: seam,
							external: true,
						}));
					},
				},
			],
		});
		const module = await import(pathToFileURL(output).href);
		const create = (source) => {
			const tab = module.createDocumentTab({
				parent: dom.window.document.querySelector("main"),
				key: `doc-${tabs.length}`,
				name: "Test",
				source,
				path: null,
				read: async () => assert.fail("Formatting must not read disk"),
				reportStatus() {},
			});
			tabs.push(tab);
			return { tab, editor: instances.at(-1) };
		};
		await run({
			create,
			document: dom.window.document,
			editors: instances.slice(start),
		});
		if (entry === "main") {
			const docs = [...dom.window.document.querySelectorAll(".document")];
			for (
				let attempt = 0;
				attempt < 1000 && !docs.every((d) => d.querySelector("#inner svg"));
				attempt++
			)
				await new Promise((resolve) => setTimeout(resolve, 5));
			assert.ok(
				docs.every((d) => d.querySelector("#inner svg")),
				"Production preview must complete",
			);
		}
	} finally {
		for (const tab of tabs) tab.dispose();
		for (const editor of instances.slice(start)) editor.dispose();
		for (const [name, value] of previous) {
			if (value) Object.defineProperty(globalThis, name, value);
			else delete globalThis[name];
		}
		dom.window.close();
		rmSync(temporary, { recursive: true, force: true });
	}
}
