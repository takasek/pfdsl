import type { Frontmatter, NodeKind } from "@pfdsl/core";
import { normalizeLocation } from "./location-utils.js";

const KIND_ICON: Record<NodeKind, string> = {
	artifact: "📄",
	process: "▶️",
};

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// valign/align are legacy HTML attributes preserved by VSCode's sanitizer (not CSS)
function tableRow(key: string, value: string): string {
	const v = escapeHtml(value.trimEnd()).replace(/\n/g, "<br>");
	return `<tr><td align="right" valign="top"><em>${escapeHtml(key)}</em></td><td valign="top">${v}</td></tr>`;
}

function descLines(text: string): string[] {
	return text
		.trimEnd()
		.split("\n")
		.map((l) => `> ${escapeHtml(l)}`);
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
			if (meta.description) lines.push(...descLines(meta.description));
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
		lines.push(`<table>${rows.join("")}</table>`);
	}
	return lines;
}

export function buildGroupHoverLines(
	id: string,
	frontmatter: Frontmatter | null,
): string[] | null {
	const meta = frontmatter?.group?.[id];
	if (!meta) return null;

	const lines: string[] = [`🗂 **${id}**`, "---"];
	if (meta.label) lines.push(`**${meta.label}**`);

	const members: string[] = [];
	for (const [aid, ameta] of Object.entries(frontmatter?.artifact ?? {})) {
		if (ameta?.group === id) members.push(`📄 ${aid}`);
	}
	for (const [pid, pmeta] of Object.entries(frontmatter?.process ?? {})) {
		if (pmeta?.group === id) members.push(`▶️ ${pid}`);
	}

	if (members.length > 0) {
		const rows = members.map((m) => tableRow("member", m));
		lines.push(`<table>${rows.join("")}</table>`);
	}
	return lines;
}
