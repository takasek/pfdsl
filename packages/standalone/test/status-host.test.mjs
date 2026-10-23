import assert from "node:assert/strict";
import test from "node:test";
import {
	createHarness,
	FakeNative,
	flush,
} from "./helpers/lifecycle-harness.mjs";

const { startHost } = await createHarness("status-ui");

test("save completion for an earlier revision does not announce the newer edits as saved", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "original");
	let finish,
		hold = false;
	const host = await startHost(native, doc, {
		remember: () =>
			hold
				? new Promise((resolve) => {
						finish = resolve;
					})
				: undefined,
	});
	try {
		const a = await host.open(doc);
		a.type("saved revision");
		hold = true;
		host.menuItem("save").action();
		await flush();
		a.type("newer edits");
		finish();
		await host.settle();
		assert.equal(host.isDirty(a), true);
		assert.doesNotMatch(host.query("#status").textContent, /Saved\./);
	} finally {
		await host.finish();
	}
});

test("Save As target errors retain document recovery guidance across dismiss and tab switches", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "original");
	const host = await startHost(native, doc, {
		choose: async () => {
			throw new Error("Target unreadable");
		},
	});
	try {
		const a = await host.open(doc);
		a.type("unsaved text");
		await host.command("save-as");
		await host.newDocument();
		if (!host.query("#dismiss-status").hidden)
			host.query("#dismiss-status").click();
		assert.match(
			host.query("#status").textContent,
			/Save needs attention.*a.pfdsl.*Target unreadable/,
		);
		assert.equal(a.getSource(), "unsaved text");
	} finally {
		await host.finish();
	}
});

test("save failures survive edits, background completion and unrelated notices until a successful save", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "a >> p -> b");
	let reject,
		failed = true;
	const host = await startHost(native, doc, {
		inspectGate: () =>
			failed
				? new Promise((_, fail) => {
						reject = fail;
					})
				: undefined,
	});
	try {
		const a = await host.open(doc);
		const b = await host.newDocument();
		a.button.click();
		await flush();
		a.type("edited");
		host.menuItem("save").action();
		await flush();
		b.button.click();
		await flush();
		reject(new Error("Disk unavailable"));
		await host.settle();
		assert.match(
			host.query("#status").textContent,
			/Save needs attention.*a.pfdsl.*Disk unavailable/,
		);
		b.report("B completed");
		host.query("#dismiss-status").click();
		assert.match(host.query("#status").textContent, /Disk unavailable/);
		a.button.click();
		a.type("new edits");
		await flush();
		assert.match(
			host.query("#status").textContent,
			/Editor content is retained/,
		);
		assert.equal(a.getSource(), "new edits");
		failed = false;
		await host.command("save");
		assert.doesNotMatch(
			host.query("#status").textContent,
			/Save needs attention|Disk unavailable/,
		);
		assert.match(host.query("#status").textContent, /Saved/);
	} finally {
		await host.finish();
	}
});

test("action notices belong to a document revision and are separate from current diagnostics", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "a >> p -> b");
	const host = await startHost(native, doc);
	try {
		const a = await host.open(doc);
		a.report("Add criteria (W002).");
		assert.match(
			host.query("#status").textContent,
			/Last action.*a.pfdsl.*W002/,
		);
		assert.match(
			host.query("#diagnostics").textContent,
			/Current diagnostics.*No problems/,
		);
		const b = await host.newDocument();
		assert.doesNotMatch(host.query("#status").textContent, /W002/);
		a.report("Late result from A");
		assert.doesNotMatch(host.query("#status").textContent, /Late result/);
		a.button.click();
		await flush();
		a.type("new revision");
		assert.doesNotMatch(host.query("#status").textContent, /Late result/);
		a.report("Done");
		host.query("#dismiss-status").click();
		assert.equal(host.query("#status").textContent, "");
		assert.equal(host.query("#status").getAttribute("aria-live"), "polite");
		assert.ok(b);
	} finally {
		await host.finish();
	}
});
