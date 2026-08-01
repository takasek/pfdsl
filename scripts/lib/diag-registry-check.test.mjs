import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSpecDiagTable, diffDiagRegistry, evaluateDiagRegistryDiff } from "./diag-registry-check.mjs";

const TABLE_HEADER = "| コード | severity | 定義節 | 条件 |\n|---|---|---|---|\n";

describe("parseSpecDiagTable", () => {
	it("parses plain error/warning rows", () => {
		const text =
			TABLE_HEADER +
			"| V001 | error | §15.1 | 同一 Artifact を複数 Process が生成 |\n" +
			"| W001 | warning | §15.5 | parts メンバーが edge に参加していない |\n";
		assert.deepEqual(parseSpecDiagTable(text), {
			V001: ["error"],
			W001: ["warning"],
		});
	});

	it("normalizes the strict dual-severity label", () => {
		const text =
			TABLE_HEADER +
			"| W002 | warning (--strict: error) | §15.7 | produced Artifact に `criteria:` が未設定 |\n";
		assert.deepEqual(parseSpecDiagTable(text), {
			W002: ["warning", "error"],
		});
	});

	it("stops at the first non-table line after the header", () => {
		const text =
			TABLE_HEADER +
			"| V001 | error | §15.1 | condition |\n" +
			"\n" +
			"| V999 | error | §99 | should not be picked up |\n";
		assert.deepEqual(parseSpecDiagTable(text), { V001: ["error"] });
	});

	it("throws when the §16 table header is absent", () => {
		assert.throws(() => parseSpecDiagTable("no table here"), /table header not found/);
	});

	it("throws on an unrecognized severity label", () => {
		const text = TABLE_HEADER + "| V001 | oops | §15.1 | condition |\n";
		assert.throws(() => parseSpecDiagTable(text), /unrecognized severity/);
	});
});

describe("diffDiagRegistry", () => {
	it("reports no differences when spec and registry match", () => {
		const specCodes = { V001: ["error"], W002: ["warning", "error"] };
		const registry = {
			V001: { severities: ["error"] },
			W002: { severities: ["error", "warning"] },
		};
		assert.deepEqual(diffDiagRegistry(specCodes, registry), {
			missingInSpec: [],
			staleInSpec: [],
			severityMismatches: [],
		});
	});

	it("detects a code present in registry but missing from spec", () => {
		const specCodes = {};
		const registry = { V999: { severities: ["error"] } };
		const diff = diffDiagRegistry(specCodes, registry);
		assert.deepEqual(diff.missingInSpec, ["V999"]);
	});

	it("detects a stale code present in spec but absent from registry", () => {
		const specCodes = { V013: ["error"] };
		const registry = {};
		const diff = diffDiagRegistry(specCodes, registry);
		assert.deepEqual(diff.staleInSpec, ["V013"]);
	});

	it("detects a severity mismatch", () => {
		const specCodes = { W002: ["warning"] };
		const registry = { W002: { severities: ["warning", "error"] } };
		const diff = diffDiagRegistry(specCodes, registry);
		assert.deepEqual(diff.severityMismatches, ["W002"]);
	});
});

const noDiff = { missingInSpec: [], staleInSpec: [], severityMismatches: [] };

describe("evaluateDiagRegistryDiff", () => {
	it("exits 0 with an OK message carrying the spec code count when there is no drift", () => {
		const result = evaluateDiagRegistryDiff({ ...noDiff, specCodesCount: 42 });
		assert.equal(result.exitCode, 0);
		assert.deepEqual(result.stdoutLines, ["check-diag-registry: OK (42 codes match)"]);
		assert.deepEqual(result.stderrLines, []);
	});

	// Each of the 3 branches must independently set `failed` — guards against
	// e.g. someone turning these into `else if` and silently only checking one.
	it("fails on missingInSpec alone", () => {
		const result = evaluateDiagRegistryDiff({ ...noDiff, missingInSpec: ["V999"], specCodesCount: 1 });
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[0], /missing from spec\.md §16 table: V999/);
	});

	it("fails on staleInSpec alone", () => {
		const result = evaluateDiagRegistryDiff({ ...noDiff, staleInSpec: ["V013"], specCodesCount: 1 });
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[0], /not emitted by core \(stale\): V013/);
	});

	it("fails on severityMismatches alone", () => {
		const result = evaluateDiagRegistryDiff({ ...noDiff, severityMismatches: ["W002"], specCodesCount: 1 });
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[0], /Severity mismatch.*W002/);
	});

	it("reports all three drift kinds together when all are present", () => {
		const result = evaluateDiagRegistryDiff({
			missingInSpec: ["V999"],
			staleInSpec: ["V013"],
			severityMismatches: ["W002"],
			specCodesCount: 3,
		});
		assert.equal(result.exitCode, 1);
		assert.equal(result.stderrLines.length, 4);
		assert.match(result.stderrLines[3], /check-diag-registry: FAILED/);
	});
});
