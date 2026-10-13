import { expect, it } from "vitest";
import {
	analyzeSnapshot,
	applyPreviewEdit,
	computeFullDocumentFormatOutput,
	findFrontmatterDefinitionInText,
	findFrontmatterDefinitionRange,
	findNodeOccurrenceRanges,
	findUndefinedNodeKind,
	nodeIdAtSourcePosition,
} from "./index.js";

it.each([
	"\n",
	"\r\n",
])("replays a definition edit into an authored snapshot and navigates its quoted ID (%j)", (eol) => {
	const id = "成果 資料";
	const token = '"成果 資料"';
	const body = `input >> task -> ${token} # keep body${eol}${token} >> next -> finish${eol}`;
	const source =
		["---", "title: 'Keep' # keep metadata", "---", ""].join(eol) + body;
	const before = analyzeSnapshot(source);
	expect(findUndefinedNodeKind(before.nodeKinds, before.frontmatter, id)).toBe(
		"artifact",
	);
	const result = applyPreviewEdit(source, {
		type: "createDefinition",
		nodeId: id,
		source,
	});
	if (!result.ok) throw new Error(result.message);
	const { startOffset, endOffset, text } = result.edit;
	const edited = source.slice(0, startOffset) + text + source.slice(endOffset);
	expect(edited).toBe(result.source);
	expect(edited).toContain("title: 'Keep' # keep metadata");
	expect(edited.endsWith(body)).toBe(true);
	const model = analyzeSnapshot(edited);
	expect(model.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	expect(model.edges).toEqual(before.edges);
	expect(
		findUndefinedNodeKind(model.nodeKinds, model.frontmatter, id),
	).toBeUndefined();
	expect(result.needsCriteria).toBe(true);
	expect(result.selection).toBeDefined();
	const selection = result.selection!;
	expect(edited.slice(selection.start.offset, selection.end.offset)).toContain(
		id,
	);
	const ranges = findNodeOccurrenceRanges(model, edited, id);
	expect(ranges).toHaveLength(3);
	expect(ranges[0]).toEqual(findFrontmatterDefinitionRange(model, id));
	for (const range of ranges) {
		expect(
			edited
				.split("\n")
				[range.start.line - 1]!.slice(
					range.start.column - 1,
					range.end.column - 1,
				),
		).toContain(id);
		expect(
			nodeIdAtSourcePosition(model, edited, {
				line: range.start.line - 1,
				character: range.start.column - 1,
			}),
		).toBe(id);
	}
	expect(findFrontmatterDefinitionInText(edited, id)).toEqual({
		line: ranges[0]!.start.line - 1,
		column: ranges[0]!.start.column - 1,
	});
});

it.each([
	"\n",
	"\r\n",
])("replays an output connector to an existing quoted ID and retains semantics across formatting (%j)", (eol) => {
	const id = "成果 資料";
	const source = [
		'"成果 資料" >> other -> finish',
		"input >> task -> old",
		"",
	].join(eol);
	const result = applyPreviewEdit(source, {
		type: "addConnector",
		nodeId: "task",
		source,
		connector: "->",
		otherId: id,
	});
	if (!result.ok) throw new Error(result.message);
	const { startOffset, endOffset, text } = result.edit;
	const edited = source.slice(0, startOffset) + text + source.slice(endOffset);
	expect(edited).toBe(result.source);
	const model = analyzeSnapshot(edited);
	expect(model.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	expect(model.edges).toContainEqual({
		kind: "output",
		process: "task",
		artifact: id,
	});
	const ranges = findNodeOccurrenceRanges(model, edited, id);
	expect(ranges).toHaveLength(2);
	for (const range of ranges) {
		expect(
			edited
				.split("\n")
				[range.start.line - 1]!.slice(
					range.start.column - 1,
					range.end.column - 1,
				),
		).toBe('"成果 資料"');
		expect(
			nodeIdAtSourcePosition(model, edited, {
				line: range.start.line - 1,
				character: range.start.column - 1,
			}),
		).toBe(id);
	}
	for (const style of ["flows", "flat"] as const) {
		const formatted = computeFullDocumentFormatOutput(edited, style);
		expect(formatted).not.toBeNull();
		if (formatted === null) throw new Error(`Expected a ${style} format edit`);
		const formattedModel = analyzeSnapshot(formatted);
		expect(
			formattedModel.diagnostics.filter((d) => d.severity === "error"),
		).toEqual([]);
		expect(formattedModel.edges).toHaveLength(model.edges.length);
		expect(formattedModel.edges).toEqual(expect.arrayContaining(model.edges));
		expect(
			findNodeOccurrenceRanges(formattedModel, formatted, id),
		).toHaveLength(2);
	}
	expect(
		applyPreviewEdit(edited, {
			type: "addConnector",
			nodeId: "task",
			source: edited,
			connector: "->",
			otherId: id,
		}).ok,
	).toBe(false);
});

it.each([
	"10",
	"true",
])("reports FM004 and provides no edit for a non-string YAML definition key %s", (key) => {
	const source = `---\nartifact:\n  ${key}: { label: Keep }\n---\ninput >> task -> result\n`;
	expect(
		analyzeSnapshot(source).diagnostics.some((d) => d.code === "FM004"),
	).toBe(true);
	const result = applyPreviewEdit(source, {
		type: "createDefinition",
		nodeId: "result",
		source,
	});
	expect(result.ok).toBe(false);
	expect(result).not.toHaveProperty("edit");
	expect(result).not.toHaveProperty("source");
});
