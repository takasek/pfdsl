import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ALWAYS_TAG,
	checkPatternFile,
	collectTags,
	groupTagsByAxis,
	parsePatternFile,
	renderPatternFile,
	select,
	selectByTag,
	summaryOf,
} from "./retro-patterns.mjs";

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

describe("selectByTag", () => {
	const patterns = [
		{ name: "委譲A", tags: ["method:delegate", "context:parallel-work"] },
		{ name: "委譲B", tags: ["method:delegate"] },
		{ name: "常時", tags: [ALWAYS_TAG] },
		{ name: "無関係", tags: ["method:remove"] },
	];

	it("lists the tags that exist, most used first", () => {
		assert.deepEqual(collectTags(patterns), [
			{ tag: "method:delegate", count: 2 },
			{ tag: ALWAYS_TAG, count: 1 },
			{ tag: "context:parallel-work", count: 1 },
			{ tag: "method:remove", count: 1 },
		]);
	});

	it("unions the given tags rather than intersecting them", () => {
		assert.deepEqual(
			selectByTag(patterns, ["method:delegate", "method:remove"]).map(
				(p) => p.name,
			),
			["委譲A", "委譲B", "無関係"],
		);
	});

	it("yields nothing for a tag no pattern carries", () => {
		assert.deepEqual(selectByTag(patterns, ["nonexistent"]), []);
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

describe("groupTagsByAxis", () => {
	it("groups prefixed tags under their axis, most used first", () => {
		const patterns = [
			{ tags: ["target:check", "method:remove"] },
			{ tags: ["target:check", "context:parallel"] },
			{ tags: ["target:doc"] },
		];

		assert.deepEqual(groupTagsByAxis(collectTags(patterns)), [
			{
				axis: "target",
				tags: [
					{ tag: "target:check", count: 2 },
					{ tag: "target:doc", count: 1 },
				],
			},
			{ axis: "context", tags: [{ tag: "context:parallel", count: 1 }] },
			{ axis: "method", tags: [{ tag: "method:remove", count: 1 }] },
		]);
	});

	it("keeps unprefixed tags in an axis of their own, listed last", () => {
		const patterns = [{ tags: [ALWAYS_TAG] }, { tags: ["target:doc"] }];

		assert.deepEqual(
			groupTagsByAxis(collectTags(patterns)).map((g) => g.axis),
			["target", ""],
		);
	});
});

describe("select", () => {
	const patterns = [
		{
			name: "委譲の接合部",
			tags: ["method:delegate"],
			body: "- **委譲の接合部**: 冒頭。\n  具体例: CRLF の話。",
		},
		{
			name: "観測範囲",
			tags: ["context:dual-copy"],
			body: "- **観測範囲**: 冒頭。\n  具体例: 読み側の CRLF 混入を直した回。",
		},
		{ name: "常時", tags: [ALWAYS_TAG], body: "- **常時**: 毎回効く。" },
	];

	it("separates what only the words found from what the tags found", () => {
		const result = select(patterns, {
			tags: ["method:delegate"],
			words: ["CRLF"],
		});

		assert.deepEqual(
			result.tagged.map((p) => p.name),
			["委譲の接合部"],
		);
		assert.deepEqual(
			result.wordOnly.map((m) => m.pattern.name),
			["観測範囲"],
		);
		assert.deepEqual(
			result.always.map((p) => p.name),
			["常時"],
		);
	});

	it("anchors each word hit to the line it matched, for judging precision", () => {
		const { wordOnly } = select(patterns, { tags: [], words: ["混入"] });

		assert.deepEqual(wordOnly[0].hits, [
			{ word: "混入", line: 2, text: "具体例: 読み側の CRLF 混入を直した回。" },
		]);
	});

	it("yields the always-tagged patterns even when nothing else matches", () => {
		const result = select(patterns, { tags: [], words: [] });

		assert.deepEqual(result.tagged, []);
		assert.deepEqual(result.wordOnly, []);
		assert.deepEqual(
			result.always.map((p) => p.name),
			["常時"],
		);
	});
});

describe("checkPatternFile", () => {
	const valid = renderPatternFile({
		tags: ["method:delegate"],
		body: "- **委譲の接合部**: 冒頭の一文。",
	});

	it("reports nothing for a well-formed file", () => {
		assert.deepEqual(
			checkPatternFile({ name: "委譲の接合部", text: valid }),
			[],
		);
	});

	it("reports the parse error when the file has no frontmatter fence", () => {
		const [reason] = checkPatternFile({
			name: "委譲の接合部",
			text: "no fence here",
		});
		assert.match(reason, /missing frontmatter fence/);
	});

	it("reports a filename that does not match the bullet's name", () => {
		assert.deepEqual(checkPatternFile({ name: "別の名前", text: valid }), [
			'filename does not match the bullet name "委譲の接合部"',
		]);
	});

	it("reports a file with no tags", () => {
		const untagged = renderPatternFile({
			tags: [],
			body: "- **委譲の接合部**: 冒頭の一文。",
		});
		assert.deepEqual(
			checkPatternFile({ name: "委譲の接合部", text: untagged }),
			["has no tags"],
		);
	});

	it("reports formatting that does not round-trip through renderPatternFile", () => {
		const driftedTags = valid.replace(
			"tags: [method:delegate]",
			"tags: [ method:delegate ]",
		);
		const [reason] = checkPatternFile({
			name: "委譲の接合部",
			text: driftedTags,
		});
		assert.match(reason, /does not round-trip/);
	});
});
