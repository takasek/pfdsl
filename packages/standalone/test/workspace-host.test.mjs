import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	createHarness,
	FakeNative,
	flush,
} from "./helpers/lifecycle-harness.mjs";

const { startHost } = await createHarness("workspace-ui");
const productionStyles = readFileSync(
	new URL("../src/style.css", import.meta.url),
	"utf8",
);

function applyProductionStyles(host) {
	const style = host.dom.window.document.createElement("style");
	style.textContent = productionStyles;
	host.dom.window.document.head.append(style);
}

test("retains the previous folder until the replacement listing succeeds", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "a >> p -> b\n");
	let root = "/A";
	let listing = async () => ["/A/a.pfdsl"];
	const host = await startHost(native, doc, {
		selectFolder: () => root,
		listDocuments: () => listing(),
	});
	try {
		const toggle = host.query("#sidebar");
		assert.equal(toggle.hidden, true);
		assert.match(toggle.textContent, /Files/);
		assert.equal(toggle.getAttribute("aria-label"), "Show sidebar");
		assert.equal(toggle.getAttribute("aria-expanded"), "false");
		assert.equal(host.menuItem("sidebar").enabled, false);
		await host.command("open");
		assert.equal(toggle.hidden, false);
		assert.equal(toggle.getAttribute("aria-expanded"), "true");
		assert.equal(host.menuItem("sidebar").enabled, true);
		assert.equal(host.query("#folder-title").textContent, "A");
		assert.equal(
			host.query("#sidebar").getAttribute("aria-label"),
			"Hide sidebar",
		);
		await host.command("sidebar");
		assert.equal(
			host.query("#sidebar").getAttribute("aria-label"),
			"Show sidebar",
		);
		await host.command("sidebar");
		assert.equal(
			host.query("#sidebar").getAttribute("aria-label"),
			"Hide sidebar",
		);
		let reject;
		root = "/B";
		listing = () =>
			new Promise((_, no) => {
				reject = no;
			});
		host.menuItem("open").action();
		await flush();
		const titleWhilePending = host.query("#folder-title").textContent;
		reject(new Error("Cannot read B"));
		await host.settle();
		assert.equal(titleWhilePending, "A");
		assert.equal(host.query("#folder-title").textContent, "A");
		assert.equal(host.query("#files button").title, "/A/a.pfdsl");
		assert.match(host.query("#status").textContent, /Cannot read B/);
		root = "/C";
		listing = async () => ["/C/c.pfdsl"];
		await host.command("open");
		assert.equal(host.query("#folder-title").textContent, "C");
		assert.equal(host.query("#files button").title, "/C/c.pfdsl");
	} finally {
		await host.finish();
	}
});

test("native commands act on the workspace without hidden DOM command mirrors", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "unused.pfdsl", "unused");
	const host = await startHost(native, doc);
	try {
		assert.equal(host.query("#menu-commands"), null);
		assert.equal(host.query("#recent"), null);
		await host.command("new");
		assert.equal(host.tabs().length, 1);
		assert.equal(host.activeTab().getSource(), "");
		await host.command("close-tab");
		assert.equal(host.query("#start-screen").hidden, false);
	} finally {
		await host.finish();
	}
});

test("Try a sample opens a multiline sample only on request", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "unused.pfdsl", "unused");
	const host = await startHost(native, doc);
	try {
		await host.click(host.query("#try-sample"));
		assert.equal(host.tabs().length, 1);
		assert.equal(
			host.activeTab().getSource(),
			"---\ntitle: Sample flow\n---\nidea >> design -> plan\n",
		);
		assert.equal(host.nameOf(host.activeTab()), "Sample");
		assert.equal(host.dom.window.document.title, "Sample — PFDSL");
		assert.match(host.query("#document-state").textContent, /Not saved/);
	} finally {
		await host.finish();
	}
});

test("Save As suggests Sample.pfdsl for the sample document", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "unused.pfdsl", "unused");
	const host = await startHost(native, doc, { choose: async () => null });
	try {
		await host.click(host.query("#try-sample"));
		await host.command("save-as");
		assert.equal(
			host.log.findLast((item) => item.kind === "choose").name,
			"Sample.pfdsl",
		);
	} finally {
		await host.finish();
	}
});

test("New uses the smallest unused Untitled number without reusing the internal key", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "unused.pfdsl", "unused");
	const host = await startHost(native, doc);
	try {
		const first = await host.newDocument();
		const second = await host.newDocument();
		const third = await host.newDocument();
		assert.deepEqual(
			[first, second, third].map((tab) => host.nameOf(tab)),
			["Untitled 1", "Untitled 2", "Untitled 3"],
		);
		await host.click(host.closeButton(second));
		const replacement = await host.newDocument();
		assert.equal(host.nameOf(replacement), "Untitled 2");
		assert.equal(replacement.key, "document-4");
	} finally {
		await host.finish();
	}
});

test("tabs own selection and close controls while the header shows only state and location", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "unused.pfdsl", "unused");
	const host = await startHost(native, doc);
	try {
		const location = host.query("#document-location");
		assert.equal(host.query("#document-name"), null);
		assert.equal(host.query("#location-details"), null);
		assert.equal(location.tagName, "SPAN");
		assert.equal(location.hidden, true);
		assert.equal(location.textContent, "");
		const tab = await host.newDocument();
		const wrapper = tab.button.parentElement;
		const close = host.closeButton(tab);
		assert.equal(wrapper.classList.contains("selected"), true);
		assert.equal(wrapper.getAttribute("role"), "none");
		assert.equal(tab.button.getAttribute("role"), "tab");
		assert.equal(tab.button.getAttribute("aria-selected"), "true");
		assert.equal(close.getAttribute("tabindex"), "-1");
		assert.equal(close.getAttribute("aria-label"), "Close Untitled 1");
		assert.equal(host.dom.window.document.title, "Untitled 1 — PFDSL");
		assert.equal(location.textContent, "Not saved to a file");
		assert.equal(location.title, "Not saved to a file");
		applyProductionStyles(host);
		const style = host.dom.window.getComputedStyle.bind(host.dom.window);
		assert.equal(style(wrapper).backgroundColor, "rgb(230, 240, 255)");
		assert.equal(style(wrapper).borderTopColor, "rgb(51, 105, 160)");
		assert.equal(style(tab.button).backgroundColor, "rgba(0, 0, 0, 0)");
		assert.equal(style(close).backgroundColor, "rgba(0, 0, 0, 0)");
		assert.match(
			productionStyles,
			/\.document-tab > button\s*\{[^}]*border: none;[^}]*background: transparent;/s,
		);
		assert.equal(style(location).whiteSpace, "nowrap");
		assert.equal(style(location).overflow, "hidden");
		assert.equal(style(location).textOverflow, "ellipsis");
		assert.notEqual(style(location).userSelect, "none");
		await host.click(close);
		assert.equal(location.hidden, true);
		assert.equal(location.textContent, "");
	} finally {
		await host.finish();
	}
});

test("starts empty, creates only on request, and returns to the start screen after the last close", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "a >> p -> b\n");
	const host = await startHost(native, doc);
	try {
		assert.equal(host.tabs().length, 0);
		assert.equal(host.query("#start-screen").hidden, false);
		assert.equal(!host.menuItem("save").enabled, true);
		assert.equal(!host.menuItem("format").enabled, true);
		const tab = await host.newDocument();
		assert.equal(host.query("#start-screen").hidden, true);
		assert.match(host.query("#document-state").textContent, /Not saved/);
		await host.click(host.closeButton(tab));
		assert.equal(host.query("#start-screen").hidden, false);
	} finally {
		await host.finish();
	}
});

test("keeps document state current through edits and tab switches, disambiguating same-name files visibly", async () => {
	const native = new FakeNative();
	const first = native.add(1, "same.pfdsl", "first");
	const second = native.add(2, "other.pfdsl", "second");
	second.path = "/B/same.pfdsl";
	const host = await startHost(native, first);
	try {
		const a = await host.open(first);
		a.type("edited");
		assert.match(host.query("#document-state").textContent, /Modified/);
		await host.open(second);
		assert.match(host.query("#document-state").textContent, /Saved/);
		assert.match(a.button.textContent, /A/);
		assert.match(host.activeTab().button.textContent, /B/);
		assert.match(host.query("#document-location").textContent, /B\/same.pfdsl/);
		assert.equal(host.query("#document-location").title, "/B/same.pfdsl");
		assert.equal(host.dom.window.document.title, "same.pfdsl — PFDSL");
		a.button.click();
		assert.match(host.query("#document-state").textContent, /Modified/);
		assert.equal(host.query("#document-location").title, "/A/same.pfdsl");
	} finally {
		await host.finish();
	}
});
