import type { Frontmatter, Graph, NodeKind } from "@pfdsl/core";
import { diffGraphs, resolveMeta } from "@pfdsl/core";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPuppeteer = any;

export type BinaryFormat = "pdf" | "png";

export async function svgToBinary(
	svg: string,
	format: BinaryFormat,
): Promise<Buffer> {
	const puppeteer: AnyPuppeteer = await import("puppeteer").catch(() => {
		throw new Error(
			`PDF/PNG export requires puppeteer, installed into the same Node/npm environment as the pfdsl CLI. Install it with:\n  npm install puppeteer\nIf pfdsl is a global install under a Node version manager (nvm/nodenv/volta), a different Node version's global will not be resolved — install into the CLI's own environment, e.g.:\n  nodenv exec npm install -g puppeteer`,
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
