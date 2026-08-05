import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { collectModuleClosure } from "./check-script-imports.mjs";
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

	it("matches scripts/lib/gen-skill-refs.mjs", () => {
		assert.equal(
			GEN_SKILL_TRIGGER.test("scripts/lib/gen-skill-refs.mjs"),
			true,
		);
	});

	it("covers every module gen-skill.mjs imports", () => {
		// The alternation is hand-kept and drifts from the code it tracks, which
		// is how #666's two holes opened. Deriving the expectation from the real
		// import closure makes the next dependency fail here rather than ship a
		// stale bundle. The plugin trigger has the same assertion for its own
		// entry point; both are needed, since neither closure contains the other.
		const root = `${resolve(dirname(fileURLToPath(import.meta.url)), "../..")}/`;
		const closure = [...collectModuleClosure("scripts/gen-skill.mjs")].map(
			(file) => (file.startsWith(root) ? file.slice(root.length) : file),
		);
		assert.ok(closure.length > 0);
		for (const file of closure) {
			assert.ok(
				GEN_SKILL_TRIGGER.test(file),
				`${file} triggers no drift check`,
			);
		}
	});

	it("does not match an unrelated root-level README.md", () => {
		assert.equal(GEN_SKILL_TRIGGER.test("README.md"), false);
	});

	it("does not match an unrelated scripts/ file", () => {
		assert.equal(GEN_SKILL_TRIGGER.test("scripts/other.mjs"), false);
	});
});
