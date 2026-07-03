import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildExamplesMd, parseFrontmatterField } from "./examples-index.mjs";

const HEADER = "<!-- generated -->\n\n# PFDSL Examples Reference\n\n";

function example(id, title, description, bodyLines = 2) {
	const desc = description ? `description: ${description}\n` : "";
	const edges = Array.from({ length: bodyLines }, (_, i) => `a${i} >> p${i} -> b${i}`).join("\n");
	return { id, source: `---\ntitle: ${title}\n${desc}---\n${edges}\n` };
}

describe("parseFrontmatterField", () => {
	it("extracts scalar fields and strips quotes", () => {
		const src = `---\ntitle: "T"\ndescription: D\n---\nbody\n`;
		assert.equal(parseFrontmatterField(src, "title"), "T");
		assert.equal(parseFrontmatterField(src, "description"), "D");
		assert.equal(parseFrontmatterField(src, "owner"), null);
	});
});

describe("buildExamplesMd", () => {
	it("emits an index entry per example with title and description", () => {
		const md = buildExamplesMd(
			[example("aa", "タイトルA", "パターンA"), example("bb", "タイトルB", null)],
			HEADER,
		);
		const index = md.slice(0, md.indexOf("## aa"));
		assert.match(index, /- aa（タイトルA）L\d+–L\d+ — パターンA\n/);
		assert.match(index, /- bb（タイトルB）L\d+–L\d+\n/);
	});

	it("index line ranges match the actual section positions (1-based, inclusive)", () => {
		const md = buildExamplesMd(
			[example("aa", "AA", "da", 3), example("bb", "BB", "db", 5), example("cc", "CC", "dc", 1)],
			HEADER,
		);
		const lines = md.split("\n");
		for (const [, id, start, end] of md.matchAll(/- (\w+)（.*?）L(\d+)–L(\d+)/g)) {
			assert.equal(lines[Number(start) - 1], `## ${id} — ${id.toUpperCase()}`, `start of ${id}`);
			assert.equal(lines[Number(end) - 1], "---", `end of ${id}`);
			assert.equal(lines[Number(end)], "", `blank separator after ${id}`);
		}
		assert.equal(md.match(/- \w+（/g).length, 3);
	});

	it("keeps section format compatible with the previous generator output", () => {
		const md = buildExamplesMd([example("aa", "タイトルA", "d")], HEADER);
		assert.ok(md.includes("## aa — タイトルA\n\n```pfdsl\n---\ntitle: タイトルA\n"));
		assert.ok(md.endsWith("---\n\n"));
	});
});
