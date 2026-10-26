import { analyzeSource } from "@pfdsl/core";
import { expect, it } from "vitest";
import { applyPreviewEdit } from "./preview-edit.js";

const source =
	"---\nartifact:\n  a: {label: Input, parts: [b]}\n  b: {revises: a}\nprocess:\n  p: {label: Build}\n---\na >> p -> b\na >>? p\n";

it("renames an artifact and its local references together with its display label", () => {
	const result = applyPreviewEdit(source, {
		type: "renameNode",
		source,
		nodeId: "a",
		newId: "input",
		label: "New: input #1",
	});
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	const model = analyzeSource(result.source);
	expect(model.nodeKinds.has("a")).toBe(false);
	expect(model.frontmatter?.artifact?.input?.label).toBe("New: input #1");
	expect(model.frontmatter?.artifact?.b?.revises).toBe("input");
	expect(model.edges.filter((e) => e.artifact === "input")).toHaveLength(2);
	expect(
		source.slice(0, result.edit.startOffset) +
			result.edit.text +
			source.slice(result.edit.endOffset),
	).toBe(result.source);
});

it("creates a label definition for a body-only process and permits label-only edits", () => {
	const source = "a >> p -> b\n";
	const result = applyPreviewEdit(source, {
		type: "renameNode",
		source,
		nodeId: "p",
		newId: "p",
		label: "Build",
	});
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(analyzeSource(result.source).frontmatter?.process?.p?.label).toBe(
		"Build",
	);
	expect(result.source.endsWith(source)).toBe(true);
});

it.each([
	"",
	"b",
	"invalid\nID",
])("refuses invalid or occupied ID %j atomically", (newId) => {
	expect(
		applyPreviewEdit(source, {
			type: "renameNode",
			source,
			nodeId: "a",
			newId,
			label: "Changed",
		}).ok,
	).toBe(false);
});

it("refuses a stale rename snapshot", () => {
	expect(
		applyPreviewEdit(`${source}c\n`, {
			type: "renameNode",
			source,
			nodeId: "a",
			newId: "new",
			label: "Changed",
		}).ok,
	).toBe(false);
});

it("preserves CRLF and comments while clearing a display label", () => {
	const source =
		"---\r\nprocess:\r\n  p: {label: Build} # keep\r\n---\r\na >> p -> b\r\n";
	const result = applyPreviewEdit(source, {
		type: "renameNode",
		source,
		nodeId: "p",
		newId: "build",
		label: "",
	});
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.source).toContain("# keep\r\n");
	expect(result.source.replaceAll("\r\n", "")).not.toContain("\n");
	expect(analyzeSource(result.source).frontmatter?.process?.build?.label).toBe(
		"",
	);
});

it("quotes IDs containing spaces and preserves child boundary IDs", () => {
	const source =
		"---\nprocess:\n  p:\n    subflow: child.pfdsl\n---\na >> p -> b\n";
	const result = applyPreviewEdit(source, {
		type: "renameNode",
		source,
		nodeId: "a",
		newId: "my input",
		label: "",
	});
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	const model = analyzeSource(result.source);
	expect(model.edges[0]?.artifact).toBe("my input");
	expect(model.frontmatter?.process?.p?.boundary).toEqual({ "my input": "a" });
});

it.each(["new", "a"])("refuses shared YAML even when the ID is %s", (newId) => {
	const source =
		"---\nartifact:\n  a: &shared {label: Input}\n  b: *shared\n---\na >> p -> b\n";
	expect(
		applyPreviewEdit(source, {
			type: "renameNode",
			source,
			nodeId: "a",
			newId,
			label: "Changed",
		}),
	).toEqual({ ok: false, message: expect.stringContaining("unsupportedYaml") });
});

it("allows label edits with extends but refuses ID changes without preset resolution", () => {
	const source =
		"---\nextends: preset.yaml\nprocess:\n  p: {label: Build}\n---\na >> p -> b\n";
	expect(
		applyPreviewEdit(source, {
			type: "renameNode",
			source,
			nodeId: "p",
			newId: "p",
			label: "Changed",
		}).ok,
	).toBe(true);
	expect(
		applyPreviewEdit(source, {
			type: "renameNode",
			source,
			nodeId: "p",
			newId: "build",
			label: "Changed",
		}),
	).toEqual({ ok: false, message: expect.stringContaining("extends") });
});
