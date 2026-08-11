import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALWAYS_TAG } from "./retro-patterns.mjs";
import {
	parseQuery,
	parseWords,
	renderCheck,
	renderCommand,
	renderNear,
	renderPattern,
	renderSelection,
	renderTags,
} from "./retro-patterns-render.mjs";

describe("renderPattern", () => {
	const pattern = {
		name: "委譲の接合部",
		tags: ["method:delegate"],
		path: "p/委譲の接合部.md",
		body: "- **委譲の接合部**: 冒頭の一文。\n  問いの形: 例。",
	};

	it("renders head, path, summary and key lines, without a note", () => {
		assert.equal(
			renderPattern(pattern),
			[
				"委譲の接合部  [method:delegate]",
				"  p/委譲の接合部.md",
				"  冒頭の一文。",
				"  問いの形: 例。",
			].join("\n"),
		);
	});

	it("inserts the note between the head and the path when given", () => {
		assert.equal(
			renderPattern(pattern, "matched 1/1: method:delegate"),
			[
				"委譲の接合部  [method:delegate]",
				"  matched 1/1: method:delegate",
				"  p/委譲の接合部.md",
				"  冒頭の一文。",
				"  問いの形: 例。",
			].join("\n"),
		);
	});
});

describe("renderTags", () => {
	it("groups by axis and appends the pattern count with guidance", () => {
		const patterns = [
			{
				name: "A",
				tags: ["target:doc"],
				path: "a.md",
				body: "- **A**: 冒頭。",
			},
			{ name: "B", tags: [ALWAYS_TAG], path: "b.md", body: "- **B**: 冒頭。" },
		];
		assert.equal(
			renderTags(patterns),
			[
				"[target]",
				"  target:doc  1",
				"    A  a.md",
				"[no axis]",
				`  ${ALWAYS_TAG}  1`,
				"    B  b.md",
				"",
				"2 pattern(s). Pick the tags whose condition held this cycle; --tag unions them.",
			].join("\n"),
		);
	});
});

describe("renderSelection", () => {
	const patterns = [
		{
			name: "委譲の接合部",
			tags: ["method:delegate"],
			path: "p1.md",
			body: "- **委譲の接合部**: 冒頭。\n  具体例: CRLF の話。",
		},
		{
			name: "観測範囲",
			tags: ["context:dual-copy"],
			path: "p2.md",
			body: "- **観測範囲**: 冒頭。\n  具体例: 読み側の CRLF 混入を直した回。",
		},
		{
			name: "常時",
			tags: [ALWAYS_TAG],
			path: "p3.md",
			body: "- **常時**: 毎回効く。",
		},
	];

	it("separates tagged, word-only and always into their own headed sections", () => {
		const text = renderSelection(patterns, {
			tags: ["method:delegate"],
			words: ["CRLF"],
		});
		assert.match(text, /^## tagged \(1 of 2\)/);
		assert.match(text, /委譲の接合部 {2}\[method:delegate\]/);
		assert.match(text, /matched 1\/1: method:delegate/);
		assert.match(text, /## word-only \(1 of 1\) — what the tags missed/);
		assert.match(text, /観測範囲 {2}\[context:dual-copy\]/);
		assert.match(text, /## always \(1\)/);
		assert.match(text, /常時 {2}\[always\]/);
		assert.match(
			text,
			/Shown 3 of 3 — shown, not read\. Open the paths above\./,
		);
	});

	it("flags an unselective result and names it in the tagged section", () => {
		const wide = [
			{ name: "1", tags: ["a"], path: "1.md", body: "- **1**: 冒頭。" },
			{ name: "2", tags: ["a"], path: "2.md", body: "- **2**: 冒頭。" },
		];
		const text = renderSelection(wide, { tags: ["a"], words: [] });
		assert.match(
			text,
			/is not a narrowing — the tags held too widely this cycle\./,
		);
	});
});

describe("renderNear", () => {
	it("ranks by hit count and shows hit lines under each pattern", () => {
		const patterns = [
			{
				name: "多い",
				tags: [],
				path: "m.md",
				body: "- **多い**: 冒頭。\n  行1 語。\n  行2 語。",
			},
			{
				name: "無関係",
				tags: [],
				path: "n.md",
				body: "- **無関係**: 何もない。",
			},
		];
		const text = renderNear(patterns, ["語"]);
		assert.match(
			text,
			/^## near \(1\) — ranked by how many lines the words hit/,
		);
		assert.match(text, /多い {2}\[\]/);
		assert.match(text, /L2 語: 行1 語。/);
		assert.doesNotMatch(text, /無関係/);
	});
});

describe("renderCheck", () => {
	it("reports the file count clean when every file passes", () => {
		const files = [
			{
				path: "x.md",
				name: "x",
				text: "---\ntags: [a]\n---\n\n- **X**: 冒頭。\n",
			},
		];
		assert.deepEqual(renderCheck(files), {
			text: "1 pattern file(s), no violations.",
			clean: true,
		});
	});

	it("reports one line per violation and is not clean", () => {
		const files = [{ path: "bad.md", name: "bad", text: "no fence here" }];
		const { text, clean } = renderCheck(files);
		assert.equal(clean, false);
		assert.match(text, /^bad\.md: /);
	});
});

describe("parseQuery / parseWords", () => {
	it("collects repeated --tag and --word", () => {
		assert.deepEqual(parseQuery(["--tag", "a", "--word", "b", "--tag", "c"]), {
			tags: ["a", "c"],
			words: ["b"],
		});
	});

	it("defaults to empty arrays when neither option is given", () => {
		assert.deepEqual(parseQuery([]), { tags: [], words: [] });
	});

	it("parseWords returns the words when no --tag is given", () => {
		assert.deepEqual(parseWords(["--word", "a"]), ["a"]);
	});

	it("parseWords rejects a --tag as a caller error", () => {
		assert.throws(() => parseWords(["--tag", "a"]), /near takes no --tag/);
	});
});

describe("renderCommand", () => {
	const patterns = [
		{
			name: "多い",
			tags: [],
			path: "m.md",
			body: "- **多い**: 冒頭。\n  行 語。",
		},
	];
	const files = [
		{
			path: "x.md",
			name: "x",
			text: "---\ntags: [a]\n---\n\n- **X**: 冒頭。\n",
		},
	];
	it("dispatches tags to the tags heading", () => {
		const tagged = [{ ...patterns[0], tags: ["target:doc"] }];
		const { text, ok } = renderCommand("tags", [], { patterns: tagged });
		assert.equal(ok, true);
		assert.match(text, /^\[target\]/);
	});

	it("dispatches list to one rendered pattern per entry", () => {
		const { text, ok } = renderCommand("list", [], { patterns });
		assert.equal(ok, true);
		assert.match(text, /多い {2}\[\]/);
	});

	it("dispatches select to the tagged/word-only/always sections, not near's heading", () => {
		const { text, ok } = renderCommand("select", ["--word", "語"], {
			patterns,
		});
		assert.equal(ok, true);
		assert.match(text, /^## tagged/);
		assert.doesNotMatch(text, /^## near/);
	});

	it("dispatches near to its own heading, not select's sections", () => {
		const { text, ok } = renderCommand("near", ["--word", "語"], { patterns });
		assert.equal(ok, true);
		assert.match(text, /^## near/);
		assert.doesNotMatch(text, /## tagged/);
	});

	it("near without --word throws rather than returning ok:false", () => {
		assert.throws(
			() => renderCommand("near", [], { patterns }),
			/near requires at least one --word/,
		);
	});

	it("dispatches check to the file report and is ok when every file is clean", () => {
		const { text, ok } = renderCommand("check", [], { files });
		assert.equal(ok, true);
		assert.equal(text, "1 pattern file(s), no violations.");
	});

	it("check is not ok when a file has a violation", () => {
		const badFiles = [{ path: "bad.md", name: "bad", text: "no fence here" }];
		const { ok } = renderCommand("check", [], { files: badFiles });
		assert.equal(ok, false);
	});

	it("returns the usage text with ok:false for an unrecognized command", () => {
		const { text, ok } = renderCommand("bogus", [], { patterns });
		assert.equal(ok, false);
		assert.match(text, /usage/);
	});

	it("returns the usage text with ok:false when no command is given", () => {
		const { ok } = renderCommand(undefined, [], { patterns });
		assert.equal(ok, false);
	});
});
