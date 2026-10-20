import { analyzeSource } from "@pfdsl/core";
import { expect, it } from "vitest";
import { applyPreviewEdit } from "./preview-edit.js";

it("allows deleting one edge kind from a V036 input-feedback conflict", () => {
	const source = "a >> p -> b\na >>? p\n";
	expect(
		analyzeSource(source).diagnostics.filter((d) => d.code === "V036"),
	).toHaveLength(1);
	const result = applyPreviewEdit(source, {
		type: "deleteConnector",
		nodeId: "p",
		source,
		artifact: "a",
		process: "p",
		kind: "feedback",
	});
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.source).toContain("a >> p -> b");
	expect(analyzeSource(result.source).diagnostics).not.toContainEqual(
		expect.objectContaining({ code: "V036" }),
	);
});

it.each([
	"[a # internal\n] >> p",
	"[a, # internal\n a] >> p",
])("preserves a following statement when deleting commented input %s", (statement) => {
	const source = `${statement}; c >> q -> d\n`;
	const result = applyPreviewEdit(source, {
		type: "deleteConnector",
		nodeId: "p",
		source,
		artifact: "a",
		process: "p",
		kind: "input",
	});
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(analyzeSource(result.source).edges).toEqual(
		analyzeSource("c >> q -> d\n").edges,
	);
	expect(result.source).toContain("# internal\n");
	expect(result.source).toContain("; c >> q -> d\n");
});

it("creates only a connection to a new ID, rejecting an existing ID", () => {
	const source = "a >> p -> b\n";
	const request = {
		type: "addConnector",
		nodeId: "p",
		source,
		connector: "->",
		otherId: "new_result",
		create: true,
	} as const;
	const result = applyPreviewEdit(source, request);
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.selection).toBeDefined();
	expect(analyzeSource(result.source).frontmatter).toBeNull();
	expect(result.selection!.start).toEqual(result.selection!.end);
	expect(result.source.slice(0, result.selection!.start.offset)).toMatch(
		/p -> new_result$/,
	);
	expect(analyzeSource(result.source).edges).toContainEqual({
		kind: "output",
		process: "p",
		artifact: "new_result",
	});
	expect(
		source.slice(0, result.edit.startOffset) +
			result.edit.text +
			source.slice(result.edit.endOffset),
	).toBe(result.source);
	expect(applyPreviewEdit(source, { ...request, otherId: "b" }).ok).toBe(false);
});

it("deletes only the selected edge in a set/chain, preserving metadata, comments and both nodes", () => {
	const source =
		"---\r\nartifact:\r\n  a: {label: Keep} # metadata\r\n---\r\n[a, c] >> p -> b >> q -> d # tail\r\n# untouched\r\nx >> z -> y\r\n";
	const result = applyPreviewEdit(source, {
		type: "deleteConnector",
		nodeId: "p",
		source,
		artifact: "a",
		process: "p",
		kind: "input",
	});
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	const model = analyzeSource(result.source);
	expect(model.edges).toEqual(
		analyzeSource(source).edges.filter(
			(e) => !(e.kind === "input" && e.artifact === "a" && e.process === "p"),
		),
	);
	expect(model.nodeKinds.get("a")).toBe("artifact");
	expect(result.source).toContain("  a: {label: Keep} # metadata\r\n");
	expect(result.source).toContain("# tail\r\n# untouched\r\nx >> z -> y\r\n");
});

it("keeps undefined endpoints when their last edge is removed", () => {
	const source = "a >> p\n";
	const result = applyPreviewEdit(source, {
		type: "deleteConnector",
		nodeId: "a",
		source,
		artifact: "a",
		process: "p",
		kind: "input",
	});
	expect(result.ok).toBe(true);
	if (result.ok) {
		const model = analyzeSource(result.source);
		expect([...model.nodeKinds]).toEqual(
			expect.arrayContaining([
				["a", "artifact"],
				["p", "process"],
			]),
		);
		expect(model.edges).toEqual([]);
		expect(model.frontmatter?.artifact?.a).toEqual({});
		expect(model.frontmatter?.process?.p).toEqual({});
		expect(result.source).not.toContain("label:");
	}
});

it("toggles only input/feedback without reversing direction and refuses a newly introduced cycle", () => {
	const source = "a >> p -> b\nb >>? p\n";
	const request = {
		type: "toggleFeedback",
		nodeId: "b",
		source,
		artifact: "b",
		process: "p",
		kind: "feedback",
	} as const;
	expect(applyPreviewEdit(source, request).ok).toBe(false);
	expect(
		applyPreviewEdit(source, {
			...request,
			nodeId: "p",
			artifact: "a",
			kind: "input",
		}).ok,
	).toBe(true);
	expect(applyPreviewEdit(source, { ...request, kind: "output" }).ok).toBe(
		false,
	);
	expect(applyPreviewEdit(`${source}c\n`, request).ok).toBe(false);
});

it("refuses only a new primary cycle while allowing an unrelated edit in an already invalid graph", () => {
	const source = "a >> p -> b\nc >> q -> d\n";
	expect(
		applyPreviewEdit(source, {
			type: "addConnector",
			nodeId: "p",
			otherId: "b",
			source,
			connector: ">>",
		}).ok,
	).toBe(false);
	const invalid = `${source}b >> p\n`;
	expect(
		applyPreviewEdit(invalid, {
			type: "addConnector",
			nodeId: "q",
			otherId: "new_result",
			source: invalid,
			connector: "->",
			create: true,
		}).ok,
	).toBe(true);
});

it.each([
	"a >> p -> b >> q -> c",
	'[a, "hash# input"] >> p -> [b, c] # tail\n# between\na >> p',
	"a >> p; a >> p -> b",
	"a >> p\n  -> b\n  >> q -> c",
	"---\nartifact:\n  a:\n    label: >\n      Keep the label.\n---\na >> p -> b",
])("retains other semantic edges and all nodes while removing repeated a→p from %s", (source) => {
	const before = analyzeSource(source);
	const result = applyPreviewEdit(source, {
		type: "deleteConnector",
		nodeId: "a",
		source,
		artifact: "a",
		process: "p",
		kind: "input",
	});
	if (!result.ok) throw new Error(result.message);
	const model = analyzeSource(result.source);
	expect(model.edges).toEqual(
		before.edges.filter(
			(e) => !(e.kind === "input" && e.artifact === "a" && e.process === "p"),
		),
	);
	for (const [id, kind] of before.nodeKinds)
		expect(model.nodeKinds.get(id)).toBe(kind);
	expect(
		model.diagnostics.filter(
			(d) => /^(FM|L|P|N)\d+$/.test(d.code) && d.severity === "error",
		),
	).toEqual([]);
	expect(
		source.slice(0, result.edit.startOffset) +
			result.edit.text +
			source.slice(result.edit.endOffset),
	).toBe(result.source);
});
