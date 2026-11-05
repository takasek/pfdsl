import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHarness, FakeNative } from "./helpers/lifecycle-harness.mjs";

const { startHost } = await createHarness("narrow-window");
const styles = readFileSync(
	new URL("../src/style.css", import.meta.url),
	"utf8",
);
const tauri = JSON.parse(
	readFileSync(
		new URL("../src-tauri/tauri.conf.json", import.meta.url),
		"utf8",
	),
);

test("collapses the sidebar below 933px and restores it at 933px", async () => {
	const native = new FakeNative();
	const host = await startHost(
		native,
		native.add(1, "flow.pfdsl", "a >> p -> b"),
		{
			selectFolder: () => "/work",
			listDocuments: () => ["/work/flow.pfdsl"],
		},
	);
	const { window } = host.dom;
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		writable: true,
		value: 934,
	});
	try {
		await host.command("open");
		assert.equal(host.query("#folder-sidebar").hidden, false);
		window.innerWidth = 932;
		window.dispatchEvent(new window.Event("resize"));
		assert.equal(host.query("#folder-sidebar").hidden, true);
		assert.equal(
			host.query("#sidebar").getAttribute("aria-label"),
			"Show sidebar",
		);

		window.innerWidth = 933;
		window.dispatchEvent(new window.Event("resize"));
		assert.equal(host.query("#folder-sidebar").hidden, false);
		assert.equal(
			host.query("#sidebar").getAttribute("aria-label"),
			"Hide sidebar",
		);
	} finally {
		await host.finish();
	}
});

test("manual sidebar toggles keep their choice until another threshold crossing", async () => {
	const native = new FakeNative();
	const host = await startHost(
		native,
		native.add(1, "flow.pfdsl", "a >> p -> b"),
		{
			selectFolder: () => "/work",
			listDocuments: () => ["/work/flow.pfdsl"],
		},
	);
	const { window } = host.dom;
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		writable: true,
		value: 934,
	});
	try {
		await host.command("open");
		window.innerWidth = 932;
		window.dispatchEvent(new window.Event("resize"));
		assert.equal(host.query("#folder-sidebar").hidden, true);

		await host.command("sidebar");
		assert.equal(host.query("#folder-sidebar").hidden, false);
		window.innerWidth = 931;
		window.dispatchEvent(new window.Event("resize"));
		assert.equal(host.query("#folder-sidebar").hidden, false);
		window.innerWidth = 933;
		window.dispatchEvent(new window.Event("resize"));
		assert.equal(host.query("#folder-sidebar").hidden, false);

		await host.command("sidebar");
		assert.equal(host.query("#folder-sidebar").hidden, true);
		window.innerWidth = 932;
		window.dispatchEvent(new window.Event("resize"));
		assert.equal(host.query("#folder-sidebar").hidden, true);
		window.innerWidth = 933;
		window.dispatchEvent(new window.Event("resize"));
		assert.equal(host.query("#folder-sidebar").hidden, true);
		assert.equal(
			host.query("#sidebar").getAttribute("aria-label"),
			"Show sidebar",
		);
	} finally {
		await host.finish();
	}
});

test("opening a folder below the threshold keeps it collapsed until width returns", async () => {
	const native = new FakeNative();
	const host = await startHost(
		native,
		native.add(1, "flow.pfdsl", "a >> p -> b"),
		{
			selectFolder: () => "/work",
			listDocuments: () => ["/work/flow.pfdsl"],
		},
	);
	const { window } = host.dom;
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		writable: true,
		value: 932,
	});
	try {
		window.dispatchEvent(new window.Event("resize"));
		await host.command("open");
		assert.equal(host.query("#folder-sidebar").hidden, true);
		assert.equal(
			host.query("#sidebar").getAttribute("aria-label"),
			"Show sidebar",
		);

		window.innerWidth = 933;
		window.dispatchEvent(new window.Event("resize"));
		assert.equal(host.query("#folder-sidebar").hidden, false);
		assert.equal(
			host.query("#sidebar").getAttribute("aria-label"),
			"Hide sidebar",
		);
	} finally {
		await host.finish();
	}
});

test("editor minimum width and max width reserve preview and divider", () => {
	assert.match(styles, /--editor-min-width:\s*440px/);
	assert.match(styles, /--preview-min-width:\s*260px/);
	assert.match(styles, /--workspace-divider-width:\s*6px/);
	const editorRule = styles.match(/\.editor\s*\{([^}]*)\}/s)?.[1];
	const previewRule = [
		...styles.matchAll(/\.preview-column\s*\{([^}]*)\}/gs),
	].at(-1)?.[1];
	assert.ok(editorRule);
	assert.ok(previewRule);
	assert.match(editorRule, /min-width:\s*var\(--editor-min-width\)/);
	const maxWidth = editorRule.match(/max-width:\s*calc\(([\s\S]*?)\);/)?.[1];
	assert.equal(
		maxWidth?.replace(/\s+/g, " ").trim(),
		"100% - var(--preview-min-width) - var(--workspace-divider-width)",
	);
	assert.match(previewRule, /min-width:\s*var\(--preview-min-width\)/);
});

test("the main native window declares a 706px minimum width", () => {
	const mainWindow = tauri.app.windows.find(
		(window) => window.label === "main",
	);
	assert.equal(mainWindow?.minWidth, 706);
});
