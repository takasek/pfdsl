import { analyzeSource, type Range } from "@pfdsl/core";
import { type CursorPosition, idsOfStatement } from "./preview-logic.js";

export interface FrontmatterPosition {
	line: number;
	column: number;
}

export function findFrontmatterDefinitionRange(
	model: ReturnType<typeof analyzeSource>,
	nodeId: string,
) {
	return model.sourceMap.declarations.find(
		(d) =>
			d.id === nodeId && (d.section === "artifact" || d.section === "process"),
	)?.range;
}

export function findFrontmatterDefinitionInText(
	text: string,
	nodeId: string,
): FrontmatterPosition | undefined {
	const range = findFrontmatterDefinitionRange(analyzeSource(text), nodeId);
	return range
		? { line: range.start.line - 1, column: range.start.column - 1 }
		: undefined;
}

type SourceModel = ReturnType<typeof analyzeSource>;

function authoredNodeDeclarations(model: SourceModel, source: string) {
	const declarations = model.sourceMap.declarations.filter(
		({ section, range }) =>
			(section === "artifact" || section === "process") &&
			!source
				.slice(range.start.offset, range.end.offset)
				.trim()
				.startsWith("*"),
	);
	return declarations.filter(
		(declaration) =>
			!declarations.some(
				(other) =>
					other.id !== declaration.id &&
					other.range.start.offset < declaration.range.end.offset &&
					declaration.range.start.offset < other.range.end.offset,
			),
	);
}

function containsPosition(range: Range, position: CursorPosition): boolean {
	const line = position.line + 1;
	const column = position.character + 1;
	// Include the end caret so a command can repeat after selecting the ID.
	return (
		(line > range.start.line ||
			(line === range.start.line && column >= range.start.column)) &&
		(line < range.end.line ||
			(line === range.end.line && column <= range.end.column))
	);
}

/** The authored definition key, then all body IDs in full-source order. */
export function findNodeOccurrenceRanges(
	model: SourceModel,
	source: string,
	nodeId: string,
): Range[] {
	const definition = authoredNodeDeclarations(model, source).find(
		(declaration) => declaration.id === nodeId,
	)?.range;
	const body = model.document.statements
		.flatMap(idsOfStatement)
		.filter((id) => id.value === nodeId)
		.map(({ start, end }) => ({ start, end }))
		.sort(
			(a, b) => a.start.line - b.start.line || a.start.column - b.start.column,
		);
	return definition ? [definition, ...body] : body;
}

/** Resolve only semantic node keys and body IDs, never metadata fields. */
export function nodeIdAtSourcePosition(
	model: SourceModel,
	source: string,
	position: CursorPosition,
): string | undefined {
	return nodeOccurrenceAtSourcePosition(model, source, position)?.nodeId;
}

/** The full authored token used by editor commands and hover ranges. */
export function nodeOccurrenceAtSourcePosition(
	model: SourceModel,
	source: string,
	position: CursorPosition,
): { nodeId: string; range: Range } | undefined {
	const definition = authoredNodeDeclarations(model, source).find(({ range }) =>
		containsPosition(range, position),
	);
	if (definition) return { nodeId: definition.id, range: definition.range };
	const token = model.document.statements
		.flatMap(idsOfStatement)
		.find((id) => containsPosition(id, position));
	return token
		? { nodeId: token.value, range: { start: token.start, end: token.end } }
		: undefined;
}

/** Advance from the current occurrence, wrapping within the current snapshot. */
export function nextNodeOccurrenceRange(
	model: SourceModel,
	source: string,
	position: CursorPosition,
): Range | undefined {
	const nodeId = nodeIdAtSourcePosition(model, source, position);
	if (nodeId === undefined) return undefined;
	const ranges = findNodeOccurrenceRanges(model, source, nodeId);
	const index = ranges.findIndex((range) => containsPosition(range, position));
	return index < 0 ? undefined : ranges[(index + 1) % ranges.length];
}
