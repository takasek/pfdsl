import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The pfdsl skill tells readers how to reach a rule in references/spec.md
// from the section number `pfdsl explain` prints (#1600). Most rules sit in
// `###` / `####` subsections, and top-level headings put a dot after the
// number (`## 9.`), so the advertised search has to reach both.
const skill = readFileSync("scripts/skill-template/SKILL.md", "utf8");
const spec = readFileSync("docs/spec/spec.md", "utf8");

function headingSearchPattern() {
	const m = /grep -nE '(\^#\+ [^']+)'/.exec(skill);
	assert.ok(m, "SKILL.md shows a grep -nE example for section headings");
	return m[1];
}

function patternFor(section, template) {
	const escaped = section.replace(/\./g, "\\.");
	return new RegExp(template.replace(/\d+(\\\.\d+)*/, escaped), "m");
}

describe("pfdsl skill: reading references/spec.md by section number", () => {
	it("the heading search reaches a subsection and a top-level section", () => {
		const template = headingSearchPattern();
		assert.match(spec, patternFor("15.16", template));
		assert.match(spec, patternFor("9", template));
		assert.match(spec, patternFor("2.8.4", template));
	});

	it("the heading search for 15.1 does not also hit 15.10", () => {
		const re = patternFor("15.1", headingSearchPattern());
		const hits = spec.split("\n").filter((line) => re.test(line));
		assert.equal(hits.length, 1, hits.join("\n"));
	});

	it("does not state a section count that drifts as the spec grows", () => {
		const m = /.*\d+節.*/.exec(skill);
		assert.equal(m, null, `section count found: ${m?.[0]}`);
	});
});
