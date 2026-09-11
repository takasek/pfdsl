import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scratchPathFor } from "./scratch-path.mjs";

describe("scratchPathFor", () => {
	it("places the scratch path in the same directory as the swept file", () => {
		const scratch = scratchPathFor("/repo/sub/roadmap.pfdsl", "abc123");
		assert.equal(scratch.startsWith("/repo/sub/"), true);
	});

	it("keeps the original extension", () => {
		const scratch = scratchPathFor("/repo/sub/roadmap.pfdsl", "abc123");
		assert.equal(scratch.endsWith(".pfdsl"), true);
	});

	it("embeds the token so two calls with different tokens never collide", () => {
		const a = scratchPathFor("/repo/sub/roadmap.pfdsl", "aaa");
		const b = scratchPathFor("/repo/sub/roadmap.pfdsl", "bbb");
		assert.notEqual(a, b);
	});

	it("does not reuse the original file's own name", () => {
		const scratch = scratchPathFor("/repo/sub/roadmap.pfdsl", "abc123");
		assert.notEqual(scratch, "/repo/sub/roadmap.pfdsl");
	});

	it("falls back to a .pfdsl extension for an extensionless input", () => {
		const scratch = scratchPathFor("/repo/sub/roadmap", "abc123");
		assert.equal(scratch.endsWith(".pfdsl"), true);
	});
});
