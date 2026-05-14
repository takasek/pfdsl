import type { NormalizedEdge } from "./types/index.js";

export function formatEdges(
	sortedEdges: NormalizedEdge[],
	sortedIsolated: string[] = [],
): string {
	const lines: string[] = [];
	for (const e of sortedEdges) {
		if (e.kind === "input") lines.push(`${e.artifact} >> ${e.process}`);
		else if (e.kind === "feedback")
			lines.push(`${e.artifact} >>? ${e.process}`);
		else lines.push(`${e.process} -> ${e.artifact}`);
	}
	for (const id of sortedIsolated) lines.push(id);
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
		return diff !== 0 ? diff : a.localeCompare(b);
	});

	const lines: string[] = [];
	for (const proc of processOrder) {
		const { inputs, outputs, feedbacks } = byProcess.get(proc)!;
		for (const fb of feedbacks) lines.push(`${fb} >>? ${proc}`);
		if (inputs.length === 0 && outputs.length === 0) continue;
		const fmtIds = (ids: string[]) =>
			ids.length === 1 ? ids[0]! : `[${ids.join(", ")}]`;
		let stmt = inputs.length > 0 ? `${fmtIds(inputs)} >> ${proc}` : proc;
		if (outputs.length > 0) stmt += ` -> ${fmtIds(outputs)}`;
		lines.push(stmt);
	}

	for (const id of sortedIsolated) lines.push(id);
	if (lines.length === 0) return "";
	return `${lines.join("\n")}\n`;
}
