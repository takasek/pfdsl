import { compareIds } from "./compare.js";
import type { NormalizedEdge } from "./types/index.js";

export type BodySegment =
	| { kind: "edges"; text: string }
	| { kind: "comment"; text: string };

const BARE_ID_RE = /^[\p{L}\p{N}_-]+$/u;

export function formatId(id: string): string {
	if (BARE_ID_RE.test(id)) return id;
	let escaped = "";
	for (const char of id) {
		if (char === "\\") escaped += "\\\\";
		else if (char === '"') escaped += '\\"';
		else if (char === "\n") escaped += "\\n";
		else if (char === "\t") escaped += "\\t";
		else escaped += char;
	}
	return `"${escaped}"`;
}

export function splitBodyIntoSegments(body: string): BodySegment[] {
	if (body === "") return [];
	const lines = body.split("\n");
	// split("\n") on "A\nB\n" gives ["A", "B", ""] — trailing empty is not a real line
	const hasTrailingNewline = body.endsWith("\n");
	const realLines = hasTrailingNewline ? lines.slice(0, -1) : lines;

	const segments: BodySegment[] = [];
	let current: BodySegment | null = null;

	for (const line of realLines) {
		const isComment = line === "" || line.startsWith("#");
		const kind: BodySegment["kind"] = isComment ? "comment" : "edges";
		if (current && current.kind === kind) {
			current.text += `${line}\n`;
		} else {
			if (current) segments.push(current);
			current = { kind, text: `${line}\n` };
		}
	}
	if (current) segments.push(current);
	return segments;
}

export function formatEdges(
	sortedEdges: NormalizedEdge[],
	sortedIsolated: string[] = [],
): string {
	const lines: string[] = [];
	for (const e of sortedEdges) {
		if (e.kind === "input")
			lines.push(`${formatId(e.artifact)} >> ${formatId(e.process)}`);
		else if (e.kind === "feedback")
			lines.push(`${formatId(e.artifact)} >>? ${formatId(e.process)}`);
		else lines.push(`${formatId(e.process)} -> ${formatId(e.artifact)}`);
	}
	for (const id of sortedIsolated) lines.push(formatId(id));
	if (lines.length === 0) return "";
	return `${lines.join("\n")}\n`;
}

interface ProcessEntry {
	inputs: string[];
	outputs: string[];
	feedbacks: string[];
}

export function formatAsFlows(
	sortedEdges: NormalizedEdge[],
	sortedIsolated: string[] = [],
): string {
	const byProcess = new Map<string, ProcessEntry>();

	for (const e of sortedEdges) {
		let entry = byProcess.get(e.process);
		if (!entry) {
			entry = { inputs: [], outputs: [], feedbacks: [] };
			byProcess.set(e.process, entry);
		}
		if (e.kind === "input") entry.inputs.push(e.artifact);
		else if (e.kind === "output") entry.outputs.push(e.artifact);
		else entry.feedbacks.push(e.artifact);
	}

	// Rank proxy: index of first output/feedback edge for each process.
	// Output/feedback edges sort by rank(process), giving a rank-ordered
	// sequence. Sink processes (no output/feedback) fall back to first
	// input edge index + offset, placing them last.
	const rankProxy = new Map<string, number>();
	const offset = sortedEdges.length;
	for (let i = 0; i < sortedEdges.length; i++) {
		const e = sortedEdges[i]!;
		if (e.kind !== "input" && !rankProxy.has(e.process)) {
			rankProxy.set(e.process, i);
		}
	}
	for (let i = 0; i < sortedEdges.length; i++) {
		const e = sortedEdges[i]!;
		if (e.kind === "input" && !rankProxy.has(e.process)) {
			rankProxy.set(e.process, i + offset);
		}
	}

	const processOrder = [...byProcess.keys()].sort((a, b) => {
		const diff =
			(rankProxy.get(a) ?? offset * 2) - (rankProxy.get(b) ?? offset * 2);
		return diff !== 0 ? diff : compareIds(a, b);
	});

	const lines: string[] = [];
	for (const proc of processOrder) {
		const { inputs, outputs, feedbacks } = byProcess.get(proc)!;
		for (const fb of feedbacks)
			lines.push(`${formatId(fb)} >>? ${formatId(proc)}`);
		if (inputs.length === 0 && outputs.length === 0) continue;
		const fmtIds = (ids: string[]) =>
			ids.length === 1
				? formatId(ids[0]!)
				: `[${ids.map((id) => formatId(id)).join(", ")}]`;
		let stmt =
			inputs.length > 0
				? `${fmtIds(inputs)} >> ${formatId(proc)}`
				: formatId(proc);
		if (outputs.length > 0) stmt += ` -> ${fmtIds(outputs)}`;
		lines.push(stmt);
	}

	for (const id of sortedIsolated) lines.push(formatId(id));
	if (lines.length === 0) return "";
	return `${lines.join("\n")}\n`;
}
