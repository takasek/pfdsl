import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	BYTE_THRESHOLD,
	countCatalogItems,
	evaluateCatalogScale,
	exceedsSplitThreshold,
	ITEM_THRESHOLD,
	measureCatalogScale,
	THRESHOLD_SUMMARY,
} from "./review-perspectives-scale.mjs";

describe("countCatalogItems", () => {
	it("counts top-level bold-lead bullet items", () => {
		const content =
			"- **エッジ実在性**: a\n- **駆動源**: b\n- **入力充足**: c\n";
		assert.equal(countCatalogItems(content), 3);
	});

	it("does not count indented continuation lines under a bullet", () => {
		const content =
			"- **エッジ実在性**: a\n  具体例: continued detail, still one item\n- **駆動源**: b\n";
		assert.equal(countCatalogItems(content), 2);
	});

	it("does not count plain bullets without a bold lead", () => {
		const content = "- plain bullet\n- **real item**: x\n";
		assert.equal(countCatalogItems(content), 1);
	});

	it("returns 0 for content with no bullet items", () => {
		assert.equal(countCatalogItems("# heading\n\nprose only.\n"), 0);
	});
});

describe("measureCatalogScale", () => {
	it("reports byte length and item count for a file", () => {
		const content = "- **a**: x\n- **b**: y\n";
		const result = measureCatalogScale({ path: "docs/x.md", content });
		assert.equal(result.path, "docs/x.md");
		assert.equal(result.bytes, Buffer.byteLength(content, "utf8"));
		assert.equal(result.items, 2);
	});

	it("counts multi-byte characters by UTF-8 byte length, not code point count", () => {
		const content = "- **エッジ実在性**: 日本語の本文\n";
		const result = measureCatalogScale({ path: "docs/x.md", content });
		assert.equal(result.bytes, Buffer.byteLength(content, "utf8"));
		assert.ok(result.bytes > content.length);
	});
});

describe("exceedsSplitThreshold", () => {
	it("is false when both bytes and items are under threshold", () => {
		assert.equal(
			exceedsSplitThreshold({
				bytes: BYTE_THRESHOLD - 1,
				items: ITEM_THRESHOLD - 1,
			}),
			false,
		);
	});

	it("is true when bytes alone exceeds the threshold", () => {
		assert.equal(
			exceedsSplitThreshold({ bytes: BYTE_THRESHOLD + 1, items: 1 }),
			true,
		);
	});

	it("is true when items alone exceeds the threshold", () => {
		assert.equal(
			exceedsSplitThreshold({ bytes: 1, items: ITEM_THRESHOLD + 1 }),
			true,
		);
	});

	it("is false exactly at the threshold (strictly-greater comparison)", () => {
		assert.equal(
			exceedsSplitThreshold({ bytes: BYTE_THRESHOLD, items: ITEM_THRESHOLD }),
			false,
		);
	});
});

describe("THRESHOLD_SUMMARY", () => {
	it("is derived from the two thresholds it summarises", () => {
		assert.equal(
			THRESHOLD_SUMMARY,
			`${BYTE_THRESHOLD / 1024}KB or ${ITEM_THRESHOLD} items`,
		);
	});

	it("is the phrase the split notice carries, so the two cannot drift apart", () => {
		const result = evaluateCatalogScale([
			{
				path: "docs/review-perspectives.md",
				bytes: BYTE_THRESHOLD + 1,
				items: 1,
			},
		]);
		assert.ok(result.stdoutLines[0].includes(THRESHOLD_SUMMARY));
	});
});

describe("evaluateCatalogScale", () => {
	it("always exits 0, even when a file exceeds the threshold", () => {
		const result = evaluateCatalogScale([
			{
				path: "docs/review-perspectives.md",
				bytes: BYTE_THRESHOLD + 1,
				items: 1,
			},
		]);
		assert.equal(result.exitCode, 0);
	});

	it("prints current values for a file under threshold", () => {
		const result = evaluateCatalogScale([
			{ path: "docs/review-perspectives.md", bytes: 100, items: 5 },
		]);
		assert.equal(result.stdoutLines.length, 1);
		assert.match(result.stdoutLines[0], /docs\/review-perspectives\.md/);
		assert.match(result.stdoutLines[0], /100 bytes/);
		assert.match(result.stdoutLines[0], /5 items/);
	});

	it("flags a file that exceeds the threshold as a split-timing notice", () => {
		const result = evaluateCatalogScale([
			{
				path: "docs/review-perspectives.md",
				bytes: BYTE_THRESHOLD + 1,
				items: 1,
			},
		]);
		assert.match(result.stdoutLines[0], /split/i);
	});

	it("reports one line per file, independently of the others' thresholds", () => {
		const result = evaluateCatalogScale([
			{ path: "docs/review-perspectives.md", bytes: 100, items: 5 },
			{
				path: ".pfdsl/review-perspectives.md",
				bytes: BYTE_THRESHOLD + 1,
				items: ITEM_THRESHOLD + 1,
			},
		]);
		assert.equal(result.stdoutLines.length, 2);
		assert.doesNotMatch(result.stdoutLines[0], /split/i);
		assert.match(result.stdoutLines[1], /split/i);
	});
});
