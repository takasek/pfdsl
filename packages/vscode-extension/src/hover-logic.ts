import type { Frontmatter, NodeKind } from "@pfdsl/core";
import { normalizeLocation } from "./location-utils.js";

const KEY_STYLE =
	'style="text-align:right;vertical-align:top;white-space:nowrap;padding-right:6px;color:var(--vscode-descriptionForeground);font-style:italic;font-size:0.9em;"';
const VAL_STYLE = 'style="vertical-align:top;"';

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tableRow(key: string, value: string): string {
	const v = escapeHtml(value.trimEnd()).replace(/\n/g, "<br>");
	return `<tr><td ${KEY_STYLE}>${escapeHtml(key)}</td><td ${VAL_STYLE}>${v}</td></tr>`;
}

export function buildHoverLines(
	id: string,
	kind: NodeKind,
	frontmatter: Frontmatter | null,
): string[] {
	const lines: string[] = [`**${id}** _(${kind})_`, "---"];
	const rows: string[] = [];

	if (kind === "artifact") {
		const meta = frontmatter?.artifact?.[id];
		if (meta) {
			if (meta.label) rows.push(tableRow("label", meta.label));
			if (meta.description)
				rows.push(tableRow("description", meta.description));
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
			if (meta.label) rows.push(tableRow("label", meta.label));
			if (meta.description)
				rows.push(tableRow("description", meta.description));
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
