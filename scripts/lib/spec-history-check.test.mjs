import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { currentSpecVersion, runSpecHistoryCheck } from "./spec-history-check.mjs";

describe("currentSpecVersion", () => {
	it("extracts the version from the title line", () => {
		assert.equal(currentSpecVersion("# PFDSL仕様書 v0.0.17\n\nbody\n"), "v0.0.17");
	});

	it("returns null when there is no title-line version", () => {
		assert.equal(currentSpecVersion("no title here\n"), null);
	});
});

describe("runSpecHistoryCheck", () => {
	it("passes when spec-history.md documents the current version", () => {
		const result = runSpecHistoryCheck({
			readSpec: () => "# PFDSL仕様書 v0.0.17\n\nbody\n",
			readHistory: () => "v0.0.16 からの主な変更点（v0.0.17）：...\n",
		});
		assert.equal(result.ok, true);
	});

	it("fails when the current version has no entry in spec-history.md", () => {
		const result = runSpecHistoryCheck({
			readSpec: () => "# PFDSL仕様書 v0.0.18\n\nbody\n",
			readHistory: () => "v0.0.16 からの主な変更点（v0.0.17）：...\n",
		});
		assert.equal(result.ok, false);
		assert.match(result.message, /v0\.0\.18/);
	});

	it("does not treat a shorter version as documented merely because it's a prefix of a longer one", () => {
		const result = runSpecHistoryCheck({
			readSpec: () => "# PFDSL仕様書 v0.0.1\n\nbody\n",
			readHistory: () => "v0.0.16 からの主な変更点（v0.0.17）：...\n",
		});
		assert.equal(result.ok, false);
	});

	it("fails when spec.md has no title-line version to check", () => {
		const result = runSpecHistoryCheck({
			readSpec: () => "no title here\n",
			readHistory: () => "irrelevant\n",
		});
		assert.equal(result.ok, false);
	});
});
