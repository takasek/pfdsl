import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(path, "utf8");

const skill = read(".claude/skills/pfd-ops/SKILL.md");
const workCycle = read(".claude/skills/pfd-ops/references/work-cycle.md");
const roadmapScaffold = read(
	".claude/skills/pfd-ops/references/scaffold/roadmap.md",
);

describe("pfd-ops applicability contract", () => {
	it("leaves ordinary issue work alone when the repository has not adopted PFDs", () => {
		assert.match(skill, /\.pfdsl\/roadmap\.pfdsl[^\n]+存在しない[^\n]+非適用/);
		assert.match(skill, /明示的に PFD の導入[^\n]+依頼/);
		assert.doesNotMatch(
			skill,
			/bare issue or\s+work-item number[\s\S]+route it through the work cycle/,
		);
	});

	it("keeps the generic work cycle independent of the selected backend", () => {
		assert.match(workCycle, /作業項目の本文とコメント/);
		assert.doesNotMatch(workCycle, /gh issue view/);
	});

	it("makes roadmap adoption distinct from other GitHub Issues usage", () => {
		assert.match(roadmapScaffold, /roadmap の作業項目バックエンドとしての採否/);
		assert.match(roadmapScaffold, /roadmap 管理外/);
	});
});
