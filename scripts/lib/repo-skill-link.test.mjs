import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { decideSkillLinkAction, SKILL_LINK_TARGET as TARGET } from "./repo-skill-link.mjs";

describe("decideSkillLinkAction", () => {
	it("creates the link when nothing is at the path", () => {
		const decision = decideSkillLinkAction({ present: false }, TARGET);
		assert.equal(decision.action, "create");
	});

	it("leaves an already-correct link alone", () => {
		const decision = decideSkillLinkAction({ present: true, isSymlink: true, linkTarget: TARGET }, TARGET);
		assert.equal(decision.action, "ok");
	});

	it("relinks a symlink that points somewhere else", () => {
		const decision = decideSkillLinkAction(
			{ present: true, isSymlink: true, linkTarget: "../../somewhere/else" },
			TARGET,
		);
		assert.equal(decision.action, "relink");
		assert.match(decision.reason, /\.\.\/\.\.\/somewhere\/else/);
	});

	// The migration case: checkouts made before this change carry a real
	// generated directory, which is exactly the copy that goes stale on a
	// branch switch (#714). Replacing it is safe — it is gitignored output.
	it("replaces a real directory left over from the generated-copy era", () => {
		const decision = decideSkillLinkAction({ present: true, isSymlink: false }, TARGET);
		assert.equal(decision.action, "replace");
	});
});
