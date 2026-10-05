import type { Frontmatter, Graph, NodeKind } from "@pfdsl/core";
import { compareIds, diffGraphsDetailed, resolveMeta } from "@pfdsl/core";
import { wrapLabel } from "./label.js";
import {
	calcMinWidth,
	DEFAULT_FEEDBACK_COLOR,
	darkenHex,
	nodeAttrs,
	quote,
} from "./node-attrs.js";

export interface ExportOptions {
	/** Override rankdir; defaults to frontmatter.layout.direction or 'LR'. */
	rankdir?: "LR" | "RL" | "TB" | "BT";
	/** Color for feedback edges. Default '#888888'. */
	feedbackColor?: string;
	/** Title for the graph; defaults to frontmatter.title. */
	graphLabel?: string;
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
		if (graph.nodes.get(id) === "group") continue; // group IDs are subgraph containers, not nodes
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
		const clusterId = `cluster_${gid}`;
		const dotId = /^[A-Za-z_][A-Za-z0-9_]*$/.test(clusterId)
			? clusterId
			: quote(clusterId);
		lines.push(`${indent}subgraph ${dotId} {`);
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
	const { report, primaryEdges, feedbackEdges } = diffGraphsDetailed(
		a,
		b,
		fmA,
		fmB,
	);

	const added = new Set(report.addedNodes);
	const removed = new Set(report.removedNodes);
	const changed = new Set(report.changedNodes);

	// Visible nodes
	const visibleNodes = new Set<string>([...added, ...removed, ...changed]);
	for (const val of primaryEdges) {
		if (val.status === "added" || val.status === "removed") {
			visibleNodes.add(val.from);
			visibleNodes.add(val.to);
		}
	}
	for (const val of feedbackEdges) {
		if (val.status === "added" || val.status === "removed") {
			visibleNodes.add(val.artifact);
			visibleNodes.add(val.process);
		}
	}

	// Visible edges (added & removed only)
	const visiblePrimaryEdges = primaryEdges
		.filter((val) => val.status !== "unchanged")
		.sort(
			(a, b) =>
				compareIds(`${a.from} -> ${a.to}`, `${b.from} -> ${b.to}`) ||
				compareIds(a.from, b.from) ||
				compareIds(a.to, b.to),
		);

	const visibleFeedbackEdges = feedbackEdges
		.filter((val) => val.status !== "unchanged")
		.sort(
			(a, b) =>
				compareIds(
					`${a.artifact} -> ${a.process}`,
					`${b.artifact} -> ${b.process}`,
				) ||
				compareIds(a.artifact, b.artifact) ||
				compareIds(a.process, b.process),
		);

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
	if (
		visibleNodes.size === 0 &&
		visiblePrimaryEdges.length === 0 &&
		visibleFeedbackEdges.length === 0
	) {
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
		const kind: NodeKind | undefined = b.nodes.get(id) ?? a.nodes.get(id);
		if (kind === undefined) continue;

		const fm = removed.has(id) ? fmA : fmB;
		const meta = resolveMeta(fm, kind, id);
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
		for (const val of visiblePrimaryEdges) {
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
		for (const val of visibleFeedbackEdges) {
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
