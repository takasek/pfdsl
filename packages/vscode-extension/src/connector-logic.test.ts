import { describe, expect, it } from "vitest";
import {
	buildConnectorEdgeLine,
	connectorKindsFor,
	insertConnectorEdge,
} from "./connector-logic.js";

describe("connectorKindsFor", () => {
	it("offers input and feedback connectors for 'before'", () => {
		expect(connectorKindsFor("before")).toEqual([">>", ">>?"]);
	});

	it("offers only the output connector for 'after'", () => {
		expect(connectorKindsFor("after")).toEqual(["->"]);
	});
});

describe("buildConnectorEdgeLine", () => {
	it("places the other node before the current node for 'before' + '>>'", () => {
		expect(buildConnectorEdgeLine("build", "before", ">>", "spec_doc")).toBe(
			"spec_doc >> build",
		);
	});

	it("uses the feedback connector for 'before' + '>>?'", () => {
		expect(buildConnectorEdgeLine("build", "before", ">>?", "review")).toBe(
			"review >>? build",
		);
	});

	it("places the other node after the current node for 'after' + '->'", () => {
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
