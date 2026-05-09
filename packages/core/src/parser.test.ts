import { describe, expect, it } from "vitest";
import { lex } from "./lexer.js";
import { parseTokens } from "./parser.js";
import type {
	ChainStatement,
	FeedbackEdgeStatement,
	InputEdgeStatement,
	NodeDeclStatement,
	OutputEdgeStatement,
} from "./types/index.js";

function parse(src: string) {
	const { tokens } = lex(src);
	return parseTokens(tokens);
}

describe("parseTokens", () => {
	it("empty input → empty document", () => {
		const { document } = parse("");
		expect(document.statements).toHaveLength(0);
	});

	it("chain A >> P -> B", () => {
		const { document, diagnostics } = parse("A >> P -> B");
		expect(diagnostics).toHaveLength(0);
		expect(document.statements).toHaveLength(1);
		const stmt = document.statements[0] as ChainStatement;
		expect(stmt.type).toBe("chain");
		expect(stmt.head.ids[0]?.value).toBe("A");
		expect(stmt.segments).toHaveLength(1);
		expect(stmt.segments[0]?.op).toBe(">>");
		expect(stmt.segments[0]?.process.value).toBe("P");
		expect(stmt.segments[0]?.output.ids[0]?.value).toBe("B");
	});

	it("extended chain A >> P -> B >> Q -> C", () => {
		const { document } = parse("A >> P -> B >> Q -> C");
		const stmt = document.statements[0] as ChainStatement;
		expect(stmt.type).toBe("chain");
		expect(stmt.segments).toHaveLength(2);
		expect(stmt.segments[1]?.process.value).toBe("Q");
		expect(stmt.segments[1]?.output.ids[0]?.value).toBe("C");
	});

	it("input edge A >> P", () => {
		const { document } = parse("A >> P");
		const stmt = document.statements[0] as InputEdgeStatement;
		expect(stmt.type).toBe("input-edge");
		expect(stmt.artifact.ids[0]?.value).toBe("A");
		expect(stmt.process.value).toBe("P");
	});

	it("feedback edge A >>? P", () => {
		const { document } = parse("A >>? P");
		const stmt = document.statements[0] as FeedbackEdgeStatement;
		expect(stmt.type).toBe("feedback-edge");
		expect(stmt.artifact.ids[0]?.value).toBe("A");
		expect(stmt.process.value).toBe("P");
	});

	it("output edge P -> A", () => {
		const { document } = parse("P -> A");
		const stmt = document.statements[0] as OutputEdgeStatement;
		expect(stmt.type).toBe("output-edge");
		expect(stmt.process.value).toBe("P");
		expect(stmt.artifact.ids[0]?.value).toBe("A");
	});

	it("set notation [a, b] >> P -> [x, y]", () => {
		const { document } = parse("[a, b] >> P -> [x, y]");
		const stmt = document.statements[0] as ChainStatement;
		expect(stmt.head.ids.map((i) => i.value)).toEqual(["a", "b"]);
		expect(stmt.segments[0]?.output.ids.map((i) => i.value)).toEqual([
			"x",
			"y",
		]);
	});

	it("multiple statements separated by newline", () => {
		const { document } = parse("A >> P\nB >> Q");
		expect(document.statements).toHaveLength(2);
	});

	it("multiple statements separated by semicolon", () => {
		const { document } = parse("A >> P; B >> Q");
		expect(document.statements).toHaveLength(2);
	});

	it("syntax error: produces diagnostic and continues; second statement parses correctly", () => {
		const { document, diagnostics } = parse(">> garbage\nA >> P");
		expect(
			diagnostics.some((d) => d.severity === "error" && d.code === "P001"),
		).toBe(true);
		expect(document.statements).toHaveLength(1);
		const stmt = document.statements[0] as InputEdgeStatement;
		expect(stmt.type).toBe("input-edge");
		expect(stmt.artifact.ids[0]?.value).toBe("A");
		expect(stmt.process.value).toBe("P");
	});

	it("chain ending with bare >> process: A >> P -> B >> Q", () => {
		const { document, diagnostics } = parse("A >> P -> B >> Q");
		expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
		const stmt = document.statements[0] as ChainStatement;
		expect(stmt.type).toBe("chain");
		expect(stmt.segments).toHaveLength(2);
		expect(stmt.segments[1]?.process.value).toBe("Q");
		expect(stmt.segments[1]?.output).toBeNull();
	});

	it("chain with feedback op: A >>? P -> B", () => {
		const { document } = parse("A >>? P -> B");
		const stmt = document.statements[0] as ChainStatement;
		expect(stmt.segments[0]?.op).toBe(">>?");
	});

	describe("line continuation", () => {
		it("list end + NEWLINE + leading op = continuation", () => {
			const { document, diagnostics } = parse("[a, b]\n  >> P -> X");
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
			expect(document.statements).toHaveLength(1);
			const stmt = document.statements[0] as ChainStatement;
			expect(stmt.type).toBe("chain");
			expect(stmt.head.ids.map((i) => i.value)).toEqual(["a", "b"]);
		});

		it("single ID + NEWLINE + leading op = continuation", () => {
			const { document, diagnostics } = parse("A\n  >> P -> B");
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
			expect(document.statements).toHaveLength(1);
		});

		it("output edge with NEWLINE before ->: P\\n -> A", () => {
			const { document, diagnostics } = parse("P\n  -> A");
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
			expect(document.statements).toHaveLength(1);
			const stmt = document.statements[0] as OutputEdgeStatement;
			expect(stmt.type).toBe("output-edge");
		});

		it("chain segment break: A >> P -> B\\n  >> Q -> C", () => {
			const { document, diagnostics } = parse("A >> P -> B\n  >> Q -> C");
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
			const stmt = document.statements[0] as ChainStatement;
			expect(stmt.segments).toHaveLength(2);
		});

		it("blank line forces statement boundary: [a,b]\\n\\n>> P -> X errors", () => {
			const { diagnostics } = parse("[a, b]\n\n>> P -> X");
			expect(
				diagnostics.filter((d) => d.severity === "error").length,
			).toBeGreaterThan(0);
		});

		it("comment line between is allowed (no blank): [a,b]\\n# note\\n>> P -> X", () => {
			const { document, diagnostics } = parse("[a, b]\n# note\n  >> P -> X");
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
			expect(document.statements).toHaveLength(1);
		});

		it("trailing-line comment does not break continuation: [a,b] # note\\n>> P -> X", () => {
			const { document, diagnostics } = parse("[a, b] # note\n  >> P -> X");
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
			expect(document.statements).toHaveLength(1);
		});

		it("forbid trailing operator: A >>\\n P -> B errors", () => {
			const { diagnostics } = parse("A >>\n P -> B");
			expect(
				diagnostics.filter((d) => d.severity === "error").length,
			).toBeGreaterThan(0);
		});

		it("forbid trailing arrow: A >> P ->\\n B errors", () => {
			const { diagnostics } = parse("A >> P ->\n B");
			expect(
				diagnostics.filter((d) => d.severity === "error").length,
			).toBeGreaterThan(0);
		});

		it("forbid ID adjacent to ID without separator: A B errors", () => {
			const { diagnostics } = parse("A B");
			expect(
				diagnostics.filter((d) => d.severity === "error").length,
			).toBeGreaterThan(0);
		});

		it("semicolon separates node-decls: A; B are two valid node-decls", () => {
			const { document, diagnostics } = parse("A; B");
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
			expect(document.statements).toHaveLength(2);
			expect(document.statements[0]?.type).toBe("node-decl");
			expect(document.statements[1]?.type).toBe("node-decl");
		});

		it("blank line + comment + statement: terminator wins", () => {
			const { diagnostics } = parse("[a, b]\n\n# note\n  >> P -> X");
			expect(
				diagnostics.filter((d) => d.severity === "error").length,
			).toBeGreaterThan(0);
		});
	});

	describe("node-decl", () => {
		it("single standalone ID → node-decl", () => {
			const { document, diagnostics } = parse("A");
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
			expect(document.statements).toHaveLength(1);
			const stmt = document.statements[0] as NodeDeclStatement;
			expect(stmt.type).toBe("node-decl");
			expect(stmt.id.value).toBe("A");
		});

		it("multiple node-decls on separate lines", () => {
			const { document, diagnostics } = parse("A\nB\nC");
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
			expect(document.statements).toHaveLength(3);
			expect(document.statements.every((s) => s.type === "node-decl")).toBe(
				true,
			);
		});

		it("node-decl mixed with edges", () => {
			const { document, diagnostics } = parse("isolated\nA >> P -> B");
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
			expect(document.statements).toHaveLength(2);
			expect(document.statements[0]?.type).toBe("node-decl");
			expect(document.statements[1]?.type).toBe("chain");
		});

		it("node-decl with comment after", () => {
			const { document, diagnostics } = parse("A # comment");
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
			expect(document.statements).toHaveLength(1);
			expect(document.statements[0]?.type).toBe("node-decl");
		});

		it("quoted ID as node-decl", () => {
			const { document, diagnostics } = parse('"isolated node"');
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
			const stmt = document.statements[0] as NodeDeclStatement;
			expect(stmt.type).toBe("node-decl");
			expect(stmt.id.value).toBe("isolated node");
		});
	});
});
