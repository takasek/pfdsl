import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	completeSelection,
	MUTATIONS,
	newlyTagged,
	selectedCases,
	selectNames,
} from "./helpers/mutation-gate.mjs";

test("every lifecycle mutation still matches exactly one production location", () => {
	for (const [name, mutation] of Object.entries(MUTATIONS)) {
		const sources = new Map();
		for (const [file, search, replacement] of mutation.steps) {
			const source =
				sources.get(file) ??
				readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
			assert.equal(source.split(search).length - 1, 1, `${name}: ${file}`);
			sources.set(
				file,
				source.replace(search, () => replacement),
			);
		}
	}
});

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

test("selected mutation cases share repeated witnesses and reject unknown mutations", () => {
	const cases = {
		A: [{ file: "first.test.mjs", name: "one" }],
		B: [
			{ file: "first.test.mjs", name: "one" },
			{ file: "second.test.mjs", name: "two" },
		],
	};
	assert.deepEqual(selectedCases(["A", "B", "A"], cases), cases.B);
	assert.deepEqual(selectedCases([], cases), cases.B);
	assert.throws(() => selectedCases(["missing"], cases), /Unknown mutation/);
});

test("missing, repeated, skipped or unrelated cases cannot satisfy the selected baseline", () => {
	const wanted = [{ name: "one" }, { name: "two" }];
	assert.equal(completeSelection(2, ["two", "one"], wanted), true);
	for (const [total, labels] of [
		[1, ["one"]],
		[2, ["one"]],
		[2, ["one", "one"]],
		[2, ["one", "unrelated"]],
		[3, ["one", "two", "extra"]],
	])
		assert.equal(completeSelection(total, labels, wanted), false);
});
