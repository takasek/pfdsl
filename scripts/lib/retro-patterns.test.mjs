import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { joinCatalog, splitCatalog } from "./retro-patterns.mjs";

describe("splitCatalog", () => {
	it("returns one entry per top-level bullet, carrying its continuation lines", () => {
		const src = [
			"- **一つ目**: 冒頭の一文。",
			"  続きの行。",
			"",
			"- **二つ目**: 別のパターン。",
		].join("\n");

		const patterns = splitCatalog(src);

		assert.deepEqual(
			patterns.map((p) => p.name),
			["一つ目", "二つ目"],
		);
		assert.equal(patterns[0].body, "- **一つ目**: 冒頭の一文。\n  続きの行。");
		assert.equal(patterns[1].body, "- **二つ目**: 別のパターン。");
	});
});

describe("joinCatalog", () => {
	it("round-trips a catalog through the split", () => {
		const src = [
			"- **一つ目**: 冒頭の一文。",
			"  続きの行。",
			"",
			"- **二つ目**: 別のパターン。",
			"  こちらも続く。",
			"",
			"- **三つ目**: 最後。",
		].join("\n");

		assert.equal(joinCatalog(splitCatalog(src)), src);
	});
});
