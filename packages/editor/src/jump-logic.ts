import { analyzeSource } from "@pfdsl/core";

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
