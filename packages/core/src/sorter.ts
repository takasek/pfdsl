import type { Frontmatter, Graph, NormalizedEdge } from "./types/index.js";

export function sortIsolated(isolatedNodes: Set<string>): string[] {
	return [...isolatedNodes].sort();
}

/**
 * Deterministic topological node order: first appearance across the
 * canonical edge sort (feedback edges are skipped — they carry no rank),
 * then any remaining declared/isolated nodes by id.
 */
export function computeTopoOrder(
	edges: NormalizedEdge[],
	graph: Graph,
	frontmatter: Frontmatter | null | undefined,
): string[] {
	const order: string[] = [];
	const seen = new Set<string>();
	const push = (id: string) => {
		if (!seen.has(id)) {
			seen.add(id);
			order.push(id);
		}
	};
	for (const e of sortEdges(edges, graph)) {
		if (e.kind === "input") {
			push(e.artifact);
			push(e.process);
		} else if (e.kind === "output") {
			push(e.process);
			push(e.artifact);
		}
	}
	const remaining = new Set([
		...graph.nodes.keys(),
		...Object.keys(frontmatter?.artifact ?? {}),
		...Object.keys(frontmatter?.process ?? {}),
	]);
	for (const id of [...remaining].sort()) push(id);
	return order;
}

export function sortEdges(
	edges: NormalizedEdge[],
	graph: Graph,
): NormalizedEdge[] {
	// Union-Find for connected components (primary graph, undirected)
	const parent = new Map<string, string>();

	function find(x: string): string {
		if (!parent.has(x)) parent.set(x, x);
		const p = parent.get(x) ?? x;
		if (p === x) return x;
		const root = find(p);
		parent.set(x, root);
		return root;
	}

	function union(x: string, y: string): void {
		const rx = find(x),
			ry = find(y);
		if (rx !== ry) parent.set(rx, ry);
	}

	for (const e of graph.primaryEdges) union(e.from, e.to);

	// Min node ID per component
	const componentMin = new Map<string, string>();
	for (const nodeId of graph.nodes.keys()) {
		const root = find(nodeId);
		const cur = componentMin.get(root);
		if (cur === undefined || nodeId < cur) componentMin.set(root, nodeId);
	}

	function componentKey(nodeId: string): string {
		return componentMin.get(find(nodeId)) ?? nodeId;
	}

	// Rank = longest-path distance from any source. Computed via Kahn's
	// topological order in O(V + E). Nodes left unranked (cycles in the primary
	// graph — already a validation error) fall back to 0.
	const inDegree = new Map<string, number>();
	const adjacency = new Map<string, string[]>();
	for (const id of graph.nodes.keys()) {
		inDegree.set(id, 0);
		adjacency.set(id, []);
	}
	for (const e of graph.primaryEdges) {
		inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
		adjacency.get(e.from)?.push(e.to);
	}

	const ranks = new Map<string, number>();
	const queue: string[] = [];
	for (const [id, deg] of inDegree) {
		if (deg === 0) {
			ranks.set(id, 0);
			queue.push(id);
		}
	}

	for (let head = 0; head < queue.length; head++) {
		const u = queue[head]!;
		const ru = ranks.get(u)!;
		for (const v of adjacency.get(u)!) {
			const rv = ranks.get(v) ?? -1;
			if (ru + 1 > rv) ranks.set(v, ru + 1);
			const remaining = inDegree.get(v)! - 1;
			inDegree.set(v, remaining);
			if (remaining === 0) queue.push(v);
		}
	}

	for (const id of graph.nodes.keys()) {
		if (!ranks.has(id)) ranks.set(id, 0);
	}

	function edgeRank(e: NormalizedEdge): number {
		if (e.kind === "input") return ranks.get(e.artifact) ?? 0;
		if (e.kind === "feedback") return ranks.get(e.process) ?? 0;
		/* output */ return ranks.get(e.process) ?? 0;
	}

	function edgeKindOrder(e: NormalizedEdge): number {
		if (e.kind === "input") return 0;
		if (e.kind === "feedback") return 1;
		/* output */ return 2;
	}

	function edgeLexKey(e: NormalizedEdge): string {
		return e.kind === "output"
			? `${e.process}\0${e.artifact}`
			: `${e.artifact}\0${e.process}`;
	}

	const compKeys = new Map<NormalizedEdge, string>();
	for (const e of edges) {
		const ref = e.kind === "output" ? e.process : e.artifact;
		compKeys.set(e, componentKey(ref));
	}

	return [...edges].sort((a, b) => {
		const ck = compKeys.get(a)!.localeCompare(compKeys.get(b)!);
		if (ck !== 0) return ck;
		const rk = edgeRank(a) - edgeRank(b);
		if (rk !== 0) return rk;
		const kk = edgeKindOrder(a) - edgeKindOrder(b);
		if (kk !== 0) return kk;
		return edgeLexKey(a).localeCompare(edgeLexKey(b));
	});
}
