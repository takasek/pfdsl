import { analyze, analyzeSource, type NodeKind } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import {
	findDefinitionEditTarget,
	findUndefinedNodeKind,
} from "./def-insertion-logic.js";

function analyzeFor(src: string): {
	nodeKinds: Map<string, NodeKind>;
	frontmatter: ReturnType<typeof analyze>["frontmatter"];
} {
	const { nodeKinds, frontmatter } = analyze(src);
	return { nodeKinds, frontmatter };
}

describe("findUndefinedNodeKind", () => {
	it("returns the kind for a node that only appears in edges", () => {
		const src = `---
artifact:
  a:
    label: A
---
a >> p -> b
`;
		const { nodeKinds, frontmatter } = analyzeFor(src);
		expect(findUndefinedNodeKind(nodeKinds, frontmatter, "p")).toBe("process");
		expect(findUndefinedNodeKind(nodeKinds, frontmatter, "b")).toBe("artifact");
	});

	it("returns undefined for a node that already has a frontmatter definition", () => {
		const src = `---
artifact:
  a:
    label: A
---
a >> p -> b
`;
		const { nodeKinds, frontmatter } = analyzeFor(src);
		expect(findUndefinedNodeKind(nodeKinds, frontmatter, "a")).toBeUndefined();
	});

	it("returns undefined for an id that isn't a node at all", () => {
		const src = `---
artifact:
  a:
    label: A
---
a >> p -> b
`;
		const { nodeKinds, frontmatter } = analyzeFor(src);
		expect(
			findUndefinedNodeKind(nodeKinds, frontmatter, "nope"),
		).toBeUndefined();
	});
});

describe("findDefinitionEditTarget", () => {
	it.each([
		"\n",
		"\r\n",
	])("selects only the authored label value in quoted flow YAML with %j newlines", (newline) => {
		const source = [
			"---",
			'"artifact": {"out": {"label": "Output: review", owner: reviewer}}',
			'"process": {"build": {"label": \'Build\'}}',
			"---",
			"input >> build -> out",
			"",
		].join(newline);
		const model = analyzeSource(source);
		const artifact = findDefinitionEditTarget(model, "artifact", "out")!;
		const process = findDefinitionEditTarget(model, "process", "build")!;
		for (const [target, value, line] of [
			[artifact, "Output: review", 2],
			[process, "Build", 3],
		] as const) {
			const range = target.labelRange;
			expect(source.slice(range.start.offset, range.end.offset)).toBe(value);
			expect(range.start.line).toBe(line);
			expect(range.end.line).toBe(line);
			expect(
				source
					.split(newline)
					[line - 1]?.slice(range.start.column - 1, range.end.column - 1),
			).toBe(value);
		}
		expect(artifact.needsCriteria).toBe(true);
		expect(process.needsCriteria).toBe(false);
	});

	it("matches the section and ID rather than a neighboring label or diagnostic", () => {
		const model = analyzeSource(
			"---\nartifact: {input: {label: Input}, out: {label: Output}}\nprocess: {build: {label: Build}}\n---\ninput >> build -> out\n",
		);
		expect(
			findDefinitionEditTarget(model, "artifact", "input")?.needsCriteria,
		).toBe(false);
		expect(
			findDefinitionEditTarget(model, "process", "build")?.needsCriteria,
		).toBe(false);
		expect(
			findDefinitionEditTarget(model, "artifact", "build"),
		).toBeUndefined();
		expect(findDefinitionEditTarget(model, "process", "out")).toBeUndefined();
		expect(
			findDefinitionEditTarget(model, "artifact", "absent"),
		).toBeUndefined();
	});

	it("only offers criteria guidance when that produced artifact has W002", () => {
		const source =
			"---\nartifact: {out: {label: Output, criteria: Reviewed}}\n---\ninput >> build -> out\n";
		const model = analyzeSource(source);
		expect(
			findDefinitionEditTarget(model, "artifact", "out")?.needsCriteria,
		).toBe(false);
		const withoutWarning = analyzeSource(
			source.replace(", criteria: Reviewed", ""),
		);
		withoutWarning.diagnostics = withoutWarning.diagnostics.filter(
			(d) => d.code !== "W002",
		);
		expect(
			findDefinitionEditTarget(withoutWarning, "artifact", "out")
				?.needsCriteria,
		).toBe(false);
	});

	it("returns no destination when the definition or its string label is gone", () => {
		for (const source of [
			"input >> build -> out\n",
			"---\nartifact: {out: {description: Output}}\n---\ninput >> build -> out\n",
			"---\nartifact: {out: {label: [}}\n---\ninput >> build -> out\n",
		]) {
			expect(
				findDefinitionEditTarget(analyzeSource(source), "artifact", "out"),
			).toBeUndefined();
		}
	});
});
