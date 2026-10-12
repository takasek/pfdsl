import assert from "node:assert/strict";
import test from "node:test";
import { newlyTagged, selectNames } from "./helpers/mutation-gate.mjs";

test("explicit mutation selection always includes exactly one baseline first", () => {
	assert.deepEqual(selectNames(["M14"]), ["baseline", "M14"]);
	assert.deepEqual(selectNames(["M14", "baseline", "M14"]), [
		"baseline",
		"M14",
	]);
	assert.deepEqual(selectNames([], ["M1", "M2"]), ["baseline", "M1", "M2"]);
});

test("a pre-existing failure never counts as a mutation kill", () => {
	const baseline = [
		{ label: "old cell", tags: ["U"] },
		{ label: "old untagged", tags: [] },
	];
	const cells = [
		...baseline,
		{ label: "old untagged", tags: ["P"] },
		{ label: "new cell", tags: ["V"] },
		{ label: "status only", tags: [] },
	];
	assert.deepEqual(newlyTagged(cells, baseline), [
		{ label: "new cell", tags: ["V"] },
	]);
});
