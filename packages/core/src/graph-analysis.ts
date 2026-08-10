import { compareIds } from "./compare.js";
import type { Graph, NodeKind } from "./types/index.js";

export interface GraphNeighbor {
	id: string;
	/** `primary` for `>>` / `->`, `feedback` for `>>?`. */
	kind: "primary" | "feedback";
}

export interface Neighbors {
	/** Nodes with an edge pointing into this node. */
	predecessors: GraphNeighbor[];
	/** Nodes this node has an edge pointing to. */
	successors: GraphNeighbor[];
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

/**
 * Direct producer/consumer neighbors of a node — the immediate in/out edges
 * only (§ issue #479 `neighbors`), `>>?` feedback edges included and tagged as
 * such (#828).
 *
 * The reachability queries below stay primary-only on purpose: they rest on
 * V010's guarantee that the primary graph is a DAG, which a walk over feedback
 * edges would break. `neighbors` takes one step rather than a closure, so that
 * argument does not reach it — and omitting feedback here hides the very edges
 * an audit of feedback wiring is looking for.
 */
export function computeNeighbors(graph: Graph, id: string): Neighbors {
	const { out, in: inn } = buildAdjacency(graph);
	const asPrimary = (n: string): GraphNeighbor => ({ id: n, kind: "primary" });
	const predecessors = (inn.get(id) ?? []).map(asPrimary);
	const successors = (out.get(id) ?? []).map(asPrimary);
	for (const e of graph.feedbackEdges) {
		if (e.process === id)
			predecessors.push({ id: e.artifact, kind: "feedback" });
		if (e.artifact === id) successors.push({ id: e.process, kind: "feedback" });
	}
	return { predecessors, successors };
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
	/** Primary (`>>` / `->`) in-edges. */
	fanIn: number;
	/** Primary out-edges. */
	fanOut: number;
	/** Feedback (`>>?`) in-edges, kept out of `fanIn`. */
	feedbackFanIn: number;
	/** Feedback out-edges, kept out of `fanOut`. */
	feedbackFanOut: number;
}

export interface GraphOrphan {
	id: string;
	kind: NodeKind;
}

/**
 * Nodes wired to nothing — no primary edge and no feedback edge (§518).
 *
 * Deliberately not `computeStats(...).filter(degree === 0)`, which is what
 * this used to be. That reading counted only primary edges and treated every
 * node kind alike, so it reported two shapes that are wired: a `group`, which
 * is a container and by construction never carries an edge, and a node held
 * only by `>>?`. Both are stable per-file false positives, and a check whose
 * output is mostly noise fails by going unread rather than by failing
 * (#676/#704).
 */
export function computeOrphans(graph: Graph): GraphOrphan[] {
	const wired = new Set<string>();
	for (const e of graph.primaryEdges) {
		wired.add(e.from);
		wired.add(e.to);
	}
	for (const e of graph.feedbackEdges) {
		wired.add(e.artifact);
		wired.add(e.process);
	}
	return [...graph.nodes.entries()]
		.filter(([id, kind]) => kind !== "group" && !wired.has(id))
		.map(([id, kind]) => ({ id, kind }))
		.sort((a, b) => compareIds(a.id, b.id));
}

/**
 * Fan-in/fan-out per node, ranked by total degree descending then id ascending
 * (§ issue #479 `hubs`/`stats`).
 *
 * Feedback (`>>?`) degree is reported in its own pair of fields and stays out
 * of both the primary counts and the sort key, because the command's readers
 * ask different questions of it (#831). Bottleneck ranking and the god-process
 * lens read fan-out as what a node gates or produces, and a feedback edge is
 * neither — `groupEdges` leaves it out of `processInputs`, so readiness never
 * waits on one. Hub detection for restructuring wants the connection counted;
 * reporting the two separately answers both without either reading the other's
 * number.
 */
export function computeStats(graph: Graph): NodeStats[] {
	const { out, in: inn } = buildAdjacency(graph);
	const feedbackIn = new Map<string, number>();
	const feedbackOut = new Map<string, number>();
	for (const e of graph.feedbackEdges) {
		feedbackIn.set(e.process, (feedbackIn.get(e.process) ?? 0) + 1);
		feedbackOut.set(e.artifact, (feedbackOut.get(e.artifact) ?? 0) + 1);
	}
	const stats: NodeStats[] = [...graph.nodes.entries()].map(([id, kind]) => ({
		id,
		kind,
		fanIn: inn.get(id)?.length ?? 0,
		fanOut: out.get(id)?.length ?? 0,
		feedbackFanIn: feedbackIn.get(id) ?? 0,
		feedbackFanOut: feedbackOut.get(id) ?? 0,
	}));
	stats.sort((a, b) => {
		const degreeDiff = b.fanIn + b.fanOut - (a.fanIn + a.fanOut);
		return degreeDiff !== 0 ? degreeDiff : compareIds(a.id, b.id);
	});
	return stats;
}
