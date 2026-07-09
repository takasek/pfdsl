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

	it("does not match an unrelated root-level README.md", () => {
		assert.equal(GEN_SKILL_TRIGGER.test("README.md"), false);
	});

	it("does not match an unrelated scripts/ file", () => {
		assert.equal(GEN_SKILL_TRIGGER.test("scripts/other.mjs"), false);
	});
});
