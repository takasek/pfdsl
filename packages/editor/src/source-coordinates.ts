import type {
	ArtifactExpr,
	analyzeSource,
	IdNode,
	Position,
	Statement,
} from "@pfdsl/core";

/** Adapt only core's body positions to the editor snapshot's full-source UTF-16 coordinates. */
export function snapshotCoordinates(
	model: ReturnType<typeof analyzeSource>,
	source: string,
) {
	const lineStarts = [0];
	for (let offset = 0; offset < source.length; offset++) {
		if (source[offset] === "\n") lineStarts.push(offset + 1);
	}
	const bodyOffset = lineStarts[model.bodyStartLine - 1] ?? source.length;
	function position(value: Position): Position {
		const offset = bodyOffset + value.offset;
		return {
			...value,
			offset,
			column: offset - (lineStarts[value.line - 1] ?? source.length) + 1,
		};
	}
	function endpoints<T extends { start: Position; end: Position }>(value: T) {
		return { ...value, start: position(value.start), end: position(value.end) };
	}
	function id(value: IdNode): IdNode {
		return endpoints(value);
	}
	function artifact(value: ArtifactExpr): ArtifactExpr {
		return { ...endpoints(value), ids: value.ids.map(id) };
	}
	function statement(value: Statement): Statement {
		switch (value.type) {
			case "chain":
				return {
					...endpoints(value),
					head: artifact(value.head),
					segments: value.segments.map((segment) => ({
						...segment,
						process: id(segment.process),
						output: segment.output ? artifact(segment.output) : null,
					})),
				};
			case "input-edge":
			case "feedback-edge":
			case "output-edge":
				return {
					...endpoints(value),
					artifact: artifact(value.artifact),
					process: id(value.process),
				};
			case "node-decl":
				return { ...endpoints(value), id: id(value.id) };
		}
	}
	return {
		...model,
		document: {
			...model.document,
			statements: model.document.statements.map(statement),
		},
		// Lexer/parser ranges share body offsets. Metadata and document-wide
		// diagnostics already have their own full-source or zero-range contract.
		diagnostics: model.diagnostics.map((diagnostic) =>
			/^[LP]\d+$/.test(diagnostic.code)
				? { ...diagnostic, range: endpoints(diagnostic.range) }
				: diagnostic,
		),
	};
}
