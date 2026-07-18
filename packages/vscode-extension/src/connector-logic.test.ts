import type { NormalizedEdge } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import {
	buildConnectorEdgeLine,
	edgeAlreadyExists,
	insertConnectorEdge,
} from "./connector-logic.js";

describe("buildConnectorEdgeLine", () => {
	describe("when the current node is a process", () => {
		it("places the other node before it for '>>'", () => {
			expect(buildConnectorEdgeLine("build", "process", ">>", "spec_doc")).toBe(
				"spec_doc >> build",
			);
		});

		it("uses the feedback connector for '>>?'", () => {
			expect(buildConnectorEdgeLine("build", "process", ">>?", "review")).toBe(
				"review >>? build",
			);
		});

		it("places the other node after it for '->'", () => {
			expect(buildConnectorEdgeLine("build", "process", "->", "result")).toBe(
				"build -> result",
			);
		});
	});

	describe("when the current node is an artifact", () => {
		it("places it before the other node for '>>' (as normal input)", () => {
			expect(
				buildConnectorEdgeLine("spec_doc", "artifact", ">>", "build"),
			).toBe("spec_doc >> build");
		});

		it("places it before the other node for '>>?' (as feedback input)", () => {
			expect(buildConnectorEdgeLine("review", "artifact", ">>?", "build")).toBe(
				"review >>? build",
			);
		});

		it("places it after the other node for '->' (as output)", () => {
			expect(buildConnectorEdgeLine("result", "artifact", "->", "build")).toBe(
				"build -> result",
			);
		});
	});
});

describe("insertConnectorEdge", () => {
	it("appends the edge line after the last non-blank line", () => {
		const source = "A >> P -> B\n";
		const { text, insertedLine } = insertConnectorEdge(source, "C >> P");
		expect(text).toBe("A >> P -> B\nC >> P\n");
		expect(insertedLine).toBe(1);
	});

	it("trims trailing blank lines before appending", () => {
		const source = "A >> P -> B\n\n\n";
		const { text, insertedLine } = insertConnectorEdge(source, "C >> P");
		expect(text).toBe("A >> P -> B\nC >> P\n");
		expect(insertedLine).toBe(1);
	});

	it("handles an empty document", () => {
		const { text, insertedLine } = insertConnectorEdge("", "A >> P");
		expect(text).toBe("A >> P\n");
		expect(insertedLine).toBe(0);
	});

	it("appends after frontmatter + body content", () => {
		const source = "---\nartifact:\n  A: {}\n---\nA >> P\n";
		const { text, insertedLine } = insertConnectorEdge(source, "A -> B");
		expect(text).toBe("---\nartifact:\n  A: {}\n---\nA >> P\nA -> B\n");
		expect(insertedLine).toBe(5);
	});

	it("anchors after the last body line mentioning nodeId when no cursor line is given", () => {
		const source = [
			"---",
			"artifact:",
			"  spec_doc: {}",
			"process:",
			"  build: {}",
			"---",
			"spec_doc >> build",
			"other >> unrelated",
			"",
		].join("\n");
		const { text, insertedLine } = insertConnectorEdge(
			source,
			"build -> result",
			"build",
		);
		const lines = text.split("\n");
		expect(lines[insertedLine]).toBe("build -> result");
		expect(lines[insertedLine - 1]).toBe("spec_doc >> build");
		expect(lines[insertedLine + 1]).toBe("other >> unrelated");
	});

	it("anchors after a multi-line continuation block", () => {
		const source = [
			"spec_doc",
			">> build",
			"-> result",
			"other >> unrelated",
			"",
		].join("\n");
		const { text, insertedLine } = insertConnectorEdge(
			source,
			"build -> extra",
			"build",
		);
		const lines = text.split("\n");
		expect(lines[insertedLine]).toBe("build -> extra");
		expect(lines[insertedLine - 1]).toBe("-> result");
		expect(lines[insertedLine + 1]).toBe("other >> unrelated");
	});

	it("falls back to appending at the end when nodeId isn't in any body edge yet", () => {
		const source = "spec_doc >> build\n";
		const { text, insertedLine } = insertConnectorEdge(
			source,
			"review >>? build2",
			"build2",
		);
		expect(text).toBe("spec_doc >> build\nreview >>? build2\n");
		expect(insertedLine).toBe(1);
	});

	it("does not match a node ID that is only a substring of another ID", () => {
		const source = "spec_doc >> build_extended\n";
		const { text, insertedLine } = insertConnectorEdge(
			source,
			"x >> build",
			"build",
		);
		expect(text).toBe("spec_doc >> build_extended\nx >> build\n");
		expect(insertedLine).toBe(1);
	});

	it("matches nodeId directly followed by '->' with no space", () => {
		const source = "spec_doc >> build->result\n";
		const { text, insertedLine } = insertConnectorEdge(
			source,
			"x >> build",
			"build",
		);
		const lines = text.split("\n");
		expect(lines[insertedLine]).toBe("x >> build");
		expect(lines[insertedLine - 1]).toBe("spec_doc >> build->result");
	});

	it("anchors at the occurrence nearest the cursor line, not always the last one", () => {
		const source = [
			"build >> early_step",
			"unrelated >> other",
			"unrelated2 >> other2",
			"late_step >> build",
			"",
		].join("\n");
		const { text, insertedLine } = insertConnectorEdge(
			source,
			"build -> extra",
			"build",
			0,
		);
		const lines = text.split("\n");
		expect(lines[insertedLine]).toBe("build -> extra");
		expect(lines[insertedLine - 1]).toBe("build >> early_step");
	});
});

describe("edgeAlreadyExists", () => {
	const edges: NormalizedEdge[] = [
		{ kind: "input", artifact: "spec_doc", process: "build" },
		{ kind: "feedback", artifact: "review", process: "build" },
		{ kind: "output", process: "build", artifact: "result" },
	];

	it("detects an existing input edge from the process side", () => {
		expect(edgeAlreadyExists(edges, "build", "process", ">>", "spec_doc")).toBe(
			true,
		);
	});

	it("detects the same input edge from the artifact side", () => {
		expect(
			edgeAlreadyExists(edges, "spec_doc", "artifact", ">>", "build"),
		).toBe(true);
	});

	it("detects an existing feedback edge", () => {
		expect(edgeAlreadyExists(edges, "build", "process", ">>?", "review")).toBe(
			true,
		);
	});

	it("detects an existing output edge from either side", () => {
		expect(edgeAlreadyExists(edges, "build", "process", "->", "result")).toBe(
			true,
		);
		expect(edgeAlreadyExists(edges, "result", "artifact", "->", "build")).toBe(
			true,
		);
	});

	it("returns false for an edge that doesn't exist", () => {
		expect(edgeAlreadyExists(edges, "build", "process", ">>", "other")).toBe(
			false,
		);
	});

	it("does not confuse input and feedback edges of the same pair", () => {
		expect(edgeAlreadyExists(edges, "build", "process", ">>", "review")).toBe(
			false,
		);
	});
});
