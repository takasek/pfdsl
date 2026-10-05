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
