import type {
	ArtifactMeta,
	Frontmatter,
	NodeKind,
	NodeStyle,
	ProcessMeta,
} from "@pfdsl/core";
import { resolveMeta, STYLE_ATTRS } from "@pfdsl/core";
import { wrapLabel } from "./label.js";

export const DEFAULT_FEEDBACK_COLOR = "#888888";

export const QUOTE_BACKSLASH_RE = /\\/g;
export const QUOTE_DQUOTE_RE = /"/g;
export const QUOTE_NEWLINE_RE = /\n/g;

const CJK_RE = /[　-鿿豈-﫿！-｠]/u;

export function quote(s: string): string {
	return (
		'"' +
		s
			.replace(QUOTE_BACKSLASH_RE, "\\\\")
			.replace(QUOTE_DQUOTE_RE, '\\"')
			.replace(QUOTE_NEWLINE_RE, "\\n") +
		'"'
	);
}

// @hpcc-js/wasm Graphviz has no CJK font metrics → measures CJK chars as ASCII width.
// Compute a minimum node width so the rendered SVG doesn't clip Japanese labels.
export function calcMinWidth(label: string): number | undefined {
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

export function darkenHex(color: string, factor = 0.7): string | undefined {
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

export function buildXlabel(
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
	} else if (kind === "process") {
		// status is artifact-only; processes carry tags only
		const meta = fm.process?.[id];
		for (const tag of meta?.tags ?? []) parts.push(tag);
	}
	// group: no status or tags to display
	return parts.length > 0 ? parts.join(", ") : undefined;
}

export function resolveStyleAttrs(
	id: string,
	kind: NodeKind,
	fm: Frontmatter | null,
): NodeStyle {
	if (!fm) return {};
	if (kind === "group") return {};
	const meta = resolveMeta(fm, kind, id) as
		| ArtifactMeta
		| ProcessMeta
		| undefined;
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

export function nodeAttrs(
	id: string,
	kind: NodeKind,
	fm: Frontmatter | null,
	boundaryArtifacts: Set<string> = new Set(),
): string {
	const shape = kind === "process" ? "ellipse" : "box";
	const meta = resolveMeta(fm, kind, id);
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
	if (
		kind === "process" &&
		typeof (meta as ProcessMeta | undefined)?.subflow === "string"
	) {
		attrs.push(`peripheries="2"`);
	}
	return `[${attrs.join(", ")}]`;
}
