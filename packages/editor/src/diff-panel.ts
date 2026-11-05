import type { DiffReport } from "@pfdsl/core";

const HTML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};
function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

type DiffLineKind = "add" | "remove" | "change";

function diffLineClass(kind: DiffLineKind): string {
	switch (kind) {
		case "add":
			return "diff-add";
		case "remove":
			return "diff-remove";
		case "change":
			return "diff-change";
	}
}

/**
 * Render a DiffReport as the HTML content of the preview panel's diff strip.
 * Mirrors the CLI's `pfdsl diff` text output: `+`/`-`/`~` prefixed lines for
 * added/removed/changed nodes, edges, and feedback edges.
 */
export function buildDiffPanelHtml(report: DiffReport): string {
	const lines: Array<{ text: string; kind: DiffLineKind }> = [];
	for (const n of report.addedNodes)
		lines.push({ text: `+ node  ${n}`, kind: "add" });
	for (const n of report.removedNodes)
		lines.push({ text: `- node  ${n}`, kind: "remove" });
	for (const n of report.changedNodes)
		lines.push({ text: `~ node  ${n}`, kind: "change" });
	for (const e of report.addedEdges)
		lines.push({ text: `+ edge  ${e}`, kind: "add" });
	for (const e of report.removedEdges)
		lines.push({ text: `- edge  ${e}`, kind: "remove" });
	for (const f of report.addedFeedback)
		lines.push({ text: `+ feedback  ${f}`, kind: "add" });
	for (const f of report.removedFeedback)
		lines.push({ text: `- feedback  ${f}`, kind: "remove" });

	if (lines.length === 0) {
		return `<span class="diff-none">No structural differences</span>`;
	}
	return lines
		.map(
			(l) =>
				`<div class="${diffLineClass(l.kind)}">${escapeHtml(l.text)}</div>`,
		)
		.join("");
}
