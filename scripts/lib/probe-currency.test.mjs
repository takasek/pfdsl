import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkProbeCurrency, latestProbedVersion, parseVersion } from "./probe-currency.mjs";

const entry = (v) => `## 環境\n\n- 対象バージョン: plugin \`pfdsl@pfdsl\` v${v}（実導入）\n`;

describe("latestProbedVersion", () => {
	it("reads the recorded version", () => {
		assert.deepEqual(latestProbedVersion(entry("0.0.19")), [0, 0, 19]);
	});

	it("takes the newest, not the first written", () => {
		// Entries are appended in run order, but a log could be reordered by hand.
		assert.deepEqual(latestProbedVersion(entry("0.0.19") + entry("0.0.7")), [0, 0, 19]);
	});

	it("compares numerically, not lexically", () => {
		assert.deepEqual(latestProbedVersion(entry("0.0.9") + entry("0.0.10")), [0, 0, 10]);
	});

	it("returns undefined for a log with no run recorded", () => {
		assert.equal(latestProbedVersion("# 実行記録\n\n(未実施)\n"), undefined);
	});
});

describe("parseVersion", () => {
	it("accepts both bare and v-prefixed forms", () => {
		assert.deepEqual(parseVersion("0.0.24"), [0, 0, 24]);
		assert.deepEqual(parseVersion("v0.0.24"), [0, 0, 24]);
	});

	it("returns undefined for junk", () => {
		assert.equal(parseVersion("latest"), undefined);
	});
});

describe("checkProbeCurrency", () => {
	it("passes when the probe covers the version adopters hold", () => {
		assert.equal(checkProbeCurrency(entry("0.0.24"), "0.0.24").ok, true);
	});

	it("passes when the probe is ahead of the published bundle", () => {
		assert.equal(checkProbeCurrency(entry("0.0.25"), "0.0.24").ok, true);
	});

	it("fails when adopters hold a bundle no probe has walked", () => {
		const r = checkProbeCurrency(entry("0.0.19"), "0.0.24");
		assert.equal(r.ok, false);
		assert.equal(r.probed, "0.0.19");
		assert.match(r.reason, /0\.0\.19.*0\.0\.24/);
	});

	it("fails when the log records no run at all", () => {
		const r = checkProbeCurrency("# 実行記録\n", "0.0.24");
		assert.equal(r.ok, false);
		assert.match(r.reason, /no run/);
	});

	it("throws on an unparseable published version rather than passing silently", () => {
		// Returning ok here would turn a broken caller into a green gate.
		assert.throws(() => checkProbeCurrency(entry("0.0.24"), "unknown"), /unparseable/);
	});
});
