import type { Frontmatter, NodeKind } from "@pfdsl/core";
import { normalizeLocation } from "./location-utils.js";

const KIND_ICON: Record<NodeKind, string> = {
	artifact: "📄",
	process: "▶️",
};

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tableRow(key: string, value: string): string {
	// GFM table: _key_ for italic; <br> for multiline values (supportHtml = true)
	const v = escapeHtml(value.trimEnd())
		.replace(/\|/g, "\\|")
		.replace(/\n/g, "<br>");
	return `| _${key}_ | ${v} |`;
}

function descLine(text: string): string {
	return `<em>${escapeHtml(text.trimEnd()).replace(/\n/g, "<br>")}</em>`;
}

export function buildHoverLines(
	id: string,
	kind: NodeKind,
	frontmatter: Frontmatter | null,
): string[] {
	const icon = KIND_ICON[kind];
	const lines: string[] = [`${icon} **${id}**`, "---"];
	const rows: string[] = [];

	if (kind === "artifact") {
		const meta = frontmatter?.artifact?.[id];
		if (meta) {
			if (meta.label) lines.push(`**${meta.label}**`);
			if (meta.description) lines.push(descLine(meta.description));
			if (meta.owner) rows.push(tableRow("owner", meta.owner));
			if (meta.externalStakeholders?.length)
				rows.push(
					tableRow(
						"externalStakeholders",
						meta.externalStakeholders.join(", "),
					),
				);
			if (meta.status) rows.push(tableRow("status", meta.status));
			if (meta.tags?.length) rows.push(tableRow("tags", meta.tags.join(", ")));
			if (meta.parts?.length)
				rows.push(tableRow("parts", meta.parts.join(", ")));
			if (meta.group) {
				const groupLabel = frontmatter?.group?.[meta.group]?.label;
				rows.push(
					tableRow(
						"group",
						groupLabel ? `${meta.group} (${groupLabel})` : meta.group,
					),
				);
			}
			if (meta.criteria) rows.push(tableRow("criteria", meta.criteria));
			const locs = normalizeLocation(meta.location);
			if (locs.length) rows.push(tableRow("location", locs.join(", ")));
			if (meta.revises) rows.push(tableRow("revises", meta.revises));
		}
	} else {
		const meta = frontmatter?.process?.[id];
		if (meta) {
			if (meta.label) lines.push(`**${meta.label}**`);
			if (meta.description) lines.push(descLine(meta.description));
			if (meta.owner) rows.push(tableRow("owner", meta.owner));
			if (meta.externalStakeholders?.length)
				rows.push(
					tableRow(
						"externalStakeholders",
						meta.externalStakeholders.join(", "),
					),
				);
			if (meta.group) {
				const groupLabel = frontmatter?.group?.[meta.group]?.label;
				rows.push(
					tableRow(
						"group",
						groupLabel ? `${meta.group} (${groupLabel})` : meta.group,
					),
				);
			}
			if (meta.tags?.length) rows.push(tableRow("tags", meta.tags.join(", ")));
			if (meta.command) rows.push(tableRow("command", meta.command));
			if (meta.subflow) rows.push(tableRow("subflow", meta.subflow));
		}
	}

	if (rows.length > 0) {
		lines.push("| | |", "|--:|:--|", ...rows);
	}
	return lines;
}
