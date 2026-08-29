import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isGhUnavailableError } from "./gh-compat.mjs";

describe("isGhUnavailableError", () => {
	it("true for ENOENT (gh binary missing)", () => {
		const error = Object.assign(new Error("spawnSync gh ENOENT"), {
			code: "ENOENT",
		});
		assert.equal(isGhUnavailableError(error), true);
	});

	it("false for a real gh error (e.g. auth failure)", () => {
		const error = Object.assign(new Error("gh: not logged in"), { code: 1 });
		assert.equal(isGhUnavailableError(error), false);
	});

	it("false for an error with no code", () => {
		assert.equal(isGhUnavailableError(new Error("boom")), false);
	});
});
