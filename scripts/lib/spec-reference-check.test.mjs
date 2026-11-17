import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	checkExternalSpecReferences,
	selectSpecReferenceSources,
} from "./spec-reference-check.mjs";

const source = (file, text) => ({ file, text });
const definitions = [{ file: "docs/spec/spec.md", id: "SPEC_rule", line: 1 }];

describe("external specification references", () => {
	it("detects a numbered citation even if it still names an existing, different rule", () => {
		const r = checkExternalSpecReferences(
			[source("packages/core/src/rule.ts", "/** Check the rule (§15.17). */")], // spec-ref-literal: numbered citation under test
			definitions,
		);
		assert.equal(r.violations.length, 1);
		assert.match(r.violations[0], /rule\.ts:1.*numbered/);
	});

	it("resolves IDs in source strings, Markdown code spans and fenced comments", () => {
		const files = [
			source("packages/core/src/rule.ts", 'const help = "[[SPEC_rule]]";'), // spec-ref-literal: reference extraction fixture
			source(
				"scripts/skill-template/SKILL.md",
				"`[[SPEC_rule]]`\n```yaml\n# [[SPEC_rule]]\n```", // spec-ref-literal: Markdown reference extraction fixture
			),
		];
		const r = checkExternalSpecReferences(files, definitions);
		assert.deepEqual(r.violations, []);
		assert.equal(r.references, 3);
	});

	it("fails when a referenced definition is removed or misspelled", () => {
		const files = [source("rule.ts", "// [[SPEC_rule]]")]; // spec-ref-literal: reference deletion fixture
		const r = checkExternalSpecReferences(files, []);
		assert.equal(r.violations.length, 1);
		assert.match(r.violations[0], /rule\.ts:1.*SPEC_rule.*no definition/);
	});

	it("keeps an ID reference valid when the target is renumbered", () => {
		const files = [source("rule.ts", "// [[SPEC_rule]]")]; // spec-ref-literal: renumbering fixture
		for (const section of ["15.16", "15.17"])
			assert.deepEqual(
				checkExternalSpecReferences(files, [{ ...definitions[0], section }])
					.violations,
				[],
			);
	});

	it("does not treat an external definition-shaped string as a definition", () => {
		const r = checkExternalSpecReferences(
			[source("rule.ts", "// (SPEC_typo) [[SPEC_typo]]")], // spec-ref-literal: external sources cannot define specification IDs
			definitions,
		);
		assert.equal(r.violations.length, 1);
	});

	it("allows a reasoned literal only on its annotated physical line", () => {
		const r = checkExternalSpecReferences(
			[
				source(
					"rule.test.ts",
					'expect(result).toBe("§8"); // spec-ref-literal: asserts explain output\n// [[SPEC_missing]]',
				),
			], // spec-ref-literal: line-local exemption fixture
			definitions,
		);
		assert.equal(r.literals, 1);
		assert.equal(r.violations.length, 1);
		assert.match(r.violations[0], /rule\.test\.ts:2.*SPEC_missing/);
	});

	it("requires a reason for literal annotations", () => {
		const r = checkExternalSpecReferences(
			[source("rule.ts", "// spec-ref-literal:")],
			definitions,
		);
		assert.equal(r.violations.length, 1);
		assert.match(r.violations[0], /reason/);
	});

	it("accepts an inline HTML literal comment before a Markdown sentence boundary", () => {
		const r = checkExternalSpecReferences(
			[
				source(
					"guide.md",
					"Example §8<!-- spec-ref-literal: lookup example -->。",
				),
			], // spec-ref-literal: Markdown punctuation fixture
			definitions,
		);
		assert.deepEqual(r.violations, []);
		assert.equal(r.literals, 1);
	});
});

describe("current reference sources", () => {
	it("includes code, tests, skill sources, current docs and operational companions", () => {
		const files = [
			"packages/core/src/rules/status.ts",
			"packages/core/src/validator.test.ts",
			"scripts/lib/gate-check.mjs",
			"scripts/skill-template/SKILL.md",
			"scripts/harness-template/skills/pfd-ops/SKILL.md",
			"scripts/root-instructions-template/INSTRUCTIONS.md",
			"README.md",
			"docs/quality-guide.md",
			".pfdsl/workflow.md",
			".pfdsl/bindings/pfd-ops.md",
		];
		assert.deepEqual(selectSpecReferenceSources(files), files);
	});

	it("leaves versioned records, fixtures, generated copies and the spec corpus alone", () => {
		const files = [
			"docs/spec/spec.md",
			"docs/spec/spec-history.md",
			"docs/spec/proposals/i6-presets.md",
			"docs/adr/0027-spec-id-cross-references.md",
			"docs/audits/2026-09-08/core-cli.md",
			"docs/reviews/standalone/2026-10-27/analysis.md",
			"docs/superpowers/plans/2026-06-13-pfd-ops-layering.md",
			"docs/pfd_payoff_log.md",
			".pfdsl/bindings/pfd-retro-patterns/case.md",
			"packages/standalone/evidence/result.md",
			"scripts/lib/fixtures/source.ts",
			"generated/skills/pfdsl/SKILL.md",
			"plugin/pfdsl/skills/pfdsl/SKILL.md",
			".agents/skills/pfdsl/SKILL.md",
			"AGENTS.md",
			"CLAUDE.md",
		];
		assert.deepEqual(selectSpecReferenceSources(files), []);
	});
});
