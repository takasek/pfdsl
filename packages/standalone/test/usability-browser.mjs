// Run explicitly after build. This checks Chromium geometry, not native WebKit acceptance.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(
	new URL("../../vscode-extension/package.json", import.meta.url),
);
const { chromium } = require("playwright-core");
const server = await createServer({
	root,
	server: { port: 0, strictPort: false, host: "127.0.0.1" },
});
let browser;
try {
	await server.listen();
	browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({
		viewport: { width: 1180, height: 812 },
	});
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(server.resolvedUrls.local[0]);
	await page.getByRole("button", { name: "Try a sample" }).click();
	for (let i = 0; i < 15; i++)
		await page.evaluate(() =>
			document.querySelector('[data-start="new"]').click(),
		);
	for (const [key, expected] of [
		["Control+Tab", "Sample"],
		["Control+Shift+Tab", "Untitled 15"],
		["Control+Shift+Tab", "Untitled 14"],
	]) {
		await page.keyboard.press(key);
		assert.equal(
			await page.locator('[role="tab"][aria-selected="true"]').textContent(),
			expected,
		);
		const visible = await page.evaluate(() => {
			const bar = document.querySelector("#tabs").getBoundingClientRect();
			const active = document
				.querySelector('[role="tab"][aria-selected="true"]')
				.parentElement.getBoundingClientRect();
			return active.left >= bar.left - 1 && active.right <= bar.right + 1;
		});
		assert.equal(visible, true, `active tab visible after ${key}`);
		if (expected === "Sample")
			await page.getByRole("button", { name: "Fit", exact: true }).click();
	}
	console.log("PASS overflowing tabs and trusted Ctrl+Tab events");
	await page.goto(server.resolvedUrls.local[0]);
	await page.evaluate(async () => {
		const { createDocumentTab } = await import("/src/document-tab.ts");
		const parent = document.querySelector("#documents");
		parent.hidden = false;
		document.querySelector("#start-screen").hidden = true;
		const ids = Array.from(
			{ length: 12 },
			(_, i) => `long_descriptive_artifact_identifier_${i}`,
		);
		const source = `---\nartifact: {b: {criteria: Check final result}}\n---\n[${ids.join(", ")}] >> p -> b\nb >> q -> [${ids.map((id) => `${id}_output`).join(", ")}]\n`;
		window.usabilityTab = createDocumentTab({
			parent,
			key: "usability",
			name: "Usability",
			source,
			path: "/work/entry.pfdsl",
			read: async () => null,
			reportStatus: () => {},
			referenceServices: {
				context: async () => "/work/entry.pfdsl",
				compareFile: async () => ({
					source: source.replace("Check final result", "Review result"),
					label: `/work/${"long-directory/".repeat(12)}baseline.pfdsl`,
				}),
			},
		});
		window.usabilityTab.activate();
	});
	await page.locator("#inner svg").waitFor();
	const originalSource = await page.evaluate(() =>
		window.usabilityTab.getSource(),
	);
	await page.evaluate(() => window.usabilityTab.command("pfdsl.compareFile"));
	await page.locator(".reference-comparison").waitFor();
	for (const width of [1180, 898]) {
		await page.setViewportSize({ width, height: 812 });
		for (const ratio of [0.5, 0.7, 0.9]) {
			await page.evaluate(
				(ratio) =>
					document
						.querySelector(".document")
						.style.setProperty("--source-ratio", ratio),
				ratio,
			);
			const diff = await page.locator("#diff-panel").boundingBox();
			const banner = await page.locator(".reference-comparison").boundingBox();
			assert.ok(
				diff.height > 0 && diff.y + diff.height <= banner.y + 1,
				"diff rows above banner",
			);
			assert.match(
				await page.locator("#diff-panel").textContent(),
				/~ node\s+b/,
			);
			await page.evaluate(() => window.usabilityTab.normalize());
			const list = await page.locator(".normalized-edges").boundingBox();
			const map = await page.locator("#minimap").boundingBox();
			assert.ok(
				map.y + map.height <= list.y + 1,
				"minimap outside normalized list",
			);
			const editor = await page.locator(".editor").boundingBox();
			assert.ok(
				list.x >= editor.x + editor.width,
				"list stays outside source editor",
			);
			await page.locator(".normalized-edges pre").evaluate((element) => {
				element.scrollLeft = element.scrollWidth;
				element.parentElement.scrollTop = element.parentElement.scrollHeight;
			});
			await page.keyboard.press("Escape");
			assert.equal(await page.locator(".normalized-edges").isVisible(), false);
			assert.equal(
				await page.evaluate(() => window.usabilityTab.getSource()),
				originalSource,
				"inspection preserves the exact source",
			);
		}
	}
	console.log(
		"PASS comparison and normalized edges geometry at 1180/898px, 50/70/90% source",
	);
	await page.evaluate(() => {
		window.usabilityTab.setSource(
			window.usabilityTab
				.getSource()
				.replace("---\n", "---\nextends: missing.yaml\n")
				.replaceAll("long_descriptive_", "changed_descriptive_"),
		);
	});
	await page.locator(".dependency-problems").waitFor();
	await page.locator("#diff-panel .diff-add").first().waitFor();
	await page.evaluate(() => window.usabilityTab.normalize());
	const crowdedDiff = await page.locator("#diff-panel").boundingBox();
	const crowdedPreview = await page.locator(".preview").boundingBox();
	assert.ok(
		crowdedDiff.y + crowdedDiff.height <=
			crowdedPreview.y + crowdedPreview.height + 1,
		`multi-row diff stays inside preview with dependency and normalized panels open: ${JSON.stringify(await page.evaluate(() => [...document.querySelector(".preview-column").children, ...document.querySelector(".preview").children].map((e) => ({ class: e.className, id: e.id, height: e.getBoundingClientRect().height, y: e.getBoundingClientRect().y, maxHeight: getComputedStyle(e).maxHeight, shrink: getComputedStyle(e).flexShrink }))))}`,
	);
	await page.evaluate(() => {
		window.usabilityTab.command("preview-help-toggle");
		window.usabilityTab.command("node-actions-toggle");
	});
	assert.ok(
		await page.evaluate(() => {
			const preview = document.querySelector(".preview");
			return (
				preview.scrollHeight <= preview.clientHeight + 1 ||
				["auto", "scroll"].includes(getComputedStyle(preview).overflowY)
			);
		}),
		"overflowed preview remains user-scrollable",
	);
	await page.evaluate(() => {
		document.querySelector(".preview").scrollTop =
			document.querySelector(".preview").scrollHeight;
		document.querySelector("#diff-panel").scrollTop =
			document.querySelector("#diff-panel").scrollHeight;
	});
	const lastDiff = await page
		.locator("#diff-panel > :last-child")
		.boundingBox();
	const crowdedViewport = await page.locator(".preview").boundingBox();
	assert.ok(
		lastDiff.y + lastDiff.height <=
			crowdedViewport.y + crowdedViewport.height + 1,
		"last diff row is reachable with Help and Connections also open",
	);
	await page.evaluate(() => {
		window.usabilityTab.command("preview-help-toggle");
		window.usabilityTab.command("node-actions-toggle");
		document.querySelector(".normalized-edges pre").focus();
	});
	await page.keyboard.press("Escape");
	await page.evaluate(
		(source) => window.usabilityTab.setSource(source),
		originalSource,
	);
	await page.locator(".dependency-problems").waitFor({ state: "hidden" });
	await page.setViewportSize({ width: 1180, height: 812 });
	await page.evaluate(() => window.usabilityTab.command("pfdsl.clearDiff"));
	assert.equal(
		await page.evaluate(() => window.usabilityTab.getSource()),
		originalSource,
		"clearing comparison preserves the exact source",
	);
	await page.evaluate(() => {
		document
			.querySelector(".document")
			.style.setProperty("--source-ratio", "0.5");
		window.usabilityTab.command("pfdsl.clearDiff");
		window.usabilityTab.setSource(
			'---\ngroup:\n  delivery: { label: Delivery }\nartifact:\n  package_manifest:\n    label: "package manifest"\n    criteria: "Checksums match the packaged files"\n    group: delivery\nprocess:\n  package_release: { label: Package release }\n  publish_release: { label: Publish release }\n---\nsource >> package_release -> package_manifest\npackage_manifest >> publish_release -> announcement\n',
		);
		window.usabilityTab.command("cursorBottom");
		window.usabilityTab.command("cursorUp");
		window.usabilityTab.command("cursorHome");
		window.usabilityTab.command("editor.action.showHover");
	});
	await page.locator(".monaco-hover").waitFor();
	assert.match(
		await page.locator(".monaco-hover").textContent(),
		/Checksums match/,
	);
	const screenshot = join(
		mkdtempSync(join(tmpdir(), "pfdsl-usability-")),
		"hover.png",
	);
	await page.screenshot({ path: screenshot });
	console.log(`Hover screenshot: ${screenshot}`);
	await page.keyboard.press("Escape");
	await page.locator(".monaco-hover").waitFor({ state: "hidden" });
	await page.keyboard.type("edited_");
	assert.ok(
		await page.evaluate(() =>
			window.usabilityTab.getSource().includes("edited_package_manifest"),
		),
	);
	assert.deepEqual(errors, []);
	console.log(
		"PASS report rich-hover fixture, screenshot, Escape and subsequent editing (Chromium only)",
	);
} finally {
	await browser?.close();
	await server.close();
}
