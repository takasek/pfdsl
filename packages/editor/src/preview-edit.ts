import {
	analyzeSource,
	insertDefinition,
	loadFrontmatter,
	type Range,
} from "@pfdsl/core";
import {
	buildConnectorEdgeLine,
	type ConnectorKind,
	compatibleOtherKind,
	edgeAlreadyExists,
	insertConnectorEdge,
	validateNewNodeId,
} from "./connector-logic.js";
import {
	findDefinitionEditTarget,
	findUndefinedNodeKind,
} from "./def-insertion-logic.js";

export type PreviewEditRequest =
	| { type: "createDefinition"; nodeId: string; source: string }
	| {
			type: "addConnector";
			nodeId: string;
			source: string;
			connector: ConnectorKind;
			otherId: string;
	  };

export type PreviewEditResult =
	| { ok: false; message: string }
	| {
			ok: true;
			source: string;
			edit: { startOffset: number; endOffset: number; text: string };
			selection?: Range | undefined;
			needsCriteria?: boolean | undefined;
	  };

/** One contiguous edit, retaining the common prefix/suffix and whole CRLF pairs. */
function sourceEdit(before: string, after: string) {
	let startOffset = 0;
	while (
		startOffset < before.length &&
		startOffset < after.length &&
		before[startOffset] === after[startOffset]
	)
		startOffset++;
	let endOffset = before.length;
	let afterEnd = after.length;
	while (
		endOffset > startOffset &&
		afterEnd > startOffset &&
		before[endOffset - 1] === after[afterEnd - 1]
	) {
		endOffset--;
		afterEnd--;
	}
	if (before[startOffset - 1] === "\r" && before[startOffset] === "\n")
		startOffset--;
	if (before[endOffset - 1] === "\r" && before[endOffset] === "\n") {
		endOffset++;
		afterEnd++;
	}
	return { startOffset, endOffset, text: after.slice(startOffset, afterEnd) };
}

/** A menu belongs to the exact authored source from which its candidates were calculated. */
export function applyPreviewEdit(
	source: string,
	request: PreviewEditRequest,
): PreviewEditResult {
	const fail = (message: string): PreviewEditResult => ({ ok: false, message });
	if (request.source !== source)
		return fail("The document changed. Reopen Node actions and try again.");
	const model = { ...analyzeSource(source), source };
	if (
		model.diagnostics.some(
			(d) => d.severity === "error" && /^(FM|L|P|N)\d+$/.test(d.code),
		)
	)
		return fail(
			"The document cannot be parsed safely. Fix its diagnostics first.",
		);
	const kind = model.nodeKinds.get(request.nodeId);
	if (kind !== "artifact" && kind !== "process")
		return fail("The target node no longer exists.");
	if (request.type === "createDefinition") {
		if (
			!findUndefinedNodeKind(model.nodeKinds, model.frontmatter, request.nodeId)
		)
			return fail("This node already has a definition.");
		const inserted = insertDefinition(source, kind, request.nodeId);
		if (!inserted.inserted)
			return fail("The definition could not be inserted safely.");
		const output = inserted.output + loadFrontmatter(source).body;
		const target = findDefinitionEditTarget(
			analyzeSource(output),
			kind,
			request.nodeId,
		);
		return {
			ok: true,
			source: output,
			edit: sourceEdit(source, output),
			selection: target?.labelRange,
			needsCriteria: target?.needsCriteria,
		};
	}
	if (![">>", ">>?", "->"].includes(request.connector))
		return fail("Unknown connector.");
	const invalid = validateNewNodeId({
		value: request.otherId,
		currentNodeId: request.nodeId,
		wantedKind: compatibleOtherKind(kind),
		kindOfExisting: (id) => model.nodeKinds.get(id),
	});
	if (invalid) return fail(invalid);
	if (
		edgeAlreadyExists(
			model.edges,
			request.nodeId,
			kind,
			request.connector,
			request.otherId,
		)
	)
		return fail("This connection already exists.");
	const edge = buildConnectorEdgeLine(
		request.nodeId,
		kind,
		request.connector,
		request.otherId,
	);
	const inserted = insertConnectorEdge(source, edge, request.nodeId);
	const offset =
		inserted.text.split("\n").slice(0, inserted.insertedLine).join("\n")
			.length +
		(inserted.insertedLine ? 1 : 0) +
		edge.length;
	const caret = {
		line: inserted.insertedLine + 1,
		column: edge.length + 1,
		offset,
	};
	return {
		ok: true,
		source: inserted.text,
		edit: sourceEdit(source, inserted.text),
		selection: { start: caret, end: caret },
	};
}
