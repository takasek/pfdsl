import {
	analyzeSource,
	insertDefinition,
	loadFrontmatter,
	type Range,
} from "@pfdsl/core";
import { type ConnectionEdit, editConnection } from "./connection-edit.js";
import {
	buildConnectorEdgeLine,
	type ConnectorKind,
	compatibleOtherKind,
	createsPrimaryCycle,
	edgeAlreadyExists,
	insertConnectorEdge,
	outputProducerConflict,
	validateNewNodeId,
} from "./connector-logic.js";
import {
	findDefinitionEditTarget,
	findUndefinedNodeKind,
} from "./def-insertion-logic.js";

export type PreviewEditRequest =
	| ConnectionEdit
	| { type: "createDefinition"; nodeId: string; source: string }
	| {
			type: "addConnector";
			nodeId: string;
			source: string;
			connector: ConnectorKind;
			otherId: string;
			create?: boolean;
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

/** Syntax errors and missing endpoints prevent all preview edits. */
function editableNodeError(
	model: ReturnType<typeof analyzeSource>,
	nodeId: string,
) {
	if (
		model.diagnostics.some(
			(d) => d.severity === "error" && /^(FM|L|P|N)\d+$/.test(d.code),
		)
	)
		return "The document cannot be parsed safely. Fix its diagnostics first.";
	const kind = model.nodeKinds.get(nodeId);
	if (kind !== "artifact" && kind !== "process")
		return "The target node no longer exists.";
	return undefined;
}

/** Candidate validation reuses the analyzed snapshot without constructing an edit. */
export function connectorError(
	model: ReturnType<typeof analyzeSource>,
	request: Extract<PreviewEditRequest, { type: "addConnector" }>,
) {
	const invalidSource = editableNodeError(model, request.nodeId);
	if (invalidSource) return invalidSource;
	const kind = model.nodeKinds.get(request.nodeId) as "artifact" | "process";
	if (![">>", ">>?", "->"].includes(request.connector))
		return "Unknown connector.";
	const invalid = validateNewNodeId({
		value: request.otherId,
		currentNodeId: request.nodeId,
		wantedKind: compatibleOtherKind(kind),
		kindOfExisting: (id) => model.nodeKinds.get(id),
	});
	if (invalid) return invalid;
	if (request.create && model.nodeKinds.has(request.otherId))
		return "This ID already exists. Choose it from the candidates.";
	if (
		edgeAlreadyExists(
			model.edges,
			request.nodeId,
			kind,
			request.connector,
			request.otherId,
		)
	)
		return "This connection already exists.";
	const conflict = outputProducerConflict(
		model.edges,
		request.nodeId,
		kind,
		request.connector,
		request.otherId,
	);
	if (conflict) return conflict;
	const artifact = kind === "artifact" ? request.nodeId : request.otherId;
	const process = kind === "process" ? request.nodeId : request.otherId;
	if (
		request.connector !== ">>?" &&
		createsPrimaryCycle(
			model.graph.primaryEdges,
			request.connector === "->" ? process : artifact,
			request.connector === "->" ? artifact : process,
		)
	)
		return "This connection would create a cycle (V010).";
	return undefined;
}

/** A menu belongs to the exact authored source from which its candidates were calculated. */
export function applyPreviewEdit(
	source: string,
	request: PreviewEditRequest,
): PreviewEditResult {
	const fail = (message: string): PreviewEditResult => ({ ok: false, message });
	if (request.source !== source)
		return fail("The document changed. Reopen Connections and try again.");
	const model = analyzeSource(source);
	const invalid =
		request.type === "addConnector"
			? connectorError(model, request)
			: editableNodeError(model, request.nodeId);
	if (invalid) return fail(invalid);
	const kind = model.nodeKinds.get(request.nodeId) as "artifact" | "process";
	if (request.type === "deleteConnector" || request.type === "toggleFeedback") {
		const result = editConnection(source, request);
		return "message" in result
			? fail(result.message)
			: {
					ok: true,
					source: result.source,
					edit: sourceEdit(source, result.source),
				};
	}
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
	const edge = buildConnectorEdgeLine(
		request.nodeId,
		kind,
		request.connector,
		request.otherId,
	);
	const inserted = insertConnectorEdge(source, edge, request.nodeId);
	if (request.create) {
		const definition = insertDefinition(
			inserted.text,
			compatibleOtherKind(kind) as "artifact" | "process",
			request.otherId,
		);
		if (!definition.inserted)
			return fail("The new node definition could not be inserted safely.");
		const output = definition.output + loadFrontmatter(inserted.text).body;
		const target = findDefinitionEditTarget(
			analyzeSource(output),
			compatibleOtherKind(kind) as "artifact" | "process",
			request.otherId,
		);
		return {
			ok: true,
			source: output,
			edit: sourceEdit(source, output),
			selection: target?.labelRange,
		};
	}
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
