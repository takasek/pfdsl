import assert from "node:assert/strict";
import test from "node:test";
import { createHarness, FakeNative } from "./helpers/lifecycle-harness.mjs";

const { startHost } = await createHarness("diagnostics-integration", {
	realDocumentTabs: true,
});
async function until(predicate) {
	for (let i = 0; i < 1000; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.fail("Diagnostics did not settle");
}
test("real analysis summaries reach the active host and distinguish same-name documents", async () => {
	const native = new FakeNative();
	const source = "---\nartifact:\n  b: {label: B}\n---\na >> p -> b\n";
	const a = native.add(1, "same.pfdsl", source);
	const b = native.add(2, "same.pfdsl", source);
	b.binding = "directoryB:same.pfdsl";
	native.move(a, "/A/same.pfdsl");
	native.move(b, "/B/same.pfdsl");
	const host = await startHost(native, a);
	try {
		const first = await host.open(a);
		const text = () => host.query("#diagnostics").textContent;
		await until(() => text().includes("1 warning"));
		assert.doesNotMatch(text(), /hints/);
		assert.match(text(), /Current diagnostics — \/A\/same.pfdsl:/);
		first.type(
			"---\nartifact:\n  b: {label: B, criteria: Ready}\n---\na >> p -> b\n",
		);
		assert.match(text(), /Checking/);
		await until(() => !text().includes("Checking"));
		assert.doesNotMatch(text(), /1 warning/);
		await host.open(b);
		await until(() => text().includes("1 warning"));
		assert.match(text(), /Current diagnostics — \/B\/same.pfdsl:/);
		first.button.click();
		assert.match(text(), /Current diagnostics — \/A\/same.pfdsl:/);
		assert.doesNotMatch(text(), /1 warning/);
	} finally {
		await host.finish();
	}
});
