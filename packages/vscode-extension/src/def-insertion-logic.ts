import type { Frontmatter, NodeKind } from "@pfdsl/core";

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
	if (frontmatter?.[kind]?.[id]) return undefined;
	return kind;
}
