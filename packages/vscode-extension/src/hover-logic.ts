import type { Frontmatter, NodeKind } from "@pfdsl/core";
import { normalizeLocation } from "./location-utils.js";

const KIND_ICON: Record<NodeKind, string> = {
	artifact: "📄",
	process: "▶️",
	group: "🗂",
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

const GOTO_COMMAND = "pfdsl._gotoNodeDefinition";

function nodeLink(docUri: string, nodeId: string, icon: string): string {
	const args = encodeURIComponent(JSON.stringify([docUri, nodeId]));
	return `[${icon} ${nodeId}](command:${GOTO_COMMAND}?${args})`;
}

export function buildHoverLines(
	id: string,
	kind: NodeKind,
	frontmatter: Frontmatter | null,
	docUri?: string,
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
	} else {
		// kind === "group"
		const meta = frontmatter?.group?.[id];
		if (meta) {
			if (meta.label) lines.push(`**${meta.label}**`);
			const artifactMembers: string[] = [];
			const processMembers: string[] = [];
			for (const [aid, ameta] of Object.entries(frontmatter?.artifact ?? {})) {
				if (ameta?.group === id) {
					artifactMembers.push(
						docUri
							? nodeLink(docUri, aid, KIND_ICON.artifact)
							: `${KIND_ICON.artifact} ${aid}`,
					);
				}
			}
			for (const [pid, pmeta] of Object.entries(frontmatter?.process ?? {})) {
				if (pmeta?.group === id) {
					processMembers.push(
						docUri
							? nodeLink(docUri, pid, KIND_ICON.process)
							: `${KIND_ICON.process} ${pid}`,
					);
				}
			}
			if (artifactMembers.length > 0)
				rows.push(tableRow("artifact", artifactMembers.join(", ")));
			if (processMembers.length > 0)
				rows.push(tableRow("process", processMembers.join(", ")));
		}
	}

	if (rows.length > 0) {
		lines.push(`<table>${rows.join("")}</table>`);
	}
	return lines;
}
