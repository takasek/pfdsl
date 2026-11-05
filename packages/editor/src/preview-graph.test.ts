import { expect, it } from "vitest";
import { analyzeSnapshot, prepareDocument } from "./document.js";
import { buildPreviewGraph, neighborhoodDot } from "./preview-graph.js";

it("retains explicit artifact targets across the preview projection", () => {
	const model = analyzeSnapshot(
		"---\nbaseRef: {source: repo, revision: main}\nartifact: {a: {location: plan.md, ref: {source: repo, revision: develop}}}\n---\na >> p -> b\n",
	);
	const projected = buildPreviewGraph(model, model.frontmatter).frontmatter;
	expect(projected?.baseRef).toEqual({ source: "repo", revision: "main" });
	expect(projected?.artifact?.a?.ref).toEqual({
		source: "repo",
		revision: "develop",
	});
});

it("does not transport cyclic additional reference members", () => {
	const model = analyzeSnapshot(
		"---\nbaseRef: &target {source: repo, revision: main, extra: *target}\nartifact: {a: {ref: *target}}\n---\na >> p -> b\n",
	);
	const projected = buildPreviewGraph(model, model.frontmatter).frontmatter;
	expect(() => JSON.stringify(projected)).not.toThrow();
	expect(projected?.baseRef).toEqual({ source: "repo", revision: "main" });
	expect(projected?.artifact?.a?.ref).toEqual({
		source: "repo",
		revision: "main",
	});
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
