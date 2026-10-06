import { analyzeSource, type NormalizedEdge } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import {
	buildConnectorEdgeLine,
	edgeAlreadyExists,
	insertConnectorEdge,
	validateNewNodeId,
} from "./connector-logic.js";

describe("buildConnectorEdgeLine", () => {
	it.each([
		["my input", "artifact", ">>", "q", '"my input" >> q'],
		["p", "process", ">>", "my result", '"my result" >> p'],
		[
			"my process",
			"process",
			">>?",
			'my "input"\\draft',
			'"my \\"input\\"\\\\draft" >>? "my process"',
		],
		[
			"my input",
			"artifact",
			">>?",
			"my process",
			'"my input" >>? "my process"',
		],
		["my process", "process", "->", "my result", '"my process" -> "my result"'],
		[
			"my result",
			"artifact",
			"->",
			"my process",
			'"my process" -> "my result"',
		],
	] as const)("serializes semantic IDs for %s (%s %s %s)", (nodeId, role, connector, otherId, expected) => {
		const line = buildConnectorEdgeLine(nodeId, role, connector, otherId);
		expect(line).toBe(expected);
		const model = analyzeSource(`${line}\n`);
		expect(model.edges).toEqual([
			{
				kind:
					connector === "->"
						? "output"
						: connector === ">>?"
							? "feedback"
							: "input",
				artifact: role === "artifact" ? nodeId : otherId,
				process: role === "process" ? nodeId : otherId,
			},
		]);
	});
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
	it.each([
		'x"y',
		"x\\y",
		"x\ny",
	])("anchors escaped quoted ID %j at its authored statement", (id) => {
		const source = `a >> ${JSON.stringify(id)} -> b\nc >> q -> d\n\n\n`;
		const edge = buildConnectorEdgeLine(id, "process", "->", "extra");
		const result = insertConnectorEdge(source, edge, id, 0);
		expect(result.anchored).toBe(true);
		expect(result.insertedLine).toBe(1);
		expect(result.text).toBe(
			`a >> ${JSON.stringify(id)} -> b\n${edge}\nc >> q -> d\n\n\n`,
		);
	});
	it("does not anchor at comments or a substring inside another quoted ID", () => {
		const source = 'a >> build -> b\nc >> "my build" -> d # build\n';
		const result = insertConnectorEdge(source, "build -> extra", "build");
		expect(result.insertedLine).toBe(1);
		expect(result.text).toBe(
			'a >> build -> b\nbuild -> extra\nc >> "my build" -> d # build\n',
		);
	});
	it("uses CRLF for an anchored line while preserving authored comments and blank lines", () => {
		const source = "a >> p -> b\r\n# keep this comment\r\n\r\n";
		expect(insertConnectorEdge(source, "c >> p", "p")).toEqual({
			text: "a >> p -> b\r\nc >> p\r\n# keep this comment\r\n\r\n",
			insertedLine: 1,
			anchored: true,
		});
	});

	it("uses CRLF for a fallback append and retains the existing blank-line trimming", () => {
		expect(insertConnectorEdge("a >> p -> b\r\n\r\n", "c >> q", "q")).toEqual({
			text: "a >> p -> b\r\nc >> q\r\n",
			insertedLine: 1,
			anchored: false,
		});
	});

	it.each([
		"\n",
		"\r\n",
	])("preserves an unterminated final line when anchoring with %j", (newline) => {
		const source = `# keep this comment${newline}a >> p -> b`;
		expect(insertConnectorEdge(source, "c >> p", "p").text).toBe(
			`${source}${newline}c >> p`,
		);
	});
	it("appends the edge line after the last non-blank line", () => {
		const source = "A >> P -> B\n";
		const { text, insertedLine, anchored } = insertConnectorEdge(
			source,
			"C >> P",
		);
		expect(text).toBe("A >> P -> B\nC >> P\n");
		expect(insertedLine).toBe(1);
		expect(anchored).toBe(false);
	});

	it("reports anchored: true when inserted next to a related statement", () => {
		const source = "spec_doc >> build\n";
		const { anchored } = insertConnectorEdge(
			source,
			"build -> result",
			"build",
		);
		expect(anchored).toBe(true);
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

// The predicate behind the connector's "New … ID" input box. It lived inline
// as a showInputBox option, where no test could reach it — the self-connection
// and kind-mismatch refusals had no coverage at all (#611).
describe("validateNewNodeId", () => {
	const base = {
		currentNodeId: "spec",
		wantedKind: "process" as const,
		kindOfExisting: () => undefined,
	};

	it("accepts an id in the DSL's id syntax", () => {
		expect(validateNewNodeId({ ...base, value: "build_v2" })).toBeUndefined();
	});

	it.each([
		"",
		"-leading-dash",
		"has space",
		"日本語?",
	])("rejects %o, which the id syntax does not allow", (value) => {
		expect(validateNewNodeId({ ...base, value })).toMatch(/Invalid ID/);
	});

	it("refuses to connect a node to itself", () => {
		expect(validateNewNodeId({ ...base, value: "spec" })).toBe(
			"Cannot connect a node to itself",
		);
	});

	it("refuses an existing id whose kind is not the one being connected", () => {
		expect(
			validateNewNodeId({
				...base,
				value: "review",
				kindOfExisting: () => "artifact",
			}),
		).toBe('"review" is already an artifact, not a process');
	});

	it("accepts an existing id that already has the wanted kind", () => {
		expect(
			validateNewNodeId({
				...base,
				value: "review",
				kindOfExisting: () => "process",
			}),
		).toBeUndefined();
	});

	it.each([
		"my result",
		'my "result"\\draft',
	])("accepts existing quoted semantic ID %j of the wanted kind", (value) => {
		expect(
			validateNewNodeId({
				...base,
				value,
				wantedKind: "artifact",
				kindOfExisting: () => "artifact",
			}),
		).toBeUndefined();
		expect(validateNewNodeId({ ...base, value })).toMatch(/Invalid ID/);
	});

	it("keeps self-connection and kind checks for existing quoted IDs", () => {
		expect(
			validateNewNodeId({
				...base,
				value: "my process",
				currentNodeId: "my process",
				kindOfExisting: () => "process",
			}),
		).toBe("Cannot connect a node to itself");
		expect(
			validateNewNodeId({
				...base,
				value: "my result",
				kindOfExisting: () => "artifact",
			}),
		).toBe('"my result" is already an artifact, not a process');
	});

	it("picks the article from the kind word, so 'artifact' reads 'an'", () => {
		expect(
			validateNewNodeId({
				...base,
				value: "review",
				wantedKind: "artifact",
				kindOfExisting: () => "process",
			}),
		).toBe('"review" is already a process, not an artifact');
	});
});
