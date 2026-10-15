import assert from "node:assert/strict";
import test from "node:test";
import {
	createHarness,
	FakeNative,
	flush,
} from "./helpers/lifecycle-harness.mjs";

const { startHost } = await createHarness("workspace-ui");

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
		await host.command("open");
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
		assert.match(host.query("#document-state").textContent, /Not saved/);
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
		a.button.click();
		assert.match(host.query("#document-state").textContent, /Modified/);
	} finally {
		await host.finish();
	}
});
