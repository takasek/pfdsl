import assert from "node:assert/strict";
import test from "node:test";
import { waitForSourceCloseReady } from "./save-readiness.mjs";

test("saved disk contents do not release Close while the source tab is still dirty", async () => {
	let reads = 0;
	const sourceTab = {
		count: async () => 1,
		getAttribute: async () => (++reads < 3 ? "tab active dirty" : "tab active"),
	};
	await waitForSourceCloseReady(sourceTab, {
		timeoutMs: 100,
		retryIntervalMs: 1,
	});
	assert.equal(reads, 3);
});

test("a missing tab, unavailable class, or dirty tab cannot satisfy Close readiness", async () => {
	for (const [count, className] of [
		[0, null],
		[1, null],
		[1, "tab dirty"],
	]) {
		await assert.rejects(
			waitForSourceCloseReady(
				{
					count: async () => count,
					getAttribute: async () => className,
				},
				{ timeoutMs: 1, retryIntervalMs: 1 },
			),
			/last observed/,
		);
	}
});
