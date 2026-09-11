import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readyComparable, readyUnchanged } from "./ready-compare.mjs";

describe("readyComparable", () => {
	it("drops empty.complete, which a sweep is expected to reduce", () => {
		const payload = {
			ok: true,
			ready: [],
			empty: { inProgress: [], parked: [], complete: 1, blocked: 0 },
		};
		const comparable = readyComparable(payload);
		assert.equal("complete" in comparable.empty, false);
	});

	it("keeps every other empty field, including blocked (a count too, but not one the sweep is meant to change)", () => {
		const payload = {
			ok: true,
			ready: [],
			empty: { inProgress: ["a"], parked: ["b"], complete: 3, blocked: 2 },
		};
		const comparable = readyComparable(payload);
		assert.deepEqual(comparable.empty, {
			inProgress: ["a"],
			parked: ["b"],
			blocked: 2,
		});
	});

	it("leaves a payload with no empty field untouched", () => {
		const payload = {
			ok: true,
			ready: [{ id: "p", label: "P", inputs: ["a"], outputs: ["b"] }],
		};
		const comparable = readyComparable(payload);
		assert.deepEqual(comparable, payload);
	});
});

describe("readyUnchanged", () => {
	it("treats a before/after pair as unchanged when only empty.complete differs (#1125 defect 5)", () => {
		// Exactly the shape a sweep of an all-done roadmap produces: the
		// sole process disappears, so `complete` drops from 1 to 0, but
		// nothing about readiness itself changed (both stay empty).
		const before = JSON.stringify({
			ok: true,
			ready: [],
			empty: { inProgress: [], parked: [], complete: 1, blocked: 0 },
		});
		const after = JSON.stringify({
			ok: true,
			ready: [],
			empty: { inProgress: [], parked: [], complete: 0, blocked: 0 },
		});
		assert.equal(readyUnchanged(before, after), true);
	});

	it("still rejects a ready-id set that actually changed", () => {
		const before = JSON.stringify({
			ok: true,
			ready: [{ id: "p", label: "P", inputs: ["a"], outputs: ["b"] }],
		});
		const after = JSON.stringify({ ok: true, ready: [] });
		assert.equal(readyUnchanged(before, after), false);
	});

	it("rejects a ready item whose inputs shrank while its id set stayed the same (#1125 defect 5 regression guard)", () => {
		// The failure this whole comparison exists to catch: a mutation that
		// leaves the ready set's ids unchanged but corrupts what each item
		// says its inputs are. An id-set-only comparison would miss this.
		const before = JSON.stringify({
			ok: true,
			ready: [{ id: "p", label: "P", inputs: ["a", "b"], outputs: ["c"] }],
		});
		const after = JSON.stringify({
			ok: true,
			ready: [{ id: "p", label: "P", inputs: ["a"], outputs: ["c"] }],
		});
		assert.equal(readyUnchanged(before, after), false);
	});
});
