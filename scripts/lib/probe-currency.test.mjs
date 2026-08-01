import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkProbeCurrency, latestProbedVersion } from "./probe-currency.mjs";

const entry = (v) => `## 環境\n\n- 対象バージョン: plugin \`pfdsl@pfdsl\` v${v}（実導入）\n`;

describe("latestProbedVersion", () => {
	it("reads the recorded version", () => {
		assert.equal(latestProbedVersion(entry("0.0.19")), "0.0.19");
	});

	it("takes the newest, not the first written", () => {
		assert.equal(latestProbedVersion(entry("0.0.19") + entry("0.0.7")), "0.0.19");
	});

	it("compares numerically, not lexically", () => {
		assert.equal(latestProbedVersion(entry("0.0.9") + entry("0.0.10")), "0.0.10");
	});

	it("returns undefined for a log with no run recorded", () => {
		assert.equal(latestProbedVersion("# 実行記録\n\n(未実施)\n"), undefined);
	});

	it("throws when a label carries no version on its own line", () => {
		// Reading onto the next line instead would let this entry borrow a newer
		// version and report the gate as satisfied — the one wrong direction.
		assert.throws(
			() => latestProbedVersion("- 対象バージョン:\n  plugin v0.0.30\n"),
			/records no vX\.Y\.Z/,
		);
	});
});

describe("checkProbeCurrency", () => {
	it("passes when the probe covers the version adopters hold", () => {
		assert.deepEqual(checkProbeCurrency(entry("0.0.24"), "0.0.24"), { ok: true, probed: "0.0.24" });
	});

	it("passes when the probe is ahead of the published bundle", () => {
		assert.equal(checkProbeCurrency(entry("0.0.25"), "0.0.24").ok, true);
	});

	it("fails when adopters hold a bundle no probe has walked", () => {
		const r = checkProbeCurrency(entry("0.0.19"), "0.0.24");
		assert.equal(r.ok, false);
		assert.match(r.reason, /0\.0\.19.*0\.0\.24/);
	});

	it("fails when the log records no run at all", () => {
		const r = checkProbeCurrency("# 実行記録\n", "0.0.24");
		assert.equal(r.ok, false);
		assert.match(r.reason, /no run/);
	});

	it("accepts a v-prefixed published version", () => {
		assert.equal(checkProbeCurrency(entry("0.0.24"), "v0.0.24").ok, true);
	});

	it("throws on an unparseable published version rather than passing silently", () => {
		assert.throws(() => checkProbeCurrency(entry("0.0.24"), "latest"), /unparseable/);
	});
});
