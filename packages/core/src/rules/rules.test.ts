import { describe, expect, it } from "vitest";
import { lex } from "../lexer.js";
import { normalize } from "../normalizer.js";
import { parseTokens } from "../parser.js";
import type { Frontmatter } from "../types/index.js";
import { RULES } from "../validator.js";
import { orphanedProcess, processCompleteness } from "./completeness.js";
import { buildRuleContext, type ValidateOptions } from "./context.js";
import { primaryGraphCycle } from "./cycles.js";
import { artifactOnlyFields } from "./field-placement.js";
import { roadmapStatusPresence } from "./status.js";

function contextFor(
	src: string,
	fm: Frontmatter | null = null,
	options: ValidateOptions = {},
) {
	const { tokens } = lex(src);
	const { document } = parseTokens(tokens);
	const { edges, nodeKinds } = normalize(document, fm);
	return buildRuleContext(edges, nodeKinds, fm, options);
}

// validator.test.ts covers what each code means, by running the whole checker
// and filtering. These cover the rule contract itself: a rule reports only its
// own codes, so a diagnostic can no longer reach the output from a rule the
// test never meant to exercise.

describe("a rule reports only its own codes", () => {
	it("processCompleteness emits nothing but V002/V003", () => {
		const ctx = contextFor("P -> B\nA >> Q");
		const codes = new Set(processCompleteness(ctx).map((d) => d.code));
		expect([...codes].sort()).toEqual(["V002", "V003"]);
	});

	it("orphanedProcess emits nothing but V020", () => {
		const fm: Frontmatter = { process: { ghost: {}, other: {} } };
		const codes = new Set(
			orphanedProcess(contextFor("", fm)).map((d) => d.code),
		);
		expect([...codes]).toEqual(["V020"]);
	});

	it("primaryGraphCycle emits nothing but V010", () => {
		const ctx = contextFor("a >> p -> b\nb >> q -> a");
		expect(new Set(primaryGraphCycle(ctx).map((d) => d.code))).toEqual(
			new Set(["V010"]),
		);
	});

	it("a rule stays silent on input that does not concern it", () => {
		// A perfectly ordinary graph: the cycle rule has nothing to say.
		expect(primaryGraphCycle(contextFor("a >> p -> b"))).toEqual([]);
	});
});

describe("--strict is applied uniformly", () => {
	it.each([
		{
			name: "V002",
			rule: processCompleteness,
			src: "P -> B",
			fm: null as Frontmatter | null,
		},
		{
			name: "V020",
			rule: orphanedProcess,
			src: "",
			fm: { process: { ghost: {} } } as Frontmatter,
		},
		{
			name: "W002",
			rule: artifactOnlyFields,
			src: "A >> P -> B",
			fm: { artifact: { B: {} } } as Frontmatter,
		},
		{
			name: "W005",
			rule: roadmapStatusPresence,
			src: "A >> P -> B",
			fm: { type: "roadmap" } as Frontmatter,
		},
	])("$name is a warning by default and an error under --strict", ({
		name,
		rule,
		src,
		fm,
	}) => {
		const lenient = rule(contextFor(src, fm)).filter((d) => d.code === name);
		const strict = rule(contextFor(src, fm, { strict: true })).filter(
			(d) => d.code === name,
		);
		expect(lenient.map((d) => d.severity)).toEqual([
			...Array(lenient.length).fill("warning"),
		]);
		expect(lenient.length).toBeGreaterThan(0);
		expect(strict.map((d) => d.severity)).toEqual([
			...Array(strict.length).fill("error"),
		]);
	});
});

describe("the rule registry", () => {
	it("runs every registered rule against a context without throwing", () => {
		const ctx = contextFor("A >> P -> B");
		for (const rule of RULES) {
			expect(() => rule(ctx)).not.toThrow();
		}
	});

	it("holds no duplicate entries, which would double every diagnostic", () => {
		expect(new Set(RULES).size).toBe(RULES.length);
	});

	it("survives an empty document", () => {
		const ctx = contextFor("");
		expect(() => RULES.flatMap((rule) => rule(ctx))).not.toThrow();
	});
});

describe("buildRuleContext", () => {
	it("normalizes a YAML-null declaration to an empty record (#490)", () => {
		const fm = {
			artifact: { A: null },
			process: { P: null },
		} as unknown as Frontmatter;
		const ctx = contextFor("A >> P -> B", fm);
		expect(ctx.artifactMeta.A).toEqual({});
		expect(ctx.processMeta.P).toEqual({});
	});

	it("collects every process that touches an edge of any kind", () => {
		const ctx = contextFor("a >> p -> b\nx >>? q\nr -> c");
		expect(ctx.edgeProcesses).toEqual(new Set(["p", "q", "r"]));
	});

	it("builds primary adjacency without feedback edges", () => {
		const ctx = contextFor("a >> p -> b\nb >>? p");
		expect(ctx.primaryAdj.get("a")).toEqual(["p"]);
		expect(ctx.primaryAdj.get("p")).toEqual(["b"]);
		// the feedback edge contributes no b -> p link
		expect(ctx.primaryAdj.get("b")).toBeUndefined();
	});

	it("counts a feedback-only node among the nodes that have edges", () => {
		const ctx = contextFor("a >> p -> b\nx >>? p");
		expect(ctx.nodesWithEdges.has("x")).toBe(true);
	});

	it("falls back to a zero range when no source was supplied", () => {
		expect(contextFor("A >> P -> B").rangeOf("A").start.line).toBe(1);
	});

	it("finds a declaration's range when the source was supplied", () => {
		const src = [
			"---",
			"artifact:",
			"  myArt:",
			"    status: done",
			"---",
			"",
		].join("\n");
		const fm: Frontmatter = { artifact: { myArt: { status: "done" } } };
		const ctx = contextFor("A >> P -> myArt", fm, { source: src });
		expect(ctx.rangeOf("myArt").start.line).toBe(3);
	});
});
