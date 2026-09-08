import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	extractPfdslBlocks,
	attachImageRefs,
	findDuplicateImageNames,
	findOrphanImages,
} from "./gen-article-images-core.mjs";

describe("extractPfdslBlocks", () => {
	it("extracts a single pfdsl block with its content and line range", () => {
		const text = ["intro", "```pfdsl", "a -> b", "```", "outro"].join("\n");
		const blocks = extractPfdslBlocks(text);
		assert.equal(blocks.length, 1);
		assert.equal(blocks[0].content, "a -> b");
		assert.equal(blocks[0].startLine, 2);
		assert.equal(blocks[0].endLine, 4);
	});

	it("extracts multiple pfdsl blocks in order", () => {
		const text = [
			"```pfdsl",
			"a -> b",
			"```",
			"between",
			"```pfdsl",
			"c -> d",
			"```",
		].join("\n");
		const blocks = extractPfdslBlocks(text);
		assert.equal(blocks.length, 2);
		assert.equal(blocks[0].content, "a -> b");
		assert.equal(blocks[1].content, "c -> d");
	});

	it("ignores non-pfdsl fenced blocks", () => {
		const text = ["```", "plain output", "```", "```pfdsl", "a -> b", "```"].join("\n");
		const blocks = extractPfdslBlocks(text);
		assert.equal(blocks.length, 1);
		assert.equal(blocks[0].content, "a -> b");
	});

	it("returns an empty array when there are no pfdsl blocks", () => {
		assert.deepEqual(extractPfdslBlocks("no blocks here"), []);
	});
});

describe("attachImageRefs", () => {
	it("attaches the image name that appears right after the block", () => {
		const text = [
			"```pfdsl",
			"a -> b",
			"```",
			"![alt text](images/foo.svg)",
		].join("\n");
		const blocks = attachImageRefs(text, extractPfdslBlocks(text));
		assert.equal(blocks[0].imageName, "foo.svg");
	});

	it("leaves imageName null when no image reference follows before the next block", () => {
		const text = [
			"```pfdsl",
			"a -> b",
			"```",
			"```",
			"warning output, not an image",
			"```",
			"```pfdsl",
			"c -> d",
			"```",
			"![alt](images/bar.svg)",
		].join("\n");
		const blocks = attachImageRefs(text, extractPfdslBlocks(text));
		assert.equal(blocks[0].imageName, null);
		assert.equal(blocks[1].imageName, "bar.svg");
	});

	it("picks the first image reference when multiple appear before the next block", () => {
		const text = [
			"```pfdsl",
			"a -> b",
			"```",
			"![alt](images/first.svg)",
			"![alt](images/second.svg)",
		].join("\n");
		const blocks = attachImageRefs(text, extractPfdslBlocks(text));
		assert.equal(blocks[0].imageName, "first.svg");
	});

	it("does not leak an image reference across the next block boundary", () => {
		const text = [
			"```pfdsl",
			"a -> b",
			"```",
			"```pfdsl",
			"c -> d",
			"```",
			"![alt](images/only-for-second.svg)",
		].join("\n");
		const blocks = attachImageRefs(text, extractPfdslBlocks(text));
		assert.equal(blocks[0].imageName, null);
		assert.equal(blocks[1].imageName, "only-for-second.svg");
	});
});

describe("findDuplicateImageNames", () => {
	it("returns empty when all image names are unique", () => {
		const blocks = [{ imageName: "a.svg" }, { imageName: "b.svg" }, { imageName: null }];
		assert.deepEqual(findDuplicateImageNames(blocks), []);
	});

	it("flags an image name referenced twice in the same article", () => {
		const blocks = [{ imageName: "a.svg" }, { imageName: "a.svg" }];
		assert.deepEqual(findDuplicateImageNames(blocks), ["a.svg"]);
	});

	it("ignores null image names when checking duplicates", () => {
		const blocks = [{ imageName: null }, { imageName: null }];
		assert.deepEqual(findDuplicateImageNames(blocks), []);
	});
});

describe("findOrphanImages", () => {
	it("returns images on disk that are not referenced by any block", () => {
		const onDisk = ["a.svg", "b.svg", "c.svg"];
		const referenced = ["a.svg", "c.svg"];
		assert.deepEqual(findOrphanImages(onDisk, referenced), ["b.svg"]);
	});

	it("returns empty when every image is referenced", () => {
		assert.deepEqual(findOrphanImages(["a.svg"], ["a.svg"]), []);
	});
});
