import type { Frontmatter, NodeKind } from "@pfdsl/core";
import { normalizeLocation } from "./location-utils.js";

export interface HoverLinks {
	node: (id: string, icon: string) => string;
	location: (location: string) => string;
	command: (command: string) => string;
}

const KIND_ICON: Record<NodeKind, string> = {
	artifact: "📄",
	process: "▶️",
	group: "🗂",
};

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// GFM table: inline markdown (links, italic) is processed in cells; <br> for multiline (supportHtml=true)
function tableRow(key: string, value: string): string {
	const v = escapeHtml(value.trimEnd())
		.replace(/\|/g, "\\|")
		.replace(/\n/g, "<br>");
	return `| _${escapeHtml(key)}_ | ${v} |`;
}

function descLines(text: string): string[] {
	return text
		.trimEnd()
		.split("\n")
		.map((l) => `> ${escapeHtml(l)}`);
}

function groupDisplay(
	groupId: string,
	frontmatter: Frontmatter | null,
	links?: HoverLinks,
): string {
	const label = frontmatter?.group?.[groupId]?.label;
	if (links) {
		const link = links.node(groupId, KIND_ICON.group);
		return label ? `${link} (${label})` : link;
	}
	return label ? `${groupId} (${label})` : groupId;
}

export function buildHoverLines(
	id: string,
	kind: NodeKind,
	frontmatter: Frontmatter | null,
	links?: HoverLinks,
): string[] {
	const icon = KIND_ICON[kind];
	const lines: string[] = [`${icon} **${id}**`, "---"];
	const rows: string[] = [];

	if (kind === "artifact") {
		const meta = frontmatter?.artifact?.[id];
		if (meta) {
			if (meta.label) lines.push(`**${meta.label}**`);
			if (meta.description) lines.push(...descLines(meta.description));
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
			if (meta.group)
				rows.push(
					tableRow("group", groupDisplay(meta.group, frontmatter, links)),
				);
			if (meta.criteria) rows.push(tableRow("criteria", meta.criteria));
			const locs = normalizeLocation(meta.location);
			if (locs.length) {
				const locDisplay = links
					? locs.map((l) => links.location(l)).join(", ")
					: locs.join(", ");
				rows.push(tableRow("location", locDisplay));
			}
			if (meta.revises) rows.push(tableRow("revises", meta.revises));
		}
	} else if (kind === "process") {
		const meta = frontmatter?.process?.[id];
		if (meta) {
			if (meta.label) lines.push(`**${meta.label}**`);
			if (meta.description) lines.push(...descLines(meta.description));
			if (meta.owner) rows.push(tableRow("owner", meta.owner));
			if (meta.externalStakeholders?.length)
				rows.push(
					tableRow(
						"externalStakeholders",
						meta.externalStakeholders.join(", "),
					),
				);
			if (meta.group)
				rows.push(
					tableRow("group", groupDisplay(meta.group, frontmatter, links)),
				);
			if (meta.tags?.length) rows.push(tableRow("tags", meta.tags.join(", ")));
			if (meta.command) {
				const commandDisplay = links
					? links.command(meta.command)
					: meta.command;
				rows.push(tableRow("command", commandDisplay));
			}
			if (meta.subflow) rows.push(tableRow("subflow", meta.subflow));
		}
	} else {
		// kind === "group"
		const meta = frontmatter?.group?.[id];
		if (meta) {
			if (meta.label) lines.push(`**${meta.label}**`);
			for (const [mapKey, icon] of [
				["artifact", KIND_ICON.artifact],
				["process", KIND_ICON.process],
			] as const) {
				const members = Object.entries(frontmatter?.[mapKey] ?? {})
					.filter(([, m]) => m?.group === id)
					.map(([nid]) => (links ? links.node(nid, icon) : `${icon} ${nid}`));
				if (members.length > 0) rows.push(tableRow(mapKey, members.join(", ")));
			}
		}
	}

	if (rows.length > 0) {
		lines.push(["| | |", "|--:|:--|", ...rows].join("\n"));
	}
	return lines;
}
