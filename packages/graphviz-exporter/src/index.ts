import type { Frontmatter, Graph, NodeKind, NodeStyle } from "@pfdsl/core";
import { STYLE_ATTRS } from "@pfdsl/core";

export interface ExportOptions {
	/** Override rankdir; defaults to frontmatter.layout.direction or 'LR'. */
	rankdir?: "LR" | "RL" | "TB" | "BT";
	/** Color for feedback edges. Default '#888888'. */
	feedbackColor?: string;
	/** Title for the graph; defaults to frontmatter.title. */
	graphLabel?: string;
}

const DEFAULT_FEEDBACK_COLOR = "#888888";

const QUOTE_BACKSLASH_RE = /\\/g;
const QUOTE_DQUOTE_RE = /"/g;
const QUOTE_NEWLINE_RE = /\n/g;

const CJK_RE = /[　-鿿豈-﫿！-｠]/u;

// @hpcc-js/wasm Graphviz has no CJK font metrics → measures CJK chars as ASCII width.
// Compute a minimum node width so the rendered SVG doesn't clip Japanese labels.
function calcMinWidth(label: string): number | undefined {
	if (!CJK_RE.test(label)) return undefined;
	let maxUnits = 0;
	for (const line of label.split("\n")) {
		let units = 0;
		for (const ch of line) {
			const cp = ch.codePointAt(0) ?? 0;
			const isCjk =
				(cp >= 0x3000 && cp <= 0x9fff) ||
				(cp >= 0xf900 && cp <= 0xfaff) ||
				(cp >= 0xff01 && cp <= 0xff60);
			units += isCjk ? 2 : 1;
		}
		maxUnits = Math.max(maxUnits, units);
	}
	return Math.max(0.75, maxUnits * 0.1 + 0.3);
}

export function exportDot(
	graph: Graph,
	frontmatter: Frontmatter | null = null,
	options: ExportOptions = {},
): string {
	const rankdir = options.rankdir ?? frontmatter?.layout?.direction ?? "LR";
	const feedbackColor = options.feedbackColor ?? DEFAULT_FEEDBACK_COLOR;
	const graphLabel = options.graphLabel ?? frontmatter?.title;

	const lines: string[] = [];
	lines.push("digraph PFDSL {");
	lines.push(`  rankdir=${rankdir};`);
	lines.push("  newrank=true;");
	if (graphLabel !== undefined) {
		lines.push(`  label=${quote(String(graphLabel))};`);
		lines.push('  labelloc="t";');
	}
	lines.push("");

	const nodeGroup = new Map<string, string>();
	if (frontmatter?.group) {
		for (const [id, meta] of Object.entries(frontmatter.artifact ?? {})) {
			if (meta.group !== undefined) nodeGroup.set(id, meta.group);
		}
		for (const [id, meta] of Object.entries(frontmatter.process ?? {})) {
			if (meta.group !== undefined) nodeGroup.set(id, meta.group);
		}
	}

	const nodeIds = [...graph.nodes.keys()].sort();
	const groupedNodes = new Map<string, string[]>();
	const ungroupedIds: string[] = [];
	for (const id of nodeIds) {
		const gid = nodeGroup.get(id);
		if (gid !== undefined && frontmatter?.group?.[gid] !== undefined) {
			if (!groupedNodes.has(gid)) groupedNodes.set(gid, []);
			groupedNodes.get(gid)!.push(id);
		} else {
			ungroupedIds.push(id);
		}
	}

	for (const gid of [...groupedNodes.keys()].sort()) {
		const gm = frontmatter!.group![gid]!;
		lines.push(`  subgraph cluster_${gid} {`);
		if (gm.label !== undefined)
			lines.push(`    label=${quote(String(gm.label))};`);
		if (gm.color !== undefined)
			lines.push(`    color=${quote(String(gm.color))};`);
		for (const id of groupedNodes.get(gid)!) {
			lines.push(
				`    ${quote(id)} ${nodeAttrs(id, graph.nodes.get(id)!, frontmatter)};`,
			);
		}
		lines.push("  }");
	}

	for (const id of ungroupedIds) {
		const kind = graph.nodes.get(id)!;
		lines.push(`  ${quote(id)} ${nodeAttrs(id, kind, frontmatter)};`);
	}

	if (graph.primaryEdges.length > 0 || graph.feedbackEdges.length > 0) {
		lines.push("");
	}

	for (const e of graph.primaryEdges) {
		lines.push(`  ${quote(e.from)} -> ${quote(e.to)};`);
	}
	for (const e of graph.feedbackEdges) {
		lines.push(
			`  ${quote(e.artifact)} -> ${quote(e.process)} [style=dashed, color=${quote(feedbackColor)}, constraint=false];`,
		);
	}

	lines.push("}");
	return `${lines.join("\n")}\n`;
}

function nodeAttrs(id: string, kind: NodeKind, fm: Frontmatter | null): string {
	const shape = kind === "process" ? "ellipse" : "box";
	const nodeLabel = lookupLabel(id, kind, fm);
	const label = nodeLabel ? `${id}\n${nodeLabel}` : id;
	const styleAttrs = resolveStyleAttrs(id, kind, fm);
	const xlabel = buildXlabel(id, kind, fm);

	const minWidth = calcMinWidth(label);
	const attrs: string[] = [`shape=${shape}`, `label=${quote(label)}`];
	if (minWidth !== undefined) attrs.push(`width=${minWidth.toFixed(2)}`);
	if (xlabel !== undefined) attrs.push(`xlabel=${quote(xlabel)}`);
	for (const key of STYLE_ATTRS) {
		const v = styleAttrs[key];
		if (v !== undefined) attrs.push(`${key}=${quote(v)}`);
	}
	return `[${attrs.join(", ")}]`;
}

function buildXlabel(
	id: string,
	kind: NodeKind,
	fm: Frontmatter | null,
): string | undefined {
	if (!fm) return undefined;
	const parts: string[] = [];
	if (kind === "artifact") {
		const meta = fm.artifact?.[id];
		if (meta?.status) parts.push(meta.status);
		for (const tag of meta?.tags ?? []) parts.push(tag);
	}
	return parts.length > 0 ? parts.join(", ") : undefined;
}

function resolveStyleAttrs(
	id: string,
	kind: NodeKind,
	fm: Frontmatter | null,
): NodeStyle {
	if (kind !== "artifact" || !fm) return {};
	const meta = fm.artifact?.[id];
	const styleAttrs: NodeStyle = {};
	// tags reverse iter: later Object.assign wins → first tag in array prevails
	const tags = meta?.tags ?? [];
	for (let i = tags.length - 1; i >= 0; i--) {
		const tag = tags[i];
		if (tag !== undefined) Object.assign(styleAttrs, fm.tagStyles?.[tag] ?? {});
	}
	// status applied last to win over tags
	if (meta?.status)
		Object.assign(styleAttrs, fm.statusStyles?.[meta.status] ?? {});
	return styleAttrs;
}

function lookupLabel(
	id: string,
	kind: NodeKind,
	fm: Frontmatter | null,
): string | undefined {
	if (!fm) return undefined;
	const meta = kind === "process" ? fm.process?.[id] : fm.artifact?.[id];
	return meta?.label;
}

function quote(s: string): string {
	return (
		'"' +
		s
			.replace(QUOTE_BACKSLASH_RE, "\\\\")
			.replace(QUOTE_DQUOTE_RE, '\\"')
			.replace(QUOTE_NEWLINE_RE, "\\n") +
		'"'
	);
}
