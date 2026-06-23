import type {
	ArtifactMeta,
	Frontmatter,
	Graph,
	NodeKind,
	NodeStyle,
	ProcessMeta,
} from "@pfdsl/core";
import { diffGraphs, STYLE_ATTRS } from "@pfdsl/core";

const MIN_WRAP_RATIO = 0.3;
const LINE_HEAD_FORBIDDEN = /[、。，．）}\]」』】！？!?]/;
const LINE_END_FORBIDDEN = /[（{[「『【]/;
const BREAK_CHARS = /[、。，．,.\s()（）「」『』【】[\]=]/;

// Times New Roman em widths (per 1000 units), font size = 14pt
const FONT_SIZE = 14;
const CHAR_EM: Record<string, number> = {
	" ": 250,
	"!": 333,
	'"': 408,
	"#": 500,
	$: 500,
	"%": 833,
	"&": 778,
	"'": 180,
	"(": 333,
	")": 333,
	"*": 500,
	"+": 564,
	",": 250,
	"-": 333,
	".": 250,
	"/": 278,
	"0": 500,
	"1": 500,
	"2": 500,
	"3": 500,
	"4": 500,
	"5": 500,
	"6": 500,
	"7": 500,
	"8": 500,
	"9": 500,
	":": 278,
	";": 278,
	"<": 564,
	"=": 564,
	">": 564,
	"?": 444,
	"@": 921,
	A: 722,
	B: 667,
	C: 667,
	D: 722,
	E: 611,
	F: 556,
	G: 722,
	H: 722,
	I: 333,
	J: 389,
	K: 722,
	L: 611,
	M: 889,
	N: 722,
	O: 722,
	P: 556,
	Q: 722,
	R: 667,
	S: 556,
	T: 611,
	U: 722,
	V: 722,
	W: 944,
	X: 722,
	Y: 722,
	Z: 611,
	"[": 333,
	"\\": 278,
	"]": 333,
	"^": 469,
	_: 500,
	"`": 333,
	a: 444,
	b: 500,
	c: 444,
	d: 500,
	e: 444,
	f: 333,
	g: 500,
	h: 500,
	i: 278,
	j: 278,
	k: 500,
	l: 278,
	m: 778,
	n: 500,
	o: 500,
	p: 500,
	q: 500,
	r: 333,
	s: 389,
	t: 278,
	u: 500,
	v: 500,
	w: 722,
	x: 500,
	y: 500,
	z: 444,
	"{": 480,
	"|": 200,
	"}": 480,
	"~": 541,
};

function measureTextWidth(text: string): number {
	let w = 0;
	for (const ch of text) {
		const cp = ch.codePointAt(0) ?? 0;
		if (
			(cp >= 0x3040 && cp <= 0x309f) || // hiragana
			(cp >= 0x30a0 && cp <= 0x30ff) || // katakana
			(cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
			(cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility
			(cp >= 0xff00 && cp <= 0xffef) // fullwidth
		) {
			w += FONT_SIZE; // full-width = 1em
		} else {
			w += ((CHAR_EM[ch] ?? 500) / 1000) * FONT_SIZE;
		}
	}
	return w;
}

function wrapLabel(text: string, maxWidthPx: number): string {
	if (measureTextWidth(text) <= maxWidthPx) return text;

	const lines: string[] = [];
	let currentLine = "";

	for (let i = 0; i < text.length; i++) {
		const char = text[i]!;
		const testLine = currentLine + char;

		if (measureTextWidth(testLine) > maxWidthPx && currentLine.length > 0) {
			let breakIndex = -1;

			if (!BREAK_CHARS.test(char)) {
				for (let j = currentLine.length - 1; j >= 0; j--) {
					const breakChar = currentLine[j]!;
					if (BREAK_CHARS.test(breakChar)) {
						if (LINE_END_FORBIDDEN.test(breakChar)) continue;
						const widthToBreak = measureTextWidth(
							currentLine.substring(0, j + 1),
						);
						if (widthToBreak > maxWidthPx * MIN_WRAP_RATIO) {
							breakIndex = j;
							break;
						}
					}
				}
			}

			if (breakIndex >= 0) {
				const breakChar = currentLine[breakIndex]!;
				if (LINE_HEAD_FORBIDDEN.test(breakChar)) {
					lines.push(currentLine.substring(0, breakIndex + 1));
					currentLine = currentLine.substring(breakIndex + 1) + char;
				} else {
					lines.push(currentLine.substring(0, breakIndex));
					currentLine = currentLine.substring(breakIndex + 1) + char;
				}
			} else {
				lines.push(currentLine);
				currentLine = char;
			}
		} else {
			currentLine = testLine;
		}
	}

	if (currentLine) lines.push(currentLine);
	return lines.join("\n");
}

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

function darkenHex(color: string, factor = 0.7): string | undefined {
	const m6 = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(color);
	if (m6) {
		const r = Math.round(parseInt(m6[1]!, 16) * factor);
		const g = Math.round(parseInt(m6[2]!, 16) * factor);
		const b = Math.round(parseInt(m6[3]!, 16) * factor);
		return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
	}
	const m3 = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(color);
	if (m3) {
		const r = Math.round(parseInt(m3[1]! + m3[1]!, 16) * factor);
		const g = Math.round(parseInt(m3[2]! + m3[2]!, 16) * factor);
		const b = Math.round(parseInt(m3[3]! + m3[3]!, 16) * factor);
		return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
	}
	return undefined;
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

	const hasIncoming = new Set<string>();
	const hasOutgoing = new Set<string>();
	for (const e of graph.primaryEdges) {
		hasIncoming.add(e.to);
		hasOutgoing.add(e.from);
	}
	const boundaryArtifacts = new Set<string>();
	for (const [id, kind] of graph.nodes) {
		if (kind === "artifact" && (!hasIncoming.has(id) || !hasOutgoing.has(id))) {
			boundaryArtifacts.add(id);
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

	const groupDefs = frontmatter?.group ?? {};
	const groupChildren = new Map<string, string[]>();
	const rootGroups: string[] = [];
	for (const gid of Object.keys(groupDefs).sort()) {
		const parentId = groupDefs[gid]?.parent;
		if (parentId !== undefined && groupDefs[parentId] !== undefined) {
			if (!groupChildren.has(parentId)) groupChildren.set(parentId, []);
			groupChildren.get(parentId)!.push(gid);
		} else {
			rootGroups.push(gid);
		}
	}

	function emitGroupBlock(gid: string, indent: string): void {
		const gm = groupDefs[gid]!;
		const inner = `${indent}  `;
		lines.push(`${indent}subgraph cluster_${gid} {`);
		if (gm.label !== undefined)
			lines.push(`${inner}label=${quote(String(gm.label))};`);
		if (gm.color !== undefined) {
			const fillColor = String(gm.color);
			const strokeColor = darkenHex(fillColor) ?? fillColor;
			lines.push(`${inner}color=${quote(strokeColor)};`);
			lines.push(`${inner}style="filled";`);
			lines.push(`${inner}fillcolor=${quote(fillColor)};`);
		}
		for (const childGid of (groupChildren.get(gid) ?? []).sort()) {
			emitGroupBlock(childGid, inner);
		}
		for (const id of groupedNodes.get(gid) ?? []) {
			lines.push(
				`${inner}${quote(id)} ${nodeAttrs(id, graph.nodes.get(id)!, frontmatter, boundaryArtifacts)};`,
			);
		}
		lines.push(`${indent}}`);
	}

	for (const gid of rootGroups) {
		if (groupedNodes.has(gid) || (groupChildren.get(gid)?.length ?? 0) > 0) {
			emitGroupBlock(gid, "  ");
		}
	}

	for (const id of ungroupedIds) {
		const kind = graph.nodes.get(id)!;
		lines.push(
			`  ${quote(id)} ${nodeAttrs(id, kind, frontmatter, boundaryArtifacts)};`,
		);
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

export function exportDiffDot(
	a: Graph,
	fmA: Frontmatter | null,
	b: Graph,
	fmB: Frontmatter | null,
	options: ExportOptions = {},
): string {
	const report = diffGraphs(a, b, fmA, fmB);

	const added = new Set(report.addedNodes);
	const removed = new Set(report.removedNodes);
	const changed = new Set(report.changedNodes);

	// Build edge classifications — primary edges
	const primaryEdgeMap = new Map<
		string,
		{ from: string; to: string; status: "added" | "removed" | "unchanged" }
	>();
	for (const e of a.primaryEdges) {
		const key = `${e.from} -> ${e.to}`;
		if (!primaryEdgeMap.has(key))
			primaryEdgeMap.set(key, { from: e.from, to: e.to, status: "unchanged" });
	}
	for (const e of b.primaryEdges) {
		const key = `${e.from} -> ${e.to}`;
		if (!primaryEdgeMap.has(key))
			primaryEdgeMap.set(key, { from: e.from, to: e.to, status: "unchanged" });
	}
	const addedEdgesSet = new Set(report.addedEdges);
	const removedEdgesSet = new Set(report.removedEdges);
	for (const [key, val] of primaryEdgeMap) {
		if (addedEdgesSet.has(key)) val.status = "added";
		else if (removedEdgesSet.has(key)) val.status = "removed";
	}

	// Feedback edges
	const feedbackEdgeMap = new Map<
		string,
		{
			artifact: string;
			process: string;
			status: "added" | "removed" | "unchanged";
		}
	>();
	for (const e of a.feedbackEdges) {
		const key = `${e.artifact} -> ${e.process}`;
		if (!feedbackEdgeMap.has(key))
			feedbackEdgeMap.set(key, {
				artifact: e.artifact,
				process: e.process,
				status: "unchanged",
			});
	}
	for (const e of b.feedbackEdges) {
		const key = `${e.artifact} -> ${e.process}`;
		if (!feedbackEdgeMap.has(key))
			feedbackEdgeMap.set(key, {
				artifact: e.artifact,
				process: e.process,
				status: "unchanged",
			});
	}
	const addedFeedbackSet = new Set(report.addedFeedback);
	const removedFeedbackSet = new Set(report.removedFeedback);
	for (const [key, val] of feedbackEdgeMap) {
		if (addedFeedbackSet.has(key)) val.status = "added";
		else if (removedFeedbackSet.has(key)) val.status = "removed";
	}

	// Visible nodes
	const visibleNodes = new Set<string>([...added, ...removed, ...changed]);
	for (const [, val] of primaryEdgeMap) {
		if (val.status === "added" || val.status === "removed") {
			visibleNodes.add(val.from);
			visibleNodes.add(val.to);
		}
	}
	for (const [, val] of feedbackEdgeMap) {
		if (val.status === "added" || val.status === "removed") {
			visibleNodes.add(val.artifact);
			visibleNodes.add(val.process);
		}
	}

	// Visible edges (added & removed only)
	const visiblePrimaryEdges = [...primaryEdgeMap.entries()]
		.filter(([, val]) => val.status === "added" || val.status === "removed")
		.sort(([a], [b]) => a.localeCompare(b));

	const visibleFeedbackEdges = [...feedbackEdgeMap.entries()]
		.filter(([, val]) => val.status === "added" || val.status === "removed")
		.sort(([a], [b]) => a.localeCompare(b));

	// Graph header
	const rankdir =
		options.rankdir ?? fmB?.layout?.direction ?? fmA?.layout?.direction ?? "LR";
	const title = options.graphLabel ?? fmB?.title;
	const graphLabel = title ? `${title} — diff` : "diff";
	const legend = "green = added · red = removed · yellow = changed";
	const fullLabel = `${graphLabel}\n${legend}`;

	const lines: string[] = [];
	lines.push("digraph PFDSL {");
	lines.push(`  rankdir=${rankdir};`);
	lines.push("  newrank=true;");
	lines.push(`  label=${quote(fullLabel)};`);
	lines.push('  labelloc="t";');
	lines.push("");

	// Empty diff
	if (added.size === 0 && removed.size === 0 && changed.size === 0) {
		lines.push(
			'  "_nodiff" [shape=note, label="No structural or metadata changes"];',
		);
		lines.push("}");
		return `${lines.join("\n")}\n`;
	}

	const maxWidth =
		typeof fmB?.layout?.maxWidth === "number"
			? fmB.layout.maxWidth
			: typeof fmA?.layout?.maxWidth === "number"
				? fmA.layout.maxWidth
				: undefined;

	// Emit visible nodes sorted by id
	for (const id of [...visibleNodes].sort()) {
		const kind = b.nodes.get(id) ?? a.nodes.get(id);
		if (kind === undefined) continue;

		const fm = removed.has(id) ? fmA : fmB;
		const meta = kind === "process" ? fm?.process?.[id] : fm?.artifact?.[id];
		const nodeLabel = meta?.label;
		const wrappedLabel =
			nodeLabel !== undefined && maxWidth !== undefined
				? wrapLabel(nodeLabel, maxWidth)
				: nodeLabel;
		const label = wrappedLabel ? `${id}\n${wrappedLabel}` : id;

		const shape = kind === "process" ? "ellipse" : "box";
		const minWidth = calcMinWidth(label);

		let styleAttrs: string;
		if (added.has(id)) {
			styleAttrs = 'style="filled", fillcolor="#c3e6cb", color="#28a745"';
		} else if (removed.has(id)) {
			styleAttrs = 'style="filled", fillcolor="#f5c6cb", color="#dc3545"';
		} else if (changed.has(id)) {
			styleAttrs = 'style="filled", fillcolor="#ffeeba", color="#e0a800"';
		} else {
			// context
			styleAttrs =
				'style="filled", fillcolor="#f5f5f5", color="#bbbbbb", fontcolor="#777777"';
		}

		const attrs = [`shape=${shape}`, `label=${quote(label)}`];
		if (minWidth !== undefined) attrs.push(`width=${minWidth.toFixed(2)}`);
		attrs.push(styleAttrs);

		lines.push(`  ${quote(id)} [${attrs.join(", ")}];`);
	}

	// Emit visible primary edges
	if (visiblePrimaryEdges.length > 0) {
		lines.push("");
		for (const [, val] of visiblePrimaryEdges) {
			if (val.status === "added") {
				lines.push(
					`  ${quote(val.from)} -> ${quote(val.to)} [color="#28a745"];`,
				);
			} else {
				lines.push(
					`  ${quote(val.from)} -> ${quote(val.to)} [color="#dc3545", style=dashed];`,
				);
			}
		}
	}

	// Emit visible feedback edges
	if (visibleFeedbackEdges.length > 0) {
		if (visiblePrimaryEdges.length === 0) lines.push("");
		for (const [, val] of visibleFeedbackEdges) {
			if (val.status === "added") {
				lines.push(
					`  ${quote(val.artifact)} -> ${quote(val.process)} [style=dashed, color="#28a745", constraint=false];`,
				);
			} else {
				lines.push(
					`  ${quote(val.artifact)} -> ${quote(val.process)} [style=dashed, color="#dc3545", constraint=false];`,
				);
			}
		}
	}

	lines.push("}");
	return `${lines.join("\n")}\n`;
}

function nodeAttrs(
	id: string,
	kind: NodeKind,
	fm: Frontmatter | null,
	boundaryArtifacts: Set<string> = new Set(),
): string {
	const shape = kind === "process" ? "ellipse" : "box";
	const meta = lookupMeta(id, kind, fm);
	const nodeLabel = meta?.label;
	const description = meta?.description;
	const ameta =
		kind === "artifact" ? (meta as ArtifactMeta | undefined) : undefined;
	const criteria = ameta?.criteria;
	const locationRaw = ameta?.location;
	const locationArray: string[] | undefined =
		typeof locationRaw === "string"
			? [locationRaw]
			: Array.isArray(locationRaw) && locationRaw.length > 0
				? (locationRaw as string[])
				: undefined;
	const location = locationArray?.join(", ");
	const revises = ameta?.revises;

	const maxWidth =
		typeof fm?.layout?.maxWidth === "number" ? fm.layout.maxWidth : undefined;
	const wrappedNodeLabel =
		nodeLabel && maxWidth ? wrapLabel(nodeLabel, maxWidth) : nodeLabel;
	const label = wrappedNodeLabel ? `${id}\n${wrappedNodeLabel}` : id;

	const wrappingOccurred = wrappedNodeLabel !== nodeLabel;
	const originalLabel = nodeLabel ?? id;

	const tooltipParts: string[] = [originalLabel];
	if (description) tooltipParts.push(`\n\n${description}`);

	const KNOWN_TOOLTIP_SKIP = new Set([
		"label", // shown as node label
		"description", // rendered first with double newline
		"status", // shown as node color and xlabel
		"tags", // shown as xlabel
		"group", // shown as cluster border
		"parts", // structural — child nodes are visible in graph
		"location", // appended last with dedicated formatting
		"boundary", // subflow id remapping — not human-readable as-is
	]);
	const knownFields: [string, string][] = [];
	if (criteria) knownFields.push(["criteria", criteria]);
	if (revises) knownFields.push(["revises", revises]);
	if (typeof meta?.owner === "string") knownFields.push(["owner", meta.owner]);
	if (typeof (meta as ProcessMeta | undefined)?.command === "string")
		knownFields.push(["command", (meta as ProcessMeta).command!]);
	if (typeof (meta as ProcessMeta | undefined)?.subflow === "string")
		knownFields.push(["subflow", (meta as ProcessMeta).subflow!]);
	const extraFields: [string, string][] = meta
		? Object.entries(meta)
				.filter(([k, v]) => {
					if (KNOWN_TOOLTIP_SKIP.has(k)) return false;
					if (knownFields.some(([kf]) => kf === k)) return false;
					if (typeof v === "string") return true;
					if (
						Array.isArray(v) &&
						v.length > 0 &&
						v.every((i) => typeof i === "string")
					)
						return true;
					return false;
				})
				.map(([k, v]) => [
					k,
					Array.isArray(v) ? (v as string[]).join(", ") : (v as string),
				])
		: [];

	for (const [key, val] of [...knownFields, ...extraFields]) {
		const formatted = val.includes("\n")
			? `\n${key}:\n${val
					.split("\n")
					.map((l) => `  ${l}`)
					.join("\n")}`
			: `\n${key}: ${val}`;
		tooltipParts.push(formatted);
	}

	if (location) tooltipParts.push(`\nlocation: ${location}`);
	const tooltip =
		tooltipParts.length > 1
			? tooltipParts.join("")
			: wrappingOccurred
				? originalLabel
				: undefined;

	const styleAttrs = resolveStyleAttrs(id, kind, fm);
	const xlabel = buildXlabel(id, kind, fm);
	const firstLoc = locationArray?.[0];
	const singleUrl =
		locationArray?.length === 1 && firstLoc?.includes("://")
			? firstLoc
			: undefined;

	const minWidth = calcMinWidth(label);
	const attrs: string[] = [`shape=${shape}`, `label=${quote(label)}`];
	if (tooltip !== undefined) attrs.push(`tooltip=${quote(tooltip)}`);
	if (singleUrl) attrs.push(`href=${quote(singleUrl)}`);
	if (minWidth !== undefined) attrs.push(`width=${minWidth.toFixed(2)}`);
	if (xlabel !== undefined) attrs.push(`xlabel=${quote(xlabel)}`);
	for (const key of STYLE_ATTRS) {
		const v = styleAttrs[key];
		if (v !== undefined) attrs.push(`${key}=${quote(v)}`);
	}
	if (
		kind === "artifact" &&
		boundaryArtifacts.has(id) &&
		styleAttrs.penwidth === undefined
	) {
		attrs.push(`penwidth="2"`);
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
	} else {
		// status is artifact-only; processes carry tags only
		const meta = fm.process?.[id];
		for (const tag of meta?.tags ?? []) parts.push(tag);
	}
	return parts.length > 0 ? parts.join(", ") : undefined;
}

function resolveStyleAttrs(
	id: string,
	kind: NodeKind,
	fm: Frontmatter | null,
): NodeStyle {
	if (!fm) return {};
	const meta = kind === "artifact" ? fm.artifact?.[id] : fm.process?.[id];
	const styleAttrs: NodeStyle = {};
	// tags reverse iter: later Object.assign wins → first tag in array prevails
	const tags = meta?.tags ?? [];
	for (let i = tags.length - 1; i >= 0; i--) {
		const tag = tags[i];
		if (tag !== undefined)
			Object.assign(styleAttrs, fm.tag?.[tag]?.style ?? {});
	}
	// status is artifact-only and applied last to win over tags
	if (kind === "artifact") {
		const status = (meta as ArtifactMeta | undefined)?.status;
		if (status) Object.assign(styleAttrs, fm.statusStyles?.[status] ?? {});
	}
	return styleAttrs;
}

function lookupMeta(
	id: string,
	kind: NodeKind,
	fm: Frontmatter | null,
): ArtifactMeta | ProcessMeta | undefined {
	if (!fm) return undefined;
	return kind === "process" ? fm.process?.[id] : fm.artifact?.[id];
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPuppeteer = any;

export type BinaryFormat = "pdf" | "png";

export async function svgToBinary(
	svg: string,
	format: BinaryFormat,
): Promise<Buffer> {
	const puppeteer: AnyPuppeteer = await import("puppeteer").catch(() => {
		throw new Error(
			`PDF/PNG export requires puppeteer. Install it with:\n  npm install puppeteer`,
		);
	});
	const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
	const parts = viewBoxMatch?.[1]?.split(/\s+/).map(Number);
	const width = parts?.[2] ?? 1200;
	const height = parts?.[3] ?? 800;
	const sandboxArgs =
		process.platform === "linux"
			? ["--no-sandbox", "--disable-setuid-sandbox"]
			: [];
	const browser = await puppeteer.default.launch({
		headless: true,
		args: sandboxArgs,
	});
	try {
		const page = await browser.newPage();
		await page.setContent(
			`<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:${width}px;height:${height}px;overflow:hidden}svg{display:block;width:${width}px;height:${height}px}</style></head><body>${svg}</body></html>`,
			{ waitUntil: "load" },
		);
		if (format === "pdf") {
			return await page.pdf({
				width: `${width}px`,
				height: `${height}px`,
				printBackground: true,
				margin: { top: 0, right: 0, bottom: 0, left: 0 },
				pageRanges: "1",
			});
		}
		await page.setViewport({
			width: Math.ceil(width),
			height: Math.ceil(height),
			deviceScaleFactor: 1,
		});
		return await page.screenshot({ type: "png" });
	} finally {
		try {
			await browser.close();
		} catch {
			// suppress close errors
		}
	}
}
