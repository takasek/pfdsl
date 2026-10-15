import assert from "node:assert/strict";
import test from "node:test";
import { createHarness, FakeNative } from "./helpers/lifecycle-harness.mjs";

const { startHost } = await createHarness("workspace-ui");

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
		assert.equal(host.query("#save").disabled, true);
		assert.equal(host.query("#format").disabled, true);
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
