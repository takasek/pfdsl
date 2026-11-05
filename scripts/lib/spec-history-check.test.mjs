import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	currentSpecVersion,
	runSpecHistoryCheck,
	topHistoryVersion,
} from "./spec-history-check.mjs";

describe("currentSpecVersion", () => {
	it("extracts the version from the title line", () => {
		assert.equal(
			currentSpecVersion("# PFDSL仕様書 v0.0.17\n\nbody\n"),
			"v0.0.17",
		);
	});

	it("returns null when there is no title-line version", () => {
		assert.equal(currentSpecVersion("no title here\n"), null);
	});
});

describe("topHistoryVersion", () => {
	it("reads the target version off the first changelog heading", () => {
		const history =
			"# PFDSL仕様書 変更履歴\n\nintro\n\nv0.0.16 からの主な変更点（v0.0.17）：...\n\nv0.0.15 からの主な変更点（v0.0.16）：...\n";
		assert.equal(topHistoryVersion(history), "v0.0.17");
	});

	it("ignores a placeholder version in prose before the first real heading", () => {
		const history =
			"現行バージョンはタイトル行（`# PFDSL仕様書 vX.Y.Z`）が唯一の権威。\n\nv0.0.16 からの主な変更点（v0.0.17）：...\n";
		assert.equal(topHistoryVersion(history), "v0.0.17");
	});

	it("returns null when no heading matches the canonical format", () => {
		assert.equal(topHistoryVersion("no changelog headings here\n"), null);
	});

	it("does not match a legacy-format heading (no parens around the target version)", () => {
		assert.equal(
			topHistoryVersion("v0.0.1 から v0.0.2 の主な変更点：...\n"),
			null,
		);
	});
});

describe("runSpecHistoryCheck", () => {
	it("passes when the top changelog entry documents the current version", () => {
		const result = runSpecHistoryCheck({
			readSpec: () => "# PFDSL仕様書 v0.0.17\n\nbody\n",
			readHistory: () => "v0.0.16 からの主な変更点（v0.0.17）：...\n",
		});
		assert.equal(result.ok, true);
	});

	it("fails when the current version has no top entry in spec-history.md", () => {
		const result = runSpecHistoryCheck({
			readSpec: () => "# PFDSL仕様書 v0.0.18\n\nbody\n",
			readHistory: () => "v0.0.16 からの主な変更点（v0.0.17）：...\n",
		});
		assert.equal(result.ok, false);
		assert.match(result.message, /v0\.0\.18/);
		assert.match(result.message, /v0\.0\.17/);
	});

	it("fails when the matching entry exists but isn't the top (newest) one — ordering matters", () => {
		const result = runSpecHistoryCheck({
			readSpec: () => "# PFDSL仕様書 v0.0.16\n\nbody\n",
			readHistory: () =>
				"v0.0.16 からの主な変更点（v0.0.17）：...\n\nv0.0.15 からの主な変更点（v0.0.16）：...\n",
		});
		assert.equal(result.ok, false);
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

	it("fails when spec-history.md has no entry matching the canonical heading format", () => {
		const result = runSpecHistoryCheck({
			readSpec: () => "# PFDSL仕様書 v0.0.17\n\nbody\n",
			readHistory: () => "some unstructured note, not a changelog heading\n",
		});
		assert.equal(result.ok, false);
	});
});
