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

	it("V009: invalid attribute in tag style", () => {
		const fm = {
			tag: { external: { style: { invalidAttr: "x" } } },
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

	it("tag: undefined tag used by artifact emits no error", () => {
		const fm: Frontmatter = {
			artifact: { A: { tags: ["undefined-tag"] } },
			tag: { other: { style: { color: "blue" } } },
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

	describe("W002: artifact without criteria", () => {
		it("warns when done artifact has no criteria field", () => {
			const fm: Frontmatter = { artifact: { A: { status: "done" } } };
			const diags = diagnose("A >> P -> B", fm);
			expect(diags.map((d) => d.code)).toContain("W002");
		});

		it("warns when wip artifact has no criteria field", () => {
			const fm: Frontmatter = { artifact: { A: { status: "wip" } } };
			expect(codes("A >> P -> B", fm)).toContain("W002");
		});

		it("warns when todo artifact has no criteria field", () => {
			const fm: Frontmatter = { artifact: { A: { status: "todo" } } };
			expect(codes("A >> P -> B", fm)).toContain("W002");
		});

		it("warns when artifact has no status and no criteria", () => {
			const fm: Frontmatter = { artifact: { A: {} } };
			expect(codes("A >> P -> B", fm)).toContain("W002");
		});

		it("W002 severity is warning in non-strict mode", () => {
			const fm: Frontmatter = { artifact: { A: { status: "done" } } };
			const diags = diagnose("A >> P -> B", fm);
			const w002 = diags.find((d) => d.code === "W002");
			expect(w002?.severity).toBe("warning");
		});

		it("W002 becomes error in strict mode", () => {
			const { tokens } = lex("A >> P -> B");
			const { document } = parseTokens(tokens);
			const fm: Frontmatter = { artifact: { A: { status: "done" } } };
			const { edges, nodeKinds } = normalize(document, fm);
			const diags = validate(edges, nodeKinds, fm, { strict: true });
			const w002 = diags.find((d) => d.code === "W002");
			expect(w002?.severity).toBe("error");
		});

		it("no W002 when artifact has criteria", () => {
			const fm: Frontmatter = {
				artifact: { A: { status: "done", criteria: "approved by TL" } },
			};
			expect(codes("A >> P -> B", fm)).not.toContain("W002");
		});

		it("no W002 when non-done artifact has criteria", () => {
			const fm: Frontmatter = {
				artifact: { A: { status: "wip", criteria: "PR passes CI" } },
			};
			expect(codes("A >> P -> B", fm)).not.toContain("W002");
		});
	});

	describe("V012: criteria on process", () => {
		it("errors when criteria is set on a process", () => {
			const fm = {
				process: { P: { criteria: "must pass all tests" } },
			} as unknown as Frontmatter;
			expect(codes("A >> P -> B", fm)).toContain("V012");
		});
	});

	describe("V013: location on process", () => {
		it("errors when location is set on a process", () => {
			const fm = {
				process: { P: { location: "src/process.ts" } },
			} as unknown as Frontmatter;
			expect(codes("A >> P -> B", fm)).toContain("V013");
		});
	});

	describe("V014: command on artifact", () => {
		it("errors when command is set on an artifact", () => {
			const fm = {
				artifact: { A: { command: "make build" } },
			} as unknown as Frontmatter;
			expect(codes("A >> P -> B", fm)).toContain("V014");
		});
	});

	describe("V015: revises on process", () => {
		it("errors when revises is set on a process", () => {
			const fm = {
				process: { P: { revises: "old_proc" } },
			} as unknown as Frontmatter;
			expect(codes("A >> P -> B", fm)).toContain("V015");
		});
	});

	describe("V016: revises target not found", () => {
		it("errors when revises references a non-existent artifact id", () => {
			const fm: Frontmatter = {
				artifact: { v2: { revises: "v1" } },
			};
			expect(codes("v2 >> P -> B", fm)).toContain("V016");
		});

		it("no V016 when revises target exists", () => {
			const fm: Frontmatter = {
				artifact: { v2: { revises: "v1" }, v1: {} },
			};
			expect(codes("v2 >> P -> B", fm)).not.toContain("V016");
		});
	});

	describe("V017: revises self-reference", () => {
		it("errors when artifact revises itself", () => {
			const fm: Frontmatter = {
				artifact: { v1: { revises: "v1" } },
			};
			expect(codes("v1 >> P -> B", fm)).toContain("V017");
		});
	});

	describe("V018: revises branching (multiple artifacts revise same target)", () => {
		it("errors when two artifacts revise the same artifact", () => {
			const fm: Frontmatter = {
				artifact: { v2a: { revises: "v1" }, v2b: { revises: "v1" }, v1: {} },
			};
			expect(codes("v2a >> P -> B", fm)).toContain("V018");
		});

		it("no V018 for linear chain", () => {
			const fm: Frontmatter = {
				artifact: { v3: { revises: "v2" }, v2: { revises: "v1" }, v1: {} },
			};
			expect(codes("v3 >> P -> B", fm)).not.toContain("V018");
		});
	});

	describe("V019: revises cycle", () => {
		it("errors when revises chain forms a cycle", () => {
			const fm: Frontmatter = {
				artifact: { a: { revises: "b" }, b: { revises: "a" } },
			};
			expect(codes("", fm)).toContain("V019");
		});

		it("reports all independent cycles, not just the first", () => {
			const fm: Frontmatter = {
				artifact: {
					a: { revises: "b" },
					b: { revises: "a" },
					c: { revises: "d" },
					d: { revises: "c" },
				},
			};
			const cs = codes("", fm);
			expect(cs.filter((c) => c === "V019")).toHaveLength(2);
		});

		it("no V019 for acyclic revises chain", () => {
			const fm: Frontmatter = {
				artifact: { v3: { revises: "v2" }, v2: { revises: "v1" }, v1: {} },
			};
			expect(codes("", fm)).not.toContain("V019");
		});
	});

	describe("V016: revises non-string value", () => {
		it("errors when revises is a non-string type from YAML", () => {
			const fm = {
				artifact: { v2: { revises: 42 } },
			} as unknown as Frontmatter;
			expect(codes("v2 >> P -> B", fm)).toContain("V016");
		});
	});

	describe("V023: subflow on artifact", () => {
		it("errors when subflow key is set on an artifact", () => {
			const fm = {
				artifact: { A: { subflow: "./child.pfdsl" } },
			} as unknown as Frontmatter;
			expect(codes("A >> P -> B", fm)).toContain("V023");
		});

		it("V023 severity is error", () => {
			const fm = {
				artifact: { A: { subflow: "./child.pfdsl" } },
			} as unknown as Frontmatter;
			const diags = diagnose("A >> P -> B", fm);
			const v023 = diags.find((d) => d.code === "V023");
			expect(v023?.severity).toBe("error");
		});

		it("no V023 when subflow is on a process (not artifact)", () => {
			const fm = {
				process: { P: { subflow: "./child.pfdsl" } },
			} as unknown as Frontmatter;
			expect(codes("A >> P -> B", fm)).not.toContain("V023");
		});
	});

	describe("V024: boundary without subflow", () => {
		it("errors when boundary is set on a process without subflow", () => {
			const fm = {
				process: { P: { boundary: { order: "incoming_order" } } },
			} as unknown as Frontmatter;
			expect(codes("A >> P -> B", fm)).toContain("V024");
		});

		it("V024 severity is error", () => {
			const fm = {
				process: { P: { boundary: { order: "incoming_order" } } },
			} as unknown as Frontmatter;
			const diags = diagnose("A >> P -> B", fm);
			const v024 = diags.find((d) => d.code === "V024");
			expect(v024?.severity).toBe("error");
		});

		it("no V024 when process has both boundary and subflow", () => {
			const fm = {
				process: {
					P: {
						subflow: "./child.pfdsl",
						boundary: { order: "incoming_order" },
					},
				},
			} as unknown as Frontmatter;
			expect(codes("A >> P -> B", fm)).not.toContain("V024");
		});

		it("no V024 when process has subflow but no boundary", () => {
			const fm = {
				process: { P: { subflow: "./child.pfdsl" } },
			} as unknown as Frontmatter;
			expect(codes("A >> P -> B", fm)).not.toContain("V024");
		});
	});

	describe("W003: status non-monotonicity (output done while input not done)", () => {
		it("warns when output artifact is done but input artifact is not done", () => {
			const fm: Frontmatter = {
				artifact: {
					inp: { status: "wip", criteria: "x" },
					out: { status: "done", criteria: "y" },
				},
			};
			expect(codes("inp >> P -> out", fm)).toContain("W003");
		});

		it("warns when output artifact is done but input artifact is todo", () => {
			const fm: Frontmatter = {
				artifact: {
					inp: { status: "todo", criteria: "x" },
					out: { status: "done", criteria: "y" },
				},
			};
			expect(codes("inp >> P -> out", fm)).toContain("W003");
		});

		it("warns when output artifact is done but input artifact is blocked", () => {
			const fm: Frontmatter = {
				artifact: {
					inp: { status: "blocked", criteria: "x" },
					out: { status: "done", criteria: "y" },
				},
			};
			expect(codes("inp >> P -> out", fm)).toContain("W003");
		});

		it("does not warn when all inputs and output are done", () => {
			const fm: Frontmatter = {
				artifact: {
					inp: { status: "done", criteria: "x" },
					out: { status: "done", criteria: "y" },
				},
			};
			expect(codes("inp >> P -> out", fm)).not.toContain("W003");
		});

		it("does not warn when output is not done", () => {
			const fm: Frontmatter = {
				artifact: {
					inp: { status: "todo", criteria: "x" },
					out: { status: "wip", criteria: "y" },
				},
			};
			expect(codes("inp >> P -> out", fm)).not.toContain("W003");
		});

		it("does not warn for feedback edges even if artifact is not done", () => {
			const fm: Frontmatter = {
				artifact: {
					inp: { status: "done", criteria: "a" },
					out: { status: "done", criteria: "b" },
					fb: { status: "wip", criteria: "c" },
				},
			};
			// fb >>? P is feedback, should not trigger W003
			expect(codes("inp >> P -> out\nfb >>? P", fm)).not.toContain("W003");
		});

		it("warns only for processes with done outputs, not all processes", () => {
			const fm: Frontmatter = {
				artifact: {
					a: { status: "done", criteria: "a" },
					b: { status: "done", criteria: "b" },
					c: { status: "wip", criteria: "c" },
					d: { status: "todo", criteria: "d" },
				},
			};
			// P1: a(done) >> P1 -> b(done) — no W003
			// P2: c(wip) >> P2 -> d(todo) — no W003 (output not done)
			const cs = codes("a >> P1 -> b\nc >> P2 -> d", fm);
			expect(cs).not.toContain("W003");
		});

		it("W003 severity is warning", () => {
			const fm: Frontmatter = {
				artifact: {
					inp: { status: "wip", criteria: "x" },
					out: { status: "done", criteria: "y" },
				},
			};
			const diags = diagnose("inp >> P -> out", fm);
			const w003 = diags.find((d) => d.code === "W003");
			expect(w003?.severity).toBe("warning");
		});

		it("warns when one of multiple inputs is not done while output is done", () => {
			const fm: Frontmatter = {
				artifact: {
					a: { status: "done", criteria: "a" },
					b: { status: "todo", criteria: "b" },
					out: { status: "done", criteria: "out" },
				},
			};
			expect(codes("[a, b] >> P -> out", fm)).toContain("W003");
		});

		it("does not warn when artifact has no status declared", () => {
			// Undeclared status means status is undefined — not 'done', so input check skips
			// Also output without declared 'done' status won't trigger
			const fm: Frontmatter = {
				artifact: {
					inp: { criteria: "x" },
					out: { status: "done", criteria: "y" },
				},
			};
			// inp has no status (undefined) — should not count as non-done for this warning
			// because we can't know the intended status
			expect(codes("inp >> P -> out", fm)).not.toContain("W003");
		});
	});

	describe("V020: orphaned process (frontmatter-declared, no edges)", () => {
		it("errors when a frontmatter process has no edges", () => {
			const fm: Frontmatter = { process: { orphan: {} } };
			expect(codes("", fm)).toContain("V020");
		});

		it("V020 severity is error", () => {
			const fm: Frontmatter = { process: { orphan: {} } };
			const diags = diagnose("", fm);
			const v020 = diags.find((d) => d.code === "V020");
			expect(v020?.severity).toBe("error");
		});

		it("no V020 when process participates in edges", () => {
			const fm: Frontmatter = { process: { P: {} } };
			expect(codes("A >> P -> B", fm)).not.toContain("V020");
		});

		it("no V020 for valid graph with no frontmatter process declarations", () => {
			expect(codes("A >> P -> B")).not.toContain("V020");
		});

		it("no V020 when process has only input edges (V003 fires instead)", () => {
			const fm: Frontmatter = { process: { P: {} } };
			expect(codes("A >> P", fm)).not.toContain("V020");
		});

		it("no V020 when process has only output edges (V002 fires instead)", () => {
			const fm: Frontmatter = { process: { P: {} } };
			expect(codes("P -> B", fm)).not.toContain("V020");
		});
	});
});
