import {
	analyzeSource,
	formatEdges,
	insertDefinition,
	loadFrontmatter,
	type NormalizedEdge,
	normalizeDocument,
} from "@pfdsl/core";
import { createsPrimaryCycle } from "./connector-logic.js";
import { idsOfStatement } from "./preview-logic.js";

export type ConnectionEdit = {
	nodeId: string;
	source: string;
	artifact: string;
	process: string;
	kind: NormalizedEdge["kind"];
} & ({ type: "deleteConnector" } | { type: "toggleFeedback" });

/** Rebuild only statements containing the selected semantic edge. */
export function editConnection(
	source: string,
	request: ConnectionEdit,
): { source: string } | { message: string } {
	const model = analyzeSource(source);
	const matches = (edge: NormalizedEdge) =>
		edge.kind === request.kind &&
		edge.artifact === request.artifact &&
		edge.process === request.process;
	if (request.nodeId !== request.artifact && request.nodeId !== request.process)
		return { message: "The connection does not belong to this node." };
	if (!model.edges.some(matches))
		return { message: "The connection no longer exists." };
	if (request.type === "toggleFeedback") {
		if (request.kind === "output")
			return { message: "Output connections cannot be feedback." };
		const targetKind = request.kind === "input" ? "feedback" : "input";
		if (
			model.edges.some(
				(e) =>
					e.kind === targetKind &&
					e.artifact === request.artifact &&
					e.process === request.process,
			)
		)
			return { message: "This connection already exists." };
		if (
			targetKind === "input" &&
			createsPrimaryCycle(
				model.graph.primaryEdges,
				request.artifact,
				request.process,
			)
		)
			return { message: "A normal input would create a cycle (V010)." };
	}
	const body = loadFrontmatter(source).body;
	const offset = source.length - body.length;
	const newline = source.includes("\r\n") ? "\r\n" : "\n";
	let output = source;
	for (const statement of [...model.document.statements].reverse()) {
		const edges = normalizeDocument(
			{ type: "document", statements: [statement] },
			model.frontmatter,
		).edges;
		if (!edges.some(matches)) continue;
		const remaining = edges.flatMap((edge) =>
			matches(edge)
				? request.type === "deleteConnector"
					? []
					: [
							{
								...edge,
								kind:
									request.kind === "input"
										? ("feedback" as const)
										: ("input" as const),
							},
						]
				: [edge],
		);
		const original = body.slice(statement.start.offset, statement.end.offset);
		// Hash characters inside authored IDs are not comments.
		const masked = original.split("");
		for (const id of idsOfStatement(statement))
			for (let i = id.start.offset; i < id.end.offset; i++)
				masked[i - statement.start.offset] = " ";
		const comments = [...masked.join("").matchAll(/#[^\r\n]*/g)].map((match) =>
			original.slice(match.index, match.index + match[0].length),
		);
		const replacement =
			`${comments.map((comment) => `${comment}\n`).join("")}${formatEdges(remaining).trimEnd()}`.replace(
				/\n/g,
				newline,
			);
		output =
			output.slice(0, offset + statement.start.offset) +
			replacement +
			output.slice(offset + statement.end.offset);
	}
	// Removing a last edge must not delete or silently change the type of an endpoint.
	for (const id of [request.artifact, request.process]) {
		const kind = model.nodeKinds.get(id) as "artifact" | "process";
		if (analyzeSource(output).nodeKinds.get(id) !== kind) {
			const definition = insertDefinition(output, kind, id);
			if (!definition.inserted)
				return {
					message: "The endpoint definition could not be retained safely.",
				};
			output = definition.output + loadFrontmatter(output).body;
		}
	}
	return { source: output };
}
