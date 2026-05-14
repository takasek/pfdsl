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
	const processOrder: string[] = [];

	for (const e of sortedEdges) {
		let entry = byProcess.get(e.process);
		if (!entry) {
			entry = { inputs: [], outputs: [], feedbacks: [] };
			byProcess.set(e.process, entry);
			processOrder.push(e.process);
		}
		if (e.kind === "input") entry.inputs.push(e.artifact);
		else if (e.kind === "output") entry.outputs.push(e.artifact);
		else entry.feedbacks.push(e.artifact);
	}

	const lines: string[] = [];
	for (const proc of processOrder) {
		const { inputs, outputs, feedbacks } = byProcess.get(proc)!;
		for (const fb of feedbacks) lines.push(`${fb} >>? ${proc}`);
		if (inputs.length === 0 && outputs.length === 0) continue;
		let stmt = inputs.length > 0 ? `${inputs.join(", ")} >> ${proc}` : proc;
		if (outputs.length > 0) stmt += ` -> ${outputs.join(", ")}`;
		lines.push(stmt);
	}

	for (const id of sortedIsolated) lines.push(id);
	if (lines.length === 0) return "";
	return `${lines.join("\n")}\n`;
}
