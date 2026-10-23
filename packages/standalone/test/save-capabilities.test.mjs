import assert from "node:assert/strict";
import test from "node:test";
import { createHarness, FakeNative } from "./helpers/lifecycle-harness.mjs";

const { startHost } = await createHarness("save-capabilities");
const reason = "Safe document saving is currently supported on macOS only.";

test("unsupported saving is explained before any chooser, confirmation or write", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "original");
	const host = await startHost(native, doc, {
		capabilities: () => ({ save: false, reason }),
	});
	try {
		assert.equal(!host.menuItem("save").enabled, true);
		assert.equal(!host.menuItem("save-as").enabled, true);
		assert.equal(host.query("#save-support").textContent, reason);
		const tab = await host.open(doc);
		tab.type("local");
		await host.cmdS();
		assert.equal(doc.writes, 0);
		assert.equal(
			host.log.some(
				(item) =>
					item.kind === "dialog" ||
					item.kind === "save" ||
					item.kind === "choose",
			),
			false,
		);
		assert.equal(host.isDirty(tab), true);
		host.query("#dismiss-status").click();
		assert.equal(host.query("#status").textContent, "");
		assert.equal(host.query("#save-support").textContent, reason);
		native.save(doc, "external", native.snapshot(doc).revision);
		await host.runPoll();
		assert.equal(host.panel().review.disabled, true);
		assert.equal(host.panel().saveAs.disabled, true);
		assert.equal(host.panel().use.disabled, false);
		assert.equal(host.query("#save-support").textContent, reason);
	} finally {
		await host.finish();
	}
});

test("saving stays disabled while capability lookup is pending and after failure", async () => {
	let reject;
	const native = new FakeNative();
	const doc = native.add(2, "pending.pfdsl", "original");
	const host = await startHost(native, doc, {
		capabilities: () =>
			new Promise((_, no) => {
				reject = no;
			}),
	});
	try {
		assert.equal(!host.menuItem("save").enabled, true);
		const tab = await host.open(doc);
		tab.type("local");
		await host.cmdS();
		assert.equal(doc.writes, 0);
		reject(new Error("IPC unavailable"));
		await host.settle();
		assert.equal(!host.menuItem("save-as").enabled, true);
		assert.match(
			host.query("#save-support").textContent,
			/Could not determine.*IPC unavailable/,
		);
		assert.equal(
			host.query("#status").textContent,
			`Last action — ${doc.path}: ${host.query("#save-support").textContent}`,
		);
	} finally {
		await host.finish();
	}
});

test("supported saving preserves normal Save and Save As availability", async () => {
	const native = new FakeNative();
	const doc = native.add(3, "supported.pfdsl", "original");
	const host = await startHost(native, doc);
	try {
		assert.equal(!host.menuItem("save").enabled, true);
		const tab = await host.open(doc);
		assert.equal(!host.menuItem("save").enabled, false);
		assert.equal(!host.menuItem("save-as").enabled, false);
		assert.equal(host.query("#save-support").textContent, "");
		tab.type("local");
		await host.cmdS();
		assert.equal(doc.file.source, "local");
		assert.equal(host.isDirty(tab), false);
	} finally {
		await host.finish();
	}
});

for (const capability of [undefined, { save: false }, { save: "yes" }]) {
	test(`invalid capability stays disabled: ${JSON.stringify(capability)}`, async () => {
		const native = new FakeNative();
		const doc = native.add(4, "invalid.pfdsl", "original");
		const host = await startHost(native, doc, {
			capabilities: () => capability,
		});
		try {
			assert.equal(!host.menuItem("save").enabled, true);
			assert.match(
				host.query("#save-support").textContent,
				/Invalid document saving capability/,
			);
		} finally {
			await host.finish();
		}
	});
}

test("unsupported dirty close retains text on Cancel and disposes only on Discard", async () => {
	const native = new FakeNative();
	const doc = native.add(5, "dirty.pfdsl", "original");
	let choice = "cancel";
	const host = await startHost(native, doc, {
		capabilities: () => ({ save: false, reason }),
		confirm: () => choice,
	});
	try {
		const tab = await host.open(doc);
		tab.type("local");
		await host.click(host.closeButton(tab));
		assert.equal(host.isOpen(tab), true);
		assert.equal(tab.getSource(), "local");
		assert.equal(
			host.log.findLast((item) => item.kind === "confirm").allowSave,
			false,
		);
		choice = "discard";
		await host.click(host.closeButton(tab));
		assert.equal(host.isOpen(tab), false);
		assert.equal(doc.writes, 0);
		assert.equal(doc.file.source, "original");
	} finally {
		await host.finish();
	}
});

test("capability completion re-enables saving after a pending lookup", async () => {
	let resolve;
	const native = new FakeNative();
	const doc = native.add(6, "pending-supported.pfdsl", "original");
	const host = await startHost(native, doc, {
		capabilities: () =>
			new Promise((yes) => {
				resolve = yes;
			}),
	});
	try {
		assert.equal(!host.menuItem("save").enabled, true);
		const tab = await host.open(doc);
		tab.type("local");
		await host.cmdS();
		assert.match(host.query("#status").textContent, /Checking document/);
		resolve({ save: true, reason: null });
		await host.settle();
		assert.equal(!host.menuItem("save").enabled, false);
		assert.equal(host.query("#save-support").textContent, "");
		assert.doesNotMatch(host.query("#status").textContent, /Checking document/);
	} finally {
		await host.finish();
	}
});
