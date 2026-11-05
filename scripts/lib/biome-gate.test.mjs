import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateBiomeRun } from "./biome-gate.mjs";

/** A biome `--reporter=json` payload with the given summary counts. */
function report({ errors = 0, warnings = 0, infos = 0 }) {
	return JSON.stringify({
		summary: { errors, warnings, infos, diagnosticsNotPrinted: 0 },
		diagnostics: [],
	});
}

describe("evaluateBiomeRun", () => {
	it("passes when biome reports no diagnostics at all", () => {
		const verdict = evaluateBiomeRun({ ok: true, out: report({}), status: 0 });
		assert.deepEqual(verdict, {
			blocking: false,
			counts: { errors: 0, warnings: 0, infos: 0 },
		});
	});

	it("blocks on info-severity diagnostics, which biome itself exits 0 on", () => {
		const verdict = evaluateBiomeRun({
			ok: true,
			out: report({ infos: 1 }),
			status: 0,
		});
		assert.equal(verdict.blocking, true);
		assert.deepEqual(verdict.counts, { errors: 0, warnings: 0, infos: 1 });
	});

	it("blocks on warnings and errors too, counting every severity", () => {
		const verdict = evaluateBiomeRun({
			ok: false,
			out: report({ errors: 2, warnings: 3, infos: 4 }),
			status: 1,
		});
		assert.equal(verdict.blocking, true);
		assert.deepEqual(verdict.counts, { errors: 2, warnings: 3, infos: 4 });
	});

	it("blocks when biome fails without diagnostics, e.g. a config error", () => {
		const verdict = evaluateBiomeRun({
			ok: false,
			out: report({}),
			status: 2,
		});
		assert.equal(verdict.blocking, true);
		assert.match(verdict.reason, /exit status 2/);
	});

	it("blocks when the report cannot be parsed, rather than reading it as clean", () => {
		const verdict = evaluateBiomeRun({
			ok: true,
			out: "biome: command not found",
			status: 0,
		});
		assert.equal(verdict.blocking, true);
		assert.match(verdict.reason, /could not parse/);
	});

	it("blocks when the report parses but carries no summary", () => {
		const verdict = evaluateBiomeRun({
			ok: true,
			out: JSON.stringify({ diagnostics: [] }),
			status: 0,
		});
		assert.equal(verdict.blocking, true);
		assert.match(verdict.reason, /could not parse/);
	});
});
