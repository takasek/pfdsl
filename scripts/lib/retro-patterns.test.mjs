import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ALWAYS_TAG,
	checkPatternFile,
	collectTags,
	groupTagsByAxis,
	keyLinesOf,
	near,
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

	it("lists the tags that exist, most used first, carrying their own patterns", () => {
		assert.deepEqual(
			collectTags(patterns).map(({ tag, patterns: ps }) => ({
				tag,
				names: ps.map((p) => p.name),
			})),
			[
				{ tag: "method:delegate", names: ["委譲A", "委譲B"] },
				{ tag: ALWAYS_TAG, names: ["常時"] },
				{ tag: "context:parallel-work", names: ["委譲A"] },
				{ tag: "method:remove", names: ["無関係"] },
			],
		);
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

describe("keyLinesOf", () => {
	it("pulls the 問いの形 and 具体例 lines, trimmed, in body order", () => {
		const body = [
			"- **名前**: 冒頭の一文。",
			"  問いの形: 「これは問いか」。",
			"  具体例: これは例。",
		].join("\n");
		assert.deepEqual(keyLinesOf(body), [
			"問いの形: 「これは問いか」。",
			"具体例: これは例。",
		]);
	});

	it("matches numbered and suffixed labels by prefix", () => {
		const body = [
			"- **名前**: 冒頭。",
			"  具体例1（識別子）: 一つ目。",
			"  具体例2（別件）: 二つ目。",
			"  問いの形の追加: 追加分。",
		].join("\n");
		assert.deepEqual(keyLinesOf(body), [
			"具体例1（識別子）: 一つ目。",
			"具体例2（別件）: 二つ目。",
			"問いの形の追加: 追加分。",
		]);
	});

	it("returns nothing for a pattern with neither label", () => {
		assert.deepEqual(keyLinesOf("- **名前**: 冒頭の一文だけ。"), []);
	});

	it("does not pull continuation lines that lack the label", () => {
		const body = [
			"- **名前**: 冒頭。",
			"  具体例: 一行目。",
			"  ラベルの無い続きの行。",
		].join("\n");
		assert.deepEqual(keyLinesOf(body), ["具体例: 一行目。"]);
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
					{ tag: "target:check", patterns: [patterns[0], patterns[1]] },
					{ tag: "target:doc", patterns: [patterns[2]] },
				],
			},
			{
				axis: "context",
				tags: [{ tag: "context:parallel", patterns: [patterns[1]] }],
			},
			{
				axis: "method",
				tags: [{ tag: "method:remove", patterns: [patterns[0]] }],
			},
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
			result.tagged.map((t) => t.pattern.name),
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

	it("reports each word's reach over every pattern, before subtracting the tagged", () => {
		const { reach } = select(patterns, {
			tags: ["method:delegate"],
			words: ["CRLF", "存在しない語"],
		});

		assert.deepEqual(reach, [
			{ word: "CRLF", count: 2 },
			{ word: "存在しない語", count: 0 },
		]);
	});

	it("ranks the tagged by how many of the cycle's tags each one carries", () => {
		const cycle = [
			{ name: "一致1", tags: ["a"], body: "- **一致1**: 冒頭。" },
			{ name: "一致3", tags: ["a", "b", "c"], body: "- **一致3**: 冒頭。" },
			{ name: "一致2", tags: ["a", "b"], body: "- **一致2**: 冒頭。" },
		];

		const { tagged } = select(cycle, { tags: ["a", "b", "c"], words: [] });

		assert.deepEqual(
			tagged.map((t) => t.pattern.name),
			["一致3", "一致2", "一致1"],
		);
	});

	it("names which of the cycle's tags each pattern matched", () => {
		const cycle = [
			{ name: "二軸", tags: ["a", "b", "z"], body: "- **二軸**: 冒頭。" },
		];

		const { tagged } = select(cycle, { tags: ["b", "a"], words: [] });

		assert.deepEqual(tagged[0].matched, ["a", "b"]);
	});

	it("keeps catalog order among patterns matching the same number of tags", () => {
		const cycle = [
			{ name: "先", tags: ["a"], body: "- **先**: 冒頭。" },
			{ name: "後", tags: ["b"], body: "- **後**: 冒頭。" },
		];

		const { tagged } = select(cycle, { tags: ["b", "a"], words: [] });

		assert.deepEqual(
			tagged.map((t) => t.pattern.name),
			["先", "後"],
		);
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

describe("near", () => {
	const patterns = [
		{
			name: "多い",
			tags: [],
			body: "- **多い**: 冒頭。\n  行1 語。\n  行2 語。",
		},
		{ name: "少ない", tags: [], body: "- **少ない**: 冒頭。\n  行1 語のみ。" },
		{ name: "常時", tags: [ALWAYS_TAG], body: "- **常時**: 冒頭 語。" },
		{ name: "無関係", tags: [], body: "- **無関係**: 何もない。" },
	];

	it("ranks every pattern by hit count, always-tagged patterns included", () => {
		assert.deepEqual(
			near(patterns, ["語"]).map((r) => r.pattern.name),
			["多い", "少ない", "常時"],
		);
	});

	it("drops patterns the words never hit", () => {
		assert.equal(
			near(patterns, ["語"]).some((r) => r.pattern.name === "無関係"),
			false,
		);
	});

	it("carries hits in the same {word, line, text} shape as select's word-only hits", () => {
		const [{ hits }] = near(patterns, ["語"]);
		assert.deepEqual(hits, [
			{ word: "語", line: 2, text: "行1 語。" },
			{ word: "語", line: 3, text: "行2 語。" },
		]);
	});
});

describe("checkPatternFile", () => {
	const valid = renderPatternFile({
		tags: ["method:delegate"],
		body: "- **並行委譲の接合部**: 冒頭の一文。",
	});

	it("reports nothing for a well-formed file with an ascii kebab-case filename", () => {
		assert.deepEqual(
			checkPatternFile({ name: "parallel-delegation-seam", text: valid }),
			[],
		);
	});

	it("reports the parse error when the file has no frontmatter fence", () => {
		const [reason] = checkPatternFile({
			name: "parallel-delegation-seam",
			text: "no fence here",
		});
		assert.match(reason, /missing frontmatter fence/);
	});

	it("reports a filename that is not ascii kebab-case", () => {
		assert.deepEqual(
			checkPatternFile({ name: "並行委譲の接合部", text: valid }),
			["filename is not ascii kebab-case"],
		);
	});

	it("reports a filename with an uppercase letter", () => {
		assert.deepEqual(
			checkPatternFile({ name: "Parallel-Delegation-Seam", text: valid }),
			["filename is not ascii kebab-case"],
		);
	});

	it("reports a filename with a trailing hyphen", () => {
		assert.deepEqual(
			checkPatternFile({ name: "parallel-delegation-seam-", text: valid }),
			["filename is not ascii kebab-case"],
		);
	});

	it("reports a filename with consecutive hyphens", () => {
		assert.deepEqual(
			checkPatternFile({ name: "parallel--delegation-seam", text: valid }),
			["filename is not ascii kebab-case"],
		);
	});

	it("reports a file with no tags", () => {
		const untagged = renderPatternFile({
			tags: [],
			body: "- **並行委譲の接合部**: 冒頭の一文。",
		});
		assert.deepEqual(
			checkPatternFile({ name: "parallel-delegation-seam", text: untagged }),
			["has no tags"],
		);
	});

	it("reports formatting that does not round-trip through renderPatternFile", () => {
		const driftedTags = valid.replace(
			"tags: [method:delegate]",
			"tags: [ method:delegate ]",
		);
		const [reason] = checkPatternFile({
			name: "parallel-delegation-seam",
			text: driftedTags,
		});
		assert.match(reason, /does not round-trip/);
	});
});
