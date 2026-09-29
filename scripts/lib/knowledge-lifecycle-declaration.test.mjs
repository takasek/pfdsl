import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// ADR-0041: the pfd-retro D-layer adoption declaration is a stable ASCII
// tri-state token. Adopters and tools match this exact line, so the SKILL,
// the scaffold and this repo's binding must all agree on the literal key.
const KEY = "knowledge-lifecycle-audit";
const declarationLine = /^knowledge-lifecycle-audit: (adopt|decline)\s*$/;

const read = (path) => readFileSync(path, "utf8");
const skill = read(".claude/skills/pfd-retro/SKILL.md");
const scaffold = read(
	".claude/skills/pfd-ops/references/scaffold/bindings/pfd-retro.md",
);
const binding = read(".pfdsl/bindings/pfd-retro.md");

// A declaration is a whole line, so a line that only mentions the key in
// prose (as the SKILL does) is not counted. Lines that start with the key
// but carry an invalid value are counted separately so duplicates and typos
// are both visible.
function declarations(markdown) {
	const keyed = markdown
		.split("\n")
		.filter((line) => line.startsWith(`${KEY}:`));
	return {
		keyed,
		valid: keyed.filter((line) => declarationLine.test(line)),
	};
}

describe("pfd-retro D-layer declaration token (ADR-0041)", () => {
	it("SKILL names the literal key and the three states it distinguishes", () => {
		assert.ok(skill.includes(KEY));
		assert.match(skill, /`adopt`/);
		assert.match(skill, /`decline`/);
		assert.doesNotMatch(skill, /知識成果物ライフサイクル監査: 採用する/);
	});

	it("scaffold ships exactly one declaration line, with value decline", () => {
		const { keyed, valid } = declarations(scaffold);
		assert.equal(keyed.length, 1);
		assert.equal(valid.length, 1);
		assert.equal(valid[0].trim(), `${KEY}: decline`);
	});

	it("this repo's binding has exactly one valid declaration line", () => {
		const { keyed, valid } = declarations(binding);
		assert.equal(keyed.length, 1);
		assert.equal(valid.length, 1);
	});

	it("no active consumer still uses the retired Japanese declaration", () => {
		assert.doesNotMatch(scaffold, /^知識成果物ライフサイクル監査:/m);
		assert.doesNotMatch(binding, /^知識成果物ライフサイクル監査:/m);
	});
});
