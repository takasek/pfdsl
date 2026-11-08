import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	diffDiagRegistry,
	diffDiagSections,
	diffDiagSpecIds,
	evaluateDiagRegistryDiff,
	parseSpecDiagSections,
	parseSpecDiagSpecIds,
	parseSpecDiagTable,
} from "./diag-registry-check.mjs";

const TABLE_HEADER =
	"| コード | severity | 定義節 | 条件 |\n|---|---|---|---|\n";

describe("diagnostic definition sections", () => {
	it("matches a literal §15.11 section", () => {
		const sections = parseSpecDiagSections(
			`${TABLE_HEADER}| V001 | error | §15.11 | rule |\n`,
		);
		assert.deepEqual(sections, { V001: "15.11" });
		assert.deepEqual(
			diffDiagSections(sections, { V001: { section: "15.11" } }),
			[],
		);
	});
	it("resolves a SPEC id to its numbered heading", () => {
		const sections = parseSpecDiagSections(
			`### 15.11. Rule (SPEC_x) (explanation)\n\n${TABLE_HEADER}| V001 | error | [[SPEC_x]] | rule |\n`,
		);
		assert.deepEqual(sections, { V001: "15.11" });
		assert.deepEqual(
			diffDiagSections(sections, { V001: { section: "15.11" } }),
			[],
		);
	});
	it("resolves a SPEC id defined on an indented CommonMark heading", () => {
		const sections = parseSpecDiagSections(
			`   ### 15.11 Rule (SPEC_x)\n\n${TABLE_HEADER}| V001 | error | [[SPEC_x]] | rule |\n`,
		);
		assert.deepEqual(sections, { V001: "15.11" });
	});
	it("reports mismatches only for codes on both sides", () => {
		assert.deepEqual(
			diffDiagSections(
				{ V001: "15.1", V002: "2" },
				{ V001: { section: "15.11" }, V003: { section: "3" } },
			),
			["V001"],
		);
	});
	it("reports unresolved ids, including definitions inside code", () => {
		const sections = parseSpecDiagSections(
			`\`\`\`\n## 15.11 Rule (SPEC_x)\n\`\`\`\n${TABLE_HEADER}| V001 | error | [[SPEC_x]] | rule |\n`,
		);
		assert.deepEqual(sections, { V001: null });
		assert.deepEqual(
			diffDiagSections(sections, { V001: { section: "15.11" } }),
			["V001"],
		);
	});
	it("fails on section mismatches alone", () => {
		const result = evaluateDiagRegistryDiff({
			missingInSpec: [],
			staleInSpec: [],
			severityMismatches: [],
			sectionMismatches: ["V001"],
			specIdMismatches: [],
			specCodesCount: 1,
		});
		assert.equal(result.exitCode, 1);
		assert.deepEqual(result.stdoutLines, []);
		assert.match(result.stderrLines[0], /Section mismatch.*V001/);
	});
});

describe("diagnostic spec IDs", () => {
	const specIds = (rows) => parseSpecDiagSpecIds(`${TABLE_HEADER}${rows}`);

	it("reads the ID from a reference cell and null from a literal section", () => {
		assert.deepEqual(
			specIds(
				"| V001 | error | [[SPEC_x]] | rule |\n| V002 | error | §9 | rule |\n",
			),
			{ V001: "SPEC_x", V002: null },
		);
	});
	it("accepts a registry that matches both kinds of cell", () => {
		assert.deepEqual(
			diffDiagSpecIds(
				{ V001: "SPEC_x", V002: null },
				{ V001: { specId: "SPEC_x" }, V002: {} },
			),
			[],
		);
	});
	it("reports a registry entry that lacks the ID in the table", () => {
		assert.deepEqual(diffDiagSpecIds({ V001: "SPEC_x" }, { V001: {} }), [
			"V001",
		]);
	});
	it("reports a registry entry that has a different ID", () => {
		assert.deepEqual(
			diffDiagSpecIds({ V001: "SPEC_x" }, { V001: { specId: "SPEC_y" } }),
			["V001"],
		);
	});
	it("reports a registry ID on a section the table cites by number", () => {
		assert.deepEqual(
			diffDiagSpecIds({ V001: null }, { V001: { specId: "SPEC_x" } }),
			["V001"],
		);
	});
	it("ignores codes that exist on only one side", () => {
		assert.deepEqual(
			diffDiagSpecIds({ V001: "SPEC_x" }, { V002: { specId: "SPEC_y" } }),
			[],
		);
	});
	it("fails on spec ID mismatches alone", () => {
		const result = evaluateDiagRegistryDiff({
			missingInSpec: [],
			staleInSpec: [],
			severityMismatches: [],
			sectionMismatches: [],
			specIdMismatches: ["V001"],
			specCodesCount: 1,
		});
		assert.equal(result.exitCode, 1);
		assert.deepEqual(result.stdoutLines, []);
		assert.match(result.stderrLines[0], /Spec ID mismatch.*V001/);
	});
});

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
		assert.throws(
			() => parseSpecDiagTable("no table here"),
			/table header not found/,
		);
	});

	it("throws on an unrecognized severity label", () => {
		const text = `${TABLE_HEADER}| V001 | oops | §15.1 | condition |\n`;
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

const noDiff = {
	missingInSpec: [],
	staleInSpec: [],
	severityMismatches: [],
	sectionMismatches: [],
	specIdMismatches: [],
};

describe("evaluateDiagRegistryDiff", () => {
	it("refuses a call that omits one of the four drift kinds", () => {
		const { sectionMismatches: _omitted, ...withoutSections } = noDiff;
		assert.throws(
			() => evaluateDiagRegistryDiff({ ...withoutSections, specCodesCount: 1 }),
			/sectionMismatches/,
		);
	});

	it("exits 0 with an OK message carrying the spec code count when there is no drift", () => {
		const result = evaluateDiagRegistryDiff({ ...noDiff, specCodesCount: 42 });
		assert.equal(result.exitCode, 0);
		assert.deepEqual(result.stdoutLines, [
			"check-diag-registry: OK (42 codes match)",
		]);
		assert.deepEqual(result.stderrLines, []);
	});

	// Each of the 3 branches must independently set `failed` — guards against
	// e.g. someone turning these into `else if` and silently only checking one.
	it("fails on missingInSpec alone", () => {
		const result = evaluateDiagRegistryDiff({
			...noDiff,
			missingInSpec: ["V999"],
			specCodesCount: 1,
		});
		assert.equal(result.exitCode, 1);
		assert.match(
			result.stderrLines[0],
			/missing from spec\.md §16 table: V999/,
		);
	});

	it("fails on staleInSpec alone", () => {
		const result = evaluateDiagRegistryDiff({
			...noDiff,
			staleInSpec: ["V013"],
			specCodesCount: 1,
		});
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[0], /not emitted by core \(stale\): V013/);
	});

	it("fails on severityMismatches alone", () => {
		const result = evaluateDiagRegistryDiff({
			...noDiff,
			severityMismatches: ["W002"],
			specCodesCount: 1,
		});
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[0], /Severity mismatch.*W002/);
	});

	it("reports all four drift kinds together when all are present", () => {
		const result = evaluateDiagRegistryDiff({
			missingInSpec: ["V999"],
			staleInSpec: ["V013"],
			severityMismatches: ["W002"],
			sectionMismatches: ["V001"],
			specIdMismatches: [],
			specCodesCount: 3,
		});
		assert.equal(result.exitCode, 1);
		assert.equal(result.stderrLines.length, 5);
		assert.match(result.stderrLines[3], /Section mismatch.*V001/);
		assert.match(result.stderrLines[4], /check-diag-registry: FAILED/);
	});
});
