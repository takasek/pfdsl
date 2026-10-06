import { expect, it } from "vitest";
import { analyzeSnapshot, prepareDocument } from "./document.js";
import {
	applyPreviewEdit,
	buildPreviewGraph,
	neighborhoodDot,
} from "./node-operations.js";

it("creates a definition through the CST, retaining authored body and selecting its label", () => {
	const source = "---\r\ntitle: 'Keep' # comment\r\n---\r\na >> p -> b\r\n";
	const result = applyPreviewEdit(source, {
		type: "createDefinition",
		nodeId: "b",
		source,
	});
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.source).toContain("title: 'Keep' # comment\r\n");
	expect(result.source.endsWith("a >> p -> b\r\n")).toBe(true);
	expect(result.selection).toBeDefined();
	expect(result.needsCriteria).toBe(true);
});

it("refuses stale, existing, unknown, and malformed definition requests", () => {
	const source = "a >> p -> b\n";
	expect(
		applyPreviewEdit(`${source}c\n`, {
			type: "createDefinition",
			nodeId: "b",
			source,
		}).ok,
	).toBe(false);
	expect(
		applyPreviewEdit(source, {
			type: "createDefinition",
			nodeId: "ghost",
			source,
		}).ok,
	).toBe(false);
	const first = applyPreviewEdit(source, {
		type: "createDefinition",
		nodeId: "b",
		source,
	});
	if (!first.ok) throw new Error("Expected initial insertion");
	expect(
		applyPreviewEdit(first.source, {
			type: "createDefinition",
			nodeId: "b",
			source: first.source,
		}).ok,
	).toBe(false);
	const broken = "---\nartifact: [\n---\na >> p\n";
	expect(
		applyPreviewEdit(broken, {
			type: "createDefinition",
			nodeId: "a",
			source: broken,
		}).ok,
	).toBe(false);
});

it.each([
	["a", "->", "q", "q -> a"],
	["a", ">>", "q", "a >> q"],
	["a", ">>?", "q", "a >>? q"],
	["p", "->", "c", "p -> c"],
	["p", ">>", "c", "c >> p"],
])("adds the semantic connector %s %s %s", (nodeId, connector, otherId, edge) => {
	const source = "a >> p -> b\n";
	const result = applyPreviewEdit(source, {
		type: "addConnector",
		nodeId,
		source,
		connector: connector as ">>" | ">>?" | "->",
		otherId,
	});
	expect(result.ok).toBe(true);
	if (result.ok) expect(result.source).toContain(edge);
});

it("rejects duplicate edges, incompatible kinds, self and invalid IDs", () => {
	const source = "a >> p -> b\n";
	for (const otherId of ["p", "a", "b", "wrong!"]) {
		expect(
			applyPreviewEdit(source, {
				type: "addConnector",
				nodeId: "a",
				source,
				connector: ">>",
				otherId,
			}).ok,
		).toBe(false);
	}
});

it.each([
	['"my input" >> p -> b\n', "my input", "q"],
	['"my result" >> q -> c\na >> p -> b\n', "p", "my result"],
])("connects existing semantic quoted IDs in %s", (source, nodeId, otherId) => {
	const result = applyPreviewEdit(source, {
		type: "addConnector",
		nodeId,
		source,
		connector: ">>",
		otherId,
	});
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	const model = analyzeSnapshot(result.source);
	expect(model.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	expect([...model.nodeKinds.keys()].sort()).toEqual(
		[...new Set([...analyzeSnapshot(source).nodeKinds.keys(), otherId])].sort(),
	);
});

it("creates a prototype-named node declared only in the body", () => {
	const source = "---\nartifact: {}\n---\nconstructor >> p -> b\n";
	const result = applyPreviewEdit(source, {
		type: "createDefinition",
		nodeId: "constructor",
		source,
	});
	expect(result.ok).toBe(true);
	if (result.ok)
		expect(
			Object.hasOwn(
				analyzeSnapshot(result.source).frontmatter!.artifact!,
				"constructor",
			),
		).toBe(true);
});

it("renders only the center's incident primary and feedback connections", () => {
	const model = analyzeSnapshot("a >> p -> b\nb >>? p\nb >> q -> c\nlonely\n");
	const data = buildPreviewGraph(model, model.frontmatter);
	const dot = neighborhoodDot(data, "p")!;
	expect(dot).toContain('"a" -> "p"');
	expect(dot).toContain('"p" -> "b"');
	expect(dot).toContain('"b" -> "p"');
	expect(dot).toContain("dashed");
	expect(dot).not.toContain('"q"');
	expect(dot).not.toContain('"c"');
	expect(neighborhoodDot(data, "lonely")).toContain('"lonely"');
	expect(neighborhoodDot(data, "missing")).toBeUndefined();
});

it("delivers a JSON-safe graph without unrelated cyclic extension metadata", () => {
	const source = `---
metadata: &self {loop: *self}
artifact:
  a: {label: Input, status: done, tags: [external], extra: *self}
process:
  p: {label: Build, tags: [external]}
tag:
  external: {style: {color: blue}}
statusStyles:
  done: {fillcolor: green}
layout: {maxWidth: 40}
---
a >> p -> b
`;
	const model = analyzeSnapshot(source);
	expect(model.diagnostics).toEqual([]);
	const { message } = prepareDocument(model, null, () => null);
	expect(message.type).toBe("render");
	expect(() => JSON.stringify(message)).not.toThrow();
	if (message.type !== "render") return;
	const data = JSON.parse(JSON.stringify(message.graph));
	expect(data.frontmatter).not.toHaveProperty("metadata");
	expect(data.frontmatter.artifact.a).not.toHaveProperty("extra");
	const dot = neighborhoodDot(data, "p")!;
	expect(dot).toContain("Input");
	expect(dot).toContain('color="blue"');
	expect(dot).toContain('fillcolor="green"');
});

it.each([
	"\n",
	"\r\n",
])("returns a local edit and insertion caret with %j line endings", (eol) => {
	const source = [
		"first >> task -> old",
		"a >> p -> b",
		"last >> finish -> end",
		"",
	].join(eol);
	const result = applyPreviewEdit(source, {
		type: "addConnector",
		source,
		nodeId: "p",
		connector: "->",
		otherId: "new_result",
	});
	if (!result.ok) throw new Error(result.message);
	expect(result.edit).toBeDefined();
	const { startOffset, endOffset, text } = result.edit;
	expect(source.slice(0, startOffset) + text + source.slice(endOffset)).toBe(
		result.source,
	);
	expect(startOffset).toBeGreaterThan(source.indexOf("a >> p"));
	expect(endOffset).toBeLessThanOrEqual(source.indexOf("last >>"));
	expect(text).toContain("p -> new_result");
	expect(result.selection?.start.line).toBe(3);
	expect(result.selection?.start.column).toBe("p -> new_result".length + 1);
});

it.each([
	"a >> p",
	"a >> p\r\n",
	"---\nprocess: {p: {label: P}}\n---\n",
])("describes an exact edit for EOF and definition-only insertion: %j", (source) => {
	const result = applyPreviewEdit(source, {
		type: "addConnector",
		source,
		nodeId: "p",
		connector: "->",
		otherId: "new_result",
	});
	if (!result.ok) throw new Error(result.message);
	expect(result.edit).toBeDefined();
	const { startOffset, endOffset, text } = result.edit;
	expect(source.slice(0, startOffset) + text + source.slice(endOffset)).toBe(
		result.source,
	);
	expect(result.selection).toBeDefined();
});
