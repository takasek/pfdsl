import { describe, expect, it } from "vitest";
import { lex } from "./lexer.js";
import { normalize } from "./normalizer.js";
import { parseTokens } from "./parser.js";
import type { Frontmatter } from "./types/index.js";
import { validate } from "./validator.js";

function diagnose(src: string, fm: Frontmatter | null = null) {
	const { tokens } = lex(src);
	const { document } = parseTokens(tokens);
	const { edges, nodeKinds } = normalize(document, fm);
	return validate(edges, nodeKinds, fm);
}

function codes(src: string, fm: Frontmatter | null = null): string[] {
	return diagnose(src, fm).map((d) => d.code);
}

describe("validate", () => {
	it("valid graph: no diagnostics", () => {
		expect(diagnose("A >> P -> B")).toHaveLength(0);
	});

	it("V001: single-source violation (two processes generate same artifact)", () => {
		expect(codes("A >> P -> C\nB >> Q -> C")).toContain("V001");
	});

	it("V001: feedback edges do not count as generators", () => {
		// P generates C once; Q only feedback-reads C. Must not emit V001.
		expect(codes("A >> P -> C\nC >>? Q\nB >> Q -> D")).not.toContain("V001");
	});

	it("V002: process with no inputs", () => {
		expect(codes("P -> B")).toContain("V002");
	});

	it("V003: process with no outputs", () => {
		expect(codes("A >> P")).toContain("V003");
	});

	it("V004: parts member is a process", () => {
		const fm: Frontmatter = { artifact: { C: { parts: ["P"] } } };
		const diags = diagnose("A >> P -> B", fm);
		expect(diags.map((d) => d.code)).toContain("V004");
	});

	it("V004: parts member is a front-matter-only process (not in body)", () => {
		const fm: Frontmatter = {
			process: { ghost: {} },
			artifact: { C: { parts: ["ghost"] } },
		};
		expect(codes("", fm)).toContain("V004");
	});

	it("V005: parts self-reference", () => {
		const fm: Frontmatter = { artifact: { A: { parts: ["A"] } } };
		const diags = diagnose("A >> P -> B", fm);
		expect(diags.map((d) => d.code)).toContain("V005");
	});

	it("V006: parts cycle", () => {
		const fm: Frontmatter = {
			artifact: { A: { parts: ["B"] }, B: { parts: ["A"] } },
		};
		const diags = diagnose("", fm);
		expect(diags.map((d) => d.code)).toContain("V006");
	});

	it("valid chain: no errors", () => {
		expect(
			diagnose("req >> design -> spec\nspec >> impl -> code"),
		).toHaveLength(0);
	});

	it("V007: invalid status enum value", () => {
		const fm = {
			artifact: { A: { status: "finished" } },
		} as unknown as Frontmatter;
		expect(codes("A >> P -> B", fm)).toContain("V007");
	});

	it("V008: invalid statusStyles key", () => {
		const fm = {
			statusStyles: { finished: { fillcolor: "gray" } },
		} as unknown as Frontmatter;
		expect(codes("A >> P -> B", fm)).toContain("V008");
	});

	it("V009: invalid attribute in statusStyles", () => {
		const fm = {
			statusStyles: { done: { bogus: "x" } },
		} as unknown as Frontmatter;
		expect(codes("A >> P -> B", fm)).toContain("V009");
	});

	it("V009: invalid attribute in tagStyles", () => {
		const fm = {
			tagStyles: { external: { invalidAttr: "x" } },
		} as unknown as Frontmatter;
		expect(codes("A >> P -> B", fm)).toContain("V009");
	});

	it("tags: arbitrary strings produce no error", () => {
		const fm: Frontmatter = {
			artifact: { A: { tags: ["anything", "goes", "here"] } },
		};
		const cs = codes("A >> P -> B", fm);
		expect(cs).not.toContain("V007");
		expect(cs).not.toContain("V008");
		expect(cs).not.toContain("V009");
	});

	it("tagStyles: undefined tag used by artifact emits no error", () => {
		const fm: Frontmatter = {
			artifact: { A: { tags: ["undefined-tag"] } },
			tagStyles: { other: { color: "blue" } },
		};
		const cs = codes("A >> P -> B", fm);
		expect(cs).not.toContain("V009");
	});

	it("V002/V003: isolated process (no edges) does not trigger completeness errors", () => {
		const cs = codes("idle_process");
		expect(cs).not.toContain("V002");
		expect(cs).not.toContain("V003");
	});

	it("V002/V003: process with output but no input still triggers V002", () => {
		expect(codes("P -> B")).toContain("V002");
	});

	it("V002/V003: process with input but no output still triggers V003", () => {
		expect(codes("A >> P")).toContain("V003");
	});

	describe("W001: parts member without edges", () => {
		it("warns when a parts member has no edges in the graph", () => {
			const fm: Frontmatter = {
				artifact: { bundle: { parts: ["orphan"] } },
			};
			// 'orphan' appears only in parts, never in body edges
			expect(codes("A >> P -> bundle", fm)).toContain("W001");
		});

		it("does not warn when a parts member participates in at least one edge", () => {
			const fm: Frontmatter = {
				artifact: { bundle: { parts: ["piece"] } },
			};
			// 'piece' appears in body as an artifact with edges
			expect(codes("A >> P -> piece\npiece >> Q -> bundle", fm)).not.toContain(
				"W001",
			);
		});

		it("warning severity is 'warning', not 'error'", () => {
			const fm: Frontmatter = {
				artifact: { bundle: { parts: ["orphan"] } },
			};
			const diags = diagnose("A >> P -> bundle", fm);
			const w001 = diags.find((d) => d.code === "W001");
			expect(w001?.severity).toBe("warning");
		});
	});

	describe("V011: strict-mode feedback validation", () => {
		function strictCodes(src: string): string[] {
			const { tokens } = lex(src);
			const { document } = parseTokens(tokens);
			const { edges, nodeKinds } = normalize(document, null);
			return validate(edges, nodeKinds, null, { strict: true }).map(
				(d) => d.code,
			);
		}

		it("does not report V011 in non-strict mode even when feedback target is unreachable", () => {
			// X >>? P  — X is never produced by P in primary graph
			expect(codes("a >> p -> b\nx >>? p")).not.toContain("V011");
		});

		it("does not report V011 in strict mode when P can reach A in the primary graph", () => {
			// a >> p -> b   b >>? q -> c   q produces b in primary, so feedback b>>?q is valid
			expect(strictCodes("a >> p -> b\nb >>? p")).not.toContain("V011");
		});

		it("reports V011 in strict mode when feedback artifact is not reachable from its process", () => {
			// x is never an output of p in the primary graph
			expect(strictCodes("a >> p -> b\nx >>? p")).toContain("V011");
		});

		it("V011 severity is error", () => {
			const { tokens } = lex("a >> p -> b\nx >>? p");
			const { document } = parseTokens(tokens);
			const { edges, nodeKinds } = normalize(document, null);
			const diags = validate(edges, nodeKinds, null, { strict: true });
			const v011 = diags.find((d) => d.code === "V011");
			expect(v011?.severity).toBe("error");
		});
	});

	describe("V010: primary-graph cycle detection", () => {
		it("detects a direct cycle between two processes", () => {
			// a >> p -> b  +  b >> q -> a  forms a cycle in the primary graph
			expect(codes("a >> p -> b\nb >> q -> a")).toContain("V010");
		});

		it("detects a longer cycle spanning three processes", () => {
			expect(codes("a >> p -> b\nb >> q -> c\nc >> r -> a")).toContain("V010");
		});

		it("does not report V010 for a valid acyclic graph", () => {
			expect(
				codes("req >> design -> spec\nspec >> impl -> code"),
			).not.toContain("V010");
		});

		it("does not report V010 when only a feedback edge forms the return path", () => {
			// primary: a >> p -> b. feedback: b >>? p. No primary-graph cycle.
			expect(codes("a >> p -> b\nb >>? p")).not.toContain("V010");
		});
	});
});
