import type { Frontmatter, NodeKind } from "@pfdsl/core";
import { normalizeLocation } from "./location-utils.js";

function field(key: string, value: string): string {
	const trimmed = value.trimEnd();
	if (trimmed.includes("\n")) {
		const indented = trimmed
			.split("\n")
			.map((l) => `  ${l}`)
			.join("  \n");
		return `**${key}:**  \n${indented}`;
	}
	return `**${key}:** ${trimmed}`;
}

export function buildHoverLines(
	id: string,
	kind: NodeKind,
	frontmatter: Frontmatter | null,
): string[] {
	const lines: string[] = [`**${id}** _(${kind})_`, "---"];
	if (kind === "artifact") {
		const meta = frontmatter?.artifact?.[id];
		if (meta) {
			if (meta.label) lines.push(field("label", meta.label));
			if (meta.description) lines.push(field("description", meta.description));
			if (meta.owner) lines.push(field("owner", meta.owner));
			if (meta.externalStakeholders?.length)
				lines.push(
					field("externalStakeholders", meta.externalStakeholders.join(", ")),
				);
			if (meta.status) lines.push(field("status", meta.status));
			if (meta.tags?.length) lines.push(field("tags", meta.tags.join(", ")));
			if (meta.parts?.length) lines.push(field("parts", meta.parts.join(", ")));
			if (meta.group) {
				const groupLabel = frontmatter?.group?.[meta.group]?.label;
				lines.push(
					field(
						"group",
						groupLabel ? `${meta.group} (${groupLabel})` : meta.group,
					),
				);
			}
			if (meta.criteria) lines.push(field("criteria", meta.criteria));
			const locs = normalizeLocation(meta.location);
			if (locs.length) lines.push(field("location", locs.join(", ")));
			if (meta.revises) lines.push(field("revises", meta.revises));
		}
	} else {
		const meta = frontmatter?.process?.[id];
		if (meta) {
			if (meta.label) lines.push(field("label", meta.label));
			if (meta.description) lines.push(field("description", meta.description));
			if (meta.owner) lines.push(field("owner", meta.owner));
			if (meta.externalStakeholders?.length)
				lines.push(
					field("externalStakeholders", meta.externalStakeholders.join(", ")),
				);
			if (meta.group) {
				const groupLabel = frontmatter?.group?.[meta.group]?.label;
				lines.push(
					field(
						"group",
						groupLabel ? `${meta.group} (${groupLabel})` : meta.group,
					),
				);
			}
			if (meta.tags?.length) lines.push(field("tags", meta.tags.join(", ")));
			if (meta.command) lines.push(field("command", meta.command));
			if (meta.subflow) lines.push(field("subflow", meta.subflow));
		}
	}
	return lines;
}
