import type { NormalizedEdge } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import {
	buildConnectorEdgeLine,
	directionForKind,
	edgeAlreadyExists,
	insertConnectorEdge,
} from "./connector-logic.js";

describe("directionForKind", () => {
	it("treats input and feedback as 'before'", () => {
		expect(directionForKind(">>")).toBe("before");
		expect(directionForKind(">>?")).toBe("before");
	});

	it("treats output as 'after'", () => {
		expect(directionForKind("->")).toBe("after");
	});
});

describe("buildConnectorEdgeLine", () => {
	it("places the other node before the current node for '>>'", () => {
		expect(buildConnectorEdgeLine("build", "before", ">>", "spec_doc")).toBe(
			"spec_doc >> build",
		);
	});

	it("uses the feedback connector for '>>?'", () => {
		expect(buildConnectorEdgeLine("build", "before", ">>?", "review")).toBe(
			"review >>? build",
		);
	});

	it("places the other node after the current node for '->'", () => {
		expect(buildConnectorEdgeLine("build", "after", "->", "result")).toBe(
			"build -> result",
		);
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
});

describe("edgeAlreadyExists", () => {
	const edges: NormalizedEdge[] = [
		{ kind: "input", artifact: "spec_doc", process: "build" },
		{ kind: "feedback", artifact: "review", process: "build" },
		{ kind: "output", process: "build", artifact: "result" },
	];

	it("detects an existing input edge", () => {
		expect(edgeAlreadyExists(edges, "build", ">>", "spec_doc")).toBe(true);
	});

	it("detects an existing feedback edge", () => {
		expect(edgeAlreadyExists(edges, "build", ">>?", "review")).toBe(true);
	});

	it("detects an existing output edge", () => {
		expect(edgeAlreadyExists(edges, "build", "->", "result")).toBe(true);
	});

	it("returns false for an edge that doesn't exist", () => {
		expect(edgeAlreadyExists(edges, "build", ">>", "other")).toBe(false);
	});

	it("does not confuse input and feedback edges of the same pair", () => {
		expect(edgeAlreadyExists(edges, "build", ">>", "review")).toBe(false);
	});
});
