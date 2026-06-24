import type { Frontmatter, NodeKind } from "@pfdsl/core";

export function buildHoverLines(
	id: string,
	kind: NodeKind,
	frontmatter: Frontmatter | null,
): string[] {
	const lines: string[] = [`**${id}** _(${kind})_`];
	if (kind === "artifact") {
		const meta = frontmatter?.artifact?.[id];
		if (meta) {
			if (meta.label) lines.push(`label: ${meta.label}`);
			if (meta.owner) lines.push(`owner: ${meta.owner}`);
			if (meta.status) lines.push(`status: ${meta.status}`);
			if (meta.tags?.length) lines.push(`tags: ${meta.tags.join(", ")}`);
			if (meta.parts?.length) lines.push(`parts: ${meta.parts.join(", ")}`);
		}
	} else {
		const meta = frontmatter?.process?.[id];
		if (meta) {
			if (meta.label) lines.push(`label: ${meta.label}`);
			if (meta.owner) lines.push(`owner: ${meta.owner}`);
		}
	}
	return lines;
}
