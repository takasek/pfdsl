import type { Frontmatter, NodeKind, Range } from "@pfdsl/core";
import type { DocumentModel } from "./document.js";

/**
 * Kind of `id` if it appears only in edges (no frontmatter `artifact:`/
 * `process:` entry), or undefined if it's already defined or isn't a node.
 */
export function findUndefinedNodeKind(
	nodeKinds: Map<string, NodeKind>,
	frontmatter: Frontmatter | null,
	id: string,
): "artifact" | "process" | undefined {
	const kind = nodeKinds.get(id);
	if (kind !== "artifact" && kind !== "process") return undefined;
	const definitions = frontmatter?.[kind];
	if (definitions && Object.hasOwn(definitions, id)) return undefined;
	return kind;
}

/** Same-kind definitions one edit away, excluding sequential IDs. */
export function findNearDefinedNodeIds(
	frontmatter: Frontmatter | null,
	kind: "artifact" | "process",
	id: string,
): string[] {
	const definitions = frontmatter?.[kind];
	if (!definitions) return [];
	return Object.keys(definitions)
		.filter(
			(candidate) =>
				hasOptimalStringAlignmentDistanceOne(id, candidate) &&
				!areSequentialIds(id, candidate),
		)
		.sort();
}

function hasOptimalStringAlignmentDistanceOne(left: string, right: string) {
	const leftCharacters = Array.from(left);
	const rightCharacters = Array.from(right);
	if (Math.abs(leftCharacters.length - rightCharacters.length) > 1)
		return false;

	const distances = Array.from({ length: leftCharacters.length + 1 }, () =>
		Array<number>(rightCharacters.length + 1).fill(0),
	);
	for (let row = 0; row <= leftCharacters.length; row++)
		distances[row]![0] = row;
	for (let column = 0; column <= rightCharacters.length; column++)
		distances[0]![column] = column;

	for (let row = 1; row <= leftCharacters.length; row++) {
		for (let column = 1; column <= rightCharacters.length; column++) {
			const substitutionCost =
				leftCharacters[row - 1] === rightCharacters[column - 1] ? 0 : 1;
			let distance = Math.min(
				distances[row - 1]![column]! + 1,
				distances[row]![column - 1]! + 1,
				distances[row - 1]![column - 1]! + substitutionCost,
			);
			if (
				row > 1 &&
				column > 1 &&
				leftCharacters[row - 1] === rightCharacters[column - 2] &&
				leftCharacters[row - 2] === rightCharacters[column - 1]
			) {
				distance = Math.min(distance, distances[row - 2]![column - 2]! + 1);
			}
			distances[row]![column] = distance;
		}
	}
	return distances[leftCharacters.length]![rightCharacters.length] === 1;
}

function areSequentialIds(left: string, right: string) {
	const leftNumberParts = left.split(/[0-9]+/g);
	const rightNumberParts = right.split(/[0-9]+/g);
	if (
		leftNumberParts.length === rightNumberParts.length &&
		leftNumberParts.every((part, index) => part === rightNumberParts[index])
	)
		return true;

	const leftSegments = left.split("_");
	const rightSegments = right.split("_");
	if (leftSegments.length !== rightSegments.length) return false;
	let differingSegment = -1;
	for (let index = 0; index < leftSegments.length; index++) {
		if (leftSegments[index] === rightSegments[index]) continue;
		if (differingSegment !== -1) return false;
		differingSegment = index;
	}
	return (
		differingSegment !== -1 &&
		leftSegments[differingSegment]!.length === 1 &&
		rightSegments[differingSegment]!.length === 1
	);
}

/** The current authored label value and any completion guidance for that definition. */
export function findDefinitionEditTarget(
	model: Pick<DocumentModel, "sourceMap" | "edges" | "diagnostics">,
	kind: "artifact" | "process",
	id: string,
): { labelRange: Range; needsCriteria: boolean } | undefined {
	const declaration = model.sourceMap.declarations.find(
		(d) => d.section === kind && d.id === id,
	);
	const labelRange = declaration?.fields.get("label")?.values[0]?.range;
	if (!declaration || !labelRange) return undefined;
	const needsCriteria =
		kind === "artifact" &&
		model.edges.some(
			(edge) => edge.kind === "output" && edge.artifact === id,
		) &&
		model.diagnostics.some(
			(diagnostic) =>
				diagnostic.code === "W002" &&
				diagnostic.range.start.offset === declaration.range.start.offset &&
				diagnostic.range.end.offset === declaration.range.end.offset,
		);
	return { labelRange, needsCriteria };
}
