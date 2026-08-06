import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	joinCatalog,
	parsePatternFile,
	renderPatternFile,
	splitCatalog,
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
		summary:
			"並行委譲した成果物同士の接合部は各委譲の受け入れ基準では検証されない。",
		tags: ["delegation", "parallel-work"],
		body: "- **並行委譲の接合部**: 冒頭の一文。\n  続きの行。",
	};

	it("renders frontmatter above the pattern's own bullet", () => {
		assert.equal(
			renderPatternFile(pattern),
			[
				"---",
				`summary: ${pattern.summary}`,
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
