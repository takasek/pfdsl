import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	format,
	normalizeDocument,
	parse,
	resolveMeta,
	validateGraph,
} from "./index.js";
import { lex } from "./lexer.js";
import { parseTokens } from "./parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(__dirname, "../../../.pfdsl/roadmap.pfdsl");
const sampleSource = readFileSync(samplePath, "utf-8");

describe("public API", () => {
	it("parse: parses the sample .pfdsl file without syntax errors", () => {
		const result = parse(sampleSource);
		const errors = result.diagnostics.filter((d) => d.severity === "error");
		expect(errors).toHaveLength(0);
		expect(result.document.statements.length).toBeGreaterThan(0);
		expect(result.frontmatter).not.toBeNull();
	});

	it("normalizeDocument: produces edges without type errors", () => {
		const { document, frontmatter } = parse(sampleSource);
		const { edges, diagnostics } = normalizeDocument(document, frontmatter);
		const errors = diagnostics.filter((d) => d.severity === "error");
		expect(errors).toHaveLength(0);
		expect(edges.length).toBeGreaterThan(0);
	});

	it("validateGraph: sample file passes validation", () => {
		const { document, frontmatter } = parse(sampleSource);
		const { edges, nodeKinds } = normalizeDocument(document, frontmatter);
		const diags = validateGraph(edges, nodeKinds, frontmatter);
		const errors = diags.filter((d) => d.severity === "error");
		expect(errors).toHaveLength(0);
	});

	it("format: matches golden canonical output for sample file (locks spec §14 ordering)", () => {
		const { output, diagnostics } = format(sampleSource);
		const errors = diagnostics.filter((d) => d.severity === "error");
		expect(errors).toHaveLength(0);
		expect(output).toMatchSnapshot();
	});

	it("format is idempotent (format of format = format)", () => {
		const { output: first } = format(sampleSource);
		const { output: second } = format(first);
		expect(second).toBe(first);
	});

	it("format: preserves comment lines in place", () => {
		const src = "# section A\nA >> P\nP -> B\n";
		const { output } = format(src, { style: "flows" });
		expect(output).toBe("# section A\nA >> P -> B\n");
	});

	it("format: preserves comment between two edge blocks", () => {
		const src = "A >> P\nP -> B\n# separator\nX >> Q\nQ -> Y\n";
		const { output } = format(src, { style: "flows" });
		expect(output).toBe("A >> P -> B\n# separator\nX >> Q -> Y\n");
	});

	it("format: preserves trailing comment", () => {
		const src = "A >> P\nP -> B\n# end\n";
		const { output } = format(src, { style: "flat" });
		expect(output).toBe("A >> P\nP -> B\n# end\n");
	});

	it("format: comment-only body passes through unchanged", () => {
		const src = "# just a comment\n";
		const { output } = format(src);
		expect(output).toBe("# just a comment\n");
	});

	describe("parse() immutability", () => {
		it("does not mutate token positions: re-parse returns identical line numbers", () => {
			const src = "---\nartifact:\n  a: {}\n---\na >> P -> b\n";
			const r1 = parse(src);
			const r2 = parse(src);
			expect(r1.document.statements[0]?.start.line).toBe(
				r2.document.statements[0]?.start.line,
			);
		});

		it("does not mutate the token array passed from lex: token.start.line is unchanged after parse", () => {
			const body = "a >> P -> b\n";
			const { tokens } = lex(body);
			const lineBeforeParse = tokens[0]?.start.line ?? -1;
			parseTokens(tokens);
			expect(tokens[0]?.start.line).toBe(lineBeforeParse);
		});
	});

	describe("resolveMeta", () => {
		const fm = {
			artifact: { art1: { label: "Artifact 1" } },
			process: { proc1: { label: "Process 1" } },
		};

		it("returns artifact meta when kind is 'artifact'", () => {
			expect(resolveMeta(fm, "artifact", "art1")).toEqual({
				label: "Artifact 1",
			});
		});

		it("returns process meta when kind is 'process'", () => {
			expect(resolveMeta(fm, "process", "proc1")).toEqual({
				label: "Process 1",
			});
		});

		it("returns undefined for unknown id", () => {
			expect(resolveMeta(fm, "artifact", "unknown")).toBeUndefined();
		});

		it("returns undefined when fm is null", () => {
			expect(resolveMeta(null, "artifact", "art1")).toBeUndefined();
		});
	});
});
