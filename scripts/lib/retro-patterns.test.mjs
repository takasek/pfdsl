import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ALWAYS_TAG,
	collectTags,
	joinCatalog,
	parsePatternFile,
	renderPatternFile,
	selectByTag,
	splitCatalog,
	summaryOf,
} from "./retro-patterns.mjs";

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

describe("pattern files", () => {
	const pattern = {
		tags: ["delegation", "parallel-work"],
		body: "- **並行委譲の接合部**: 冒頭の一文。\n  続きの行。",
	};

	it("renders frontmatter above the pattern's own bullet", () => {
		assert.equal(
			renderPatternFile(pattern),
			[
				"---",
				"tags: [delegation, parallel-work]",
				"---",
				"",
				"- **並行委譲の接合部**: 冒頭の一文。",
				"  続きの行。",
				"",
			].join("\n"),
		);
	});

	it("reads back what it wrote, naming the pattern from its bullet", () => {
		assert.deepEqual(parsePatternFile(renderPatternFile(pattern)), {
			name: "並行委譲の接合部",
			...pattern,
		});
	});

	it("reports an empty tag list rather than omitting the field", () => {
		const untagged = { ...pattern, tags: [] };
		assert.deepEqual(parsePatternFile(renderPatternFile(untagged)).tags, []);
	});
});

describe("searching", () => {
	const patterns = [
		{ name: "委譲A", tags: ["delegation", "parallel-work"] },
		{ name: "委譲B", tags: ["delegation"] },
		{ name: "常時", tags: [ALWAYS_TAG] },
		{ name: "無関係", tags: ["deletion"] },
	];

	it("lists the tags that exist, most used first", () => {
		assert.deepEqual(collectTags(patterns), [
			{ tag: "delegation", count: 2 },
			{ tag: ALWAYS_TAG, count: 1 },
			{ tag: "deletion", count: 1 },
			{ tag: "parallel-work", count: 1 },
		]);
	});

	it("includes the always-tagged patterns in every selection", () => {
		assert.deepEqual(
			selectByTag(patterns, "delegation").map((p) => p.name),
			["委譲A", "委譲B", "常時"],
		);
	});

	it("does not list an always-tagged pattern twice when it also matches", () => {
		const both = [{ name: "両方", tags: ["delegation", ALWAYS_TAG] }];
		assert.deepEqual(
			selectByTag(both, "delegation").map((p) => p.name),
			["両方"],
		);
	});

	it("still yields the always-tagged patterns when nothing matches", () => {
		assert.deepEqual(
			selectByTag(patterns, "nonexistent").map((p) => p.name),
			["常時"],
		);
	});
});

describe("summaryOf", () => {
	it("takes the sentence the bullet opens with, without the name", () => {
		assert.equal(
			summaryOf("- **並行委譲の接合部**: 冒頭の一文。\n  二文目は要らない。"),
			"冒頭の一文。",
		);
	});

	it("keeps a first sentence that runs past the end of its line", () => {
		assert.equal(
			summaryOf("- **名前**: 折り返す\n  一文。\n  次の文。"),
			"折り返す 一文。",
		);
	});

	it("falls back to the whole bullet when it has no sentence end", () => {
		assert.equal(summaryOf("- **名前**: 句点のない一行"), "句点のない一行");
	});
});
