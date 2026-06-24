import type { Frontmatter, NodeKind } from "@pfdsl/core";
import { normalizeLocation } from "./location-utils.js";

export function buildHoverLines(
	id: string,
	kind: NodeKind,
	frontmatter: Frontmatter | null,
): string[] {
	const lines: string[] = [`**${id}** _(${kind})_`, "---"];
	if (kind === "artifact") {
		const meta = frontmatter?.artifact?.[id];
		if (meta) {
			if (meta.label) lines.push(`**label:** ${meta.label}`);
			if (meta.description) lines.push(`**description:** ${meta.description}`);
			if (meta.owner) lines.push(`**owner:** ${meta.owner}`);
			if (meta.externalStakeholders?.length)
				lines.push(
					`**externalStakeholders:** ${meta.externalStakeholders.join(", ")}`,
				);
			if (meta.status) lines.push(`**status:** ${meta.status}`);
			if (meta.tags?.length) lines.push(`**tags:** ${meta.tags.join(", ")}`);
			if (meta.parts?.length) lines.push(`**parts:** ${meta.parts.join(", ")}`);
			if (meta.group) lines.push(`**group:** ${meta.group}`);
			if (meta.criteria) lines.push(`**criteria:** ${meta.criteria}`);
			const locs = normalizeLocation(meta.location);
			if (locs.length) lines.push(`**location:** ${locs.join(", ")}`);
			if (meta.revises) lines.push(`**revises:** ${meta.revises}`);
		}
	} else {
		const meta = frontmatter?.process?.[id];
		if (meta) {
			if (meta.label) lines.push(`**label:** ${meta.label}`);
			if (meta.description) lines.push(`**description:** ${meta.description}`);
			if (meta.owner) lines.push(`**owner:** ${meta.owner}`);
			if (meta.externalStakeholders?.length)
				lines.push(
					`**externalStakeholders:** ${meta.externalStakeholders.join(", ")}`,
				);
			if (meta.group) lines.push(`**group:** ${meta.group}`);
			if (meta.tags?.length) lines.push(`**tags:** ${meta.tags.join(", ")}`);
			if (meta.command) lines.push(`**command:** ${meta.command}`);
			if (meta.subflow) lines.push(`**subflow:** ${meta.subflow}`);
		}
	}
	return lines;
}
