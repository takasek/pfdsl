import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GEN_SKILL_TRIGGER } from "./gen-skill-trigger.mjs";

describe("GEN_SKILL_TRIGGER", () => {
	it("matches a docs/ path", () => {
		assert.equal(GEN_SKILL_TRIGGER.test("docs/foo.md"), true);
	});

	it("matches a scripts/skill-template/ path", () => {
		assert.equal(GEN_SKILL_TRIGGER.test("scripts/skill-template/x"), true);
	});

	it("matches scripts/gen-skill.mjs", () => {
		assert.equal(GEN_SKILL_TRIGGER.test("scripts/gen-skill.mjs"), true);
	});

	it("matches scripts/gen-skill-refs.mjs", () => {
		assert.equal(GEN_SKILL_TRIGGER.test("scripts/gen-skill-refs.mjs"), true);
	});

	it("matches scripts/lib/gen-skill-refs.mjs", () => {
		assert.equal(GEN_SKILL_TRIGGER.test("scripts/lib/gen-skill-refs.mjs"), true);
	});

	it("matches the modules that render the generated references", () => {
		// These build references/examples.md and references/samples.md. Editing
		// one changes the generated output without touching any file the rest of
		// this pattern names, so a stale bundle could be committed unnoticed
		// (#666).
		assert.equal(GEN_SKILL_TRIGGER.test("scripts/lib/examples-index.mjs"), true);
		assert.equal(GEN_SKILL_TRIGGER.test("scripts/lib/sample-companions.mjs"), true);
	});

	it("does not match an unrelated root-level README.md", () => {
		assert.equal(GEN_SKILL_TRIGGER.test("README.md"), false);
	});

	it("does not match an unrelated scripts/ file", () => {
		assert.equal(GEN_SKILL_TRIGGER.test("scripts/other.mjs"), false);
	});
});
