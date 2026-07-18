import type { Graph, NodeKind } from "./types/index.js";

export interface Neighbors {
	/** Nodes with a primary edge pointing into this node. */
	predecessors: string[];
	/** Nodes this node has a primary edge pointing to. */
	successors: string[];
}

function buildAdjacency(graph: Graph): {
	out: Map<string, string[]>;
	in: Map<string, string[]>;
} {
	const out = new Map<string, string[]>();
	const inn = new Map<string, string[]>();
	for (const e of graph.primaryEdges) {
		const outArr = out.get(e.from);
		if (outArr) outArr.push(e.to);
		else out.set(e.from, [e.to]);
		const inArr = inn.get(e.to);
		if (inArr) inArr.push(e.from);
		else inn.set(e.to, [e.from]);
	}
	return { out, in: inn };
}

/** Direct producer/consumer neighbors of a node — the immediate in/out edges only (§ issue #479 `neighbors`). */
export function computeNeighbors(graph: Graph, id: string): Neighbors {
	const { out, in: inn } = buildAdjacency(graph);
	return {
		predecessors: inn.get(id) ?? [],
		successors: out.get(id) ?? [],
	};
}

function closure(adjacency: Map<string, string[]>, id: string): string[] {
	const seen = new Set<string>();
	const stack = [...(adjacency.get(id) ?? [])];
	while (stack.length > 0) {
		const next = stack.pop();
		if (next === undefined || seen.has(next)) continue;
		seen.add(next);
		stack.push(...(adjacency.get(next) ?? []));
	}
	return [...seen];
}

/** Full downstream closure reachable from `id` via primary edges, excluding `id` itself. */
export function computeImpact(graph: Graph, id: string): string[] {
	return closure(buildAdjacency(graph).out, id);
}

/** Full upstream closure `id` depends on via primary edges, excluding `id` itself. */
export function computeDependsOn(graph: Graph, id: string): string[] {
	return closure(buildAdjacency(graph).in, id);
}

/**
 * All simple paths from `from` to `to` via primary edges (the primary graph
 * is a DAG per V010, so this terminates without a visited-set on the walk).
 * Returns `[[from]]` when `from === to` and the node exists, `[]` when no
 * path exists.
 */
export function computePaths(
	graph: Graph,
	from: string,
	to: string,
): string[][] {
	if (!graph.nodes.has(from) || !graph.nodes.has(to)) return [];
	if (from === to) return [[from]];
	const { out } = buildAdjacency(graph);
	const paths: string[][] = [];
	const walk = (node: string, path: string[]): void => {
		for (const next of out.get(node) ?? []) {
			const nextPath = [...path, next];
			if (next === to) paths.push(nextPath);
			else walk(next, nextPath);
		}
	};
	walk(from, [from]);
	return paths;
}

export interface NodeStats {
	id: string;
	kind: NodeKind;
	fanIn: number;
	fanOut: number;
}

/** Fan-in/fan-out per node, ranked by total degree descending then id ascending (§ issue #479 `hubs`/`stats`). */
export function computeStats(graph: Graph): NodeStats[] {
	const { out, in: inn } = buildAdjacency(graph);
	const stats: NodeStats[] = [...graph.nodes.entries()].map(([id, kind]) => ({
		id,
		kind,
		fanIn: inn.get(id)?.length ?? 0,
		fanOut: out.get(id)?.length ?? 0,
	}));
	stats.sort((a, b) => {
		const degreeDiff = b.fanIn + b.fanOut - (a.fanIn + a.fanOut);
		return degreeDiff !== 0 ? degreeDiff : a.id.localeCompare(b.id);
	});
	return stats;
}
