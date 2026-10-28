import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	MUTATIONS,
	newlyTagged,
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
