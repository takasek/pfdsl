import assert from "node:assert/strict";
import { globSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { computeFullDocumentFormatOutput } from "@pfdsl/editor";
import { mountPreview } from "@pfdsl/editor/preview";
import { JSDOM } from "jsdom";
import {
	clearAnalyzeCache,
	preparePreviewForDocument,
} from "../../vscode-extension/dist/analysis-host.cjs";
import { formatSnapshot, processSnapshot } from "../dist/processing.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const files = globSync("docs/samples/*.pfdsl", { cwd: root })
	.sort()
	.concat([
		".pfdsl/roadmap.pfdsl",
		".pfdsl/workflow.pfdsl",
		".pfdsl/pipeline.pfdsl",
	]);
const read = async (path) => {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
};

test("same authored inputs reach both production snapshot adapters and shared DOM renderer", async () => {
	assert.ok(files.length > 3);
	clearAnalyzeCache();
	for (const file of files) {
		const path = join(root, file);
		const source = readFileSync(path, "utf8");
		const doc = {
			uri: { scheme: "file", fsPath: path, toString: () => `file://${path}` },
			version: 1,
			getText: () => source,
		};
		const vscode = preparePreviewForDocument(doc);
		const tauri = await processSnapshot(source, path, read);
		assert.deepEqual(
			tauri.model,
			vscode.model,
			`${file}: analysis, diagnosis ranges and authored source map`,
		);
		assert.deepEqual(
			tauri.presetDiagnostics,
			vscode.presetDiagnostics,
			`${file}: dependency diagnostics`,
		);
		assert.deepEqual(
			tauri.frontmatter,
			vscode.frontmatter,
			`${file}: presentation`,
		);
		assert.deepEqual(
			tauri.message,
			vscode.message,
			`${file}: preview protocol and DOT`,
		);
		assert.equal(
			formatSnapshot(source),
			computeFullDocumentFormatOutput(doc.getText(), "flows"),
			`${file}: formatting`,
		);
		const dom = new JSDOM("<div id='vscode'></div><div id='tauri'></div>", {
			pretendToBeVisual: true,
		});
		const v = mountPreview(dom.window.document.getElementById("vscode"), {
			postMessage() {},
		});
		const t = mountPreview(dom.window.document.getElementById("tauri"), {
			postMessage() {},
		});
		await Promise.all([v.receive(vscode.message), t.receive(tauri.message)]);
		assert.equal(
			dom.window.document.querySelector("#tauri #inner").innerHTML,
			dom.window.document.querySelector("#vscode #inner").innerHTML,
			`${file}: SVG node, edge, label, direction and feedback markup`,
		);
		if (vscode.message.type === "render")
			assert.ok(
				dom.window.document.querySelector("#tauri #inner > svg"),
				`${file}: a successful render must create SVG`,
			);
		v.dispose();
		t.dispose();
		dom.window.close();
	}
});

test("new and unsaved documents keep entry identity and report malformed inputs consistently", async () => {
	for (const source of [
		"a >>",
		"---\nartifact: [\n---\na >> p -> b",
		"---\nextends: missing.yaml\n---\na >> p -> b",
	]) {
		const path = join(root, "new-acceptance.pfdsl");
		const doc = {
			uri: { scheme: "file", fsPath: path, toString: () => `file://${path}` },
			version: source.length,
			getText: () => source,
		};
		clearAnalyzeCache();
		assert.deepEqual(
			await processSnapshot(source, path, read),
			preparePreviewForDocument(doc),
		);
	}
});

test("product browser assets contain no unresolved Node or Puppeteer runtime", () => {
	const directory = fileURLToPath(new URL("../dist/assets/", import.meta.url));
	const scripts = readdirSync(directory).filter((file) => file.endsWith(".js"));
	assert.ok(scripts.length > 0);
	for (const file of scripts) {
		const script = readFileSync(join(directory, file), "utf8");
		assert.doesNotMatch(
			script,
			/__vite-browser-external|from\s*["']node:|import\(["']puppeteer["']\)/,
			file,
		);
	}
});
