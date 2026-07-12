import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	normalizeId,
	findOccurrencesInText,
	formatOccurrences,
	mintCheckExitCode,
} from "./mint-check.mjs";

describe("normalizeId", () => {
	it("prepends the SPEC_ prefix to a bare slug", () => {
		assert.equal(normalizeId("foo_bar"), "SPEC_foo_bar");
	});

	it("leaves an already-prefixed id unchanged", () => {
		assert.equal(normalizeId("SPEC_foo_bar"), "SPEC_foo_bar");
	});
});

describe("findOccurrencesInText", () => {
	it("finds a definition and labels it 'definition' with the source line text", () => {
		const text = "intro\n## Heading (SPEC_foo)\ntail";
		const occ = findOccurrencesInText("SPEC_foo", "spec.md", text);
		assert.equal(occ.length, 1);
		assert.deepEqual(
			{ kind: occ[0].kind, file: occ[0].file, line: occ[0].line, text: occ[0].text },
			{ kind: "definition", file: "spec.md", line: 2, text: "## Heading (SPEC_foo)" },
		);
	});

	it("finds a strict reference and labels it 'strict-ref'", () => {
		const text = "see [[SPEC_foo]] here";
		const occ = findOccurrencesInText("SPEC_foo", "spec.md", text);
		assert.equal(occ.length, 1);
		assert.equal(occ[0].kind, "strict-ref");
	});

	it("finds a forward-ref marker and labels it 'forward-ref'", () => {
		const text = "planned: [[SPEC_foo?]] later";
		const occ = findOccurrencesInText("SPEC_foo", "spec.md", text);
		assert.equal(occ.length, 1);
		assert.equal(occ[0].kind, "forward-ref");
	});

	it("does not confuse a forward-ref marker with a strict reference", () => {
		const text = "[[SPEC_foo?]]";
		const occ = findOccurrencesInText("SPEC_foo", "spec.md", text);
		assert.equal(occ.length, 1);
		assert.equal(occ[0].kind, "forward-ref");
	});

	it("returns every occurrence kind for the same slug, sorted by line", () => {
		const text = [
			"[[SPEC_foo?]] forward",
			"## Def (SPEC_foo)",
			"strict [[SPEC_foo]]",
		].join("\n");
		const occ = findOccurrencesInText("SPEC_foo", "spec.md", text);
		assert.deepEqual(
			occ.map((o) => [o.line, o.kind]),
			[
				[1, "forward-ref"],
				[2, "definition"],
				[3, "strict-ref"],
			],
		);
	});

	it("ignores occurrences of other slugs", () => {
		const text = "## Other (SPEC_bar)\n[[SPEC_bar]]";
		assert.deepEqual(findOccurrencesInText("SPEC_foo", "spec.md", text), []);
	});

	it("ignores markers inside a fenced code block", () => {
		const text = ["```", "(SPEC_foo)", "```", "outside [[SPEC_foo?]]"].join("\n");
		const occ = findOccurrencesInText("SPEC_foo", "spec.md", text);
		assert.equal(occ.length, 1);
		assert.equal(occ[0].kind, "forward-ref");
		assert.equal(occ[0].line, 4);
	});

	it("returns an empty array when the slug is never used", () => {
		assert.deepEqual(findOccurrencesInText("SPEC_unused", "spec.md", "nothing here"), []);
	});
});

describe("formatOccurrences", () => {
	it("formats each occurrence as 'file:line: kind text'", () => {
		const occurrences = [
			{ kind: "definition", file: "spec.md", line: 2, text: "## Heading (SPEC_foo)" },
			{ kind: "strict-ref", file: "spec.md", line: 9, text: "see [[SPEC_foo]]" },
		];
		assert.equal(
			formatOccurrences(occurrences),
			"spec.md:2: definition ## Heading (SPEC_foo)\nspec.md:9: strict-ref see [[SPEC_foo]]",
		);
	});

	it("returns an empty string when there are no occurrences", () => {
		assert.equal(formatOccurrences([]), "");
	});
});

describe("mintCheckExitCode", () => {
	it("returns 1 when a prior occurrence exists (mint blocked)", () => {
		assert.equal(mintCheckExitCode([{ kind: "definition" }]), 1);
	});

	it("returns 0 when the slug has no prior occurrence (safe to mint)", () => {
		assert.equal(mintCheckExitCode([]), 0);
	});
});
