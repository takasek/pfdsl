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
 * The same two maps for feedback (`>>?`) edges: `out` from the artifact that
 * feeds back to the processes it reaches, `in` from the process to the
 * artifacts reaching it. Kept separate from `buildAdjacency` rather than folded
 * into it, because every reachability query below depends on the primary maps
 * holding primary edges alone.
 */
function buildFeedbackAdjacency(graph: Graph): {
	out: Map<string, string[]>;
	in: Map<string, string[]>;
} {
	const out = new Map<string, string[]>();
	const inn = new Map<string, string[]>();
	for (const e of graph.feedbackEdges) {
		const outArr = out.get(e.artifact);
		if (outArr) outArr.push(e.process);
		else out.set(e.artifact, [e.process]);
		const inArr = inn.get(e.process);
		if (inArr) inArr.push(e.artifact);
		else inn.set(e.process, [e.artifact]);
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
	const fb = buildFeedbackAdjacency(graph);
	const tag =
		(kind: GraphNeighbor["kind"]) =>
		(n: string): GraphNeighbor => ({ id: n, kind });
	return {
		predecessors: [
			...(inn.get(id) ?? []).map(tag("primary")),
			...(fb.in.get(id) ?? []).map(tag("feedback")),
		],
		successors: [
			...(out.get(id) ?? []).map(tag("primary")),
			...(fb.out.get(id) ?? []).map(tag("feedback")),
		],
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
	const fb = buildFeedbackAdjacency(graph);
	const wired = new Set<string>([...fb.in.keys(), ...fb.out.keys()]);
	for (const e of graph.primaryEdges) {
		wired.add(e.from);
		wired.add(e.to);
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
 * ask different questions of it (#831). Bottleneck ranking reads an artifact's
 * fan-out as how many processes it gates, and a feedback edge gates nothing —
 * `groupEdges` keeps it out of `processInputs`, so readiness never waits on
 * one. Hub detection for restructuring wants the connection counted. Reporting
 * the two apart answers both without either reading the other's number.
 *
 * A node's feedback degree is one-sided by construction: an edge's endpoints
 * are an artifact and a process, so an artifact only ever gains
 * `feedbackFanOut` and a process only `feedbackFanIn`. The god-process lens
 * therefore reads a process fan-out that folding feedback in would not have
 * touched — what it would have moved is that lens's ranking, not its column.
 */
export function computeStats(graph: Graph): NodeStats[] {
	const { out, in: inn } = buildAdjacency(graph);
	const fb = buildFeedbackAdjacency(graph);
	const stats: NodeStats[] = [...graph.nodes.entries()].map(([id, kind]) => ({
		id,
		kind,
		fanIn: inn.get(id)?.length ?? 0,
		fanOut: out.get(id)?.length ?? 0,
		feedbackFanIn: fb.in.get(id)?.length ?? 0,
		feedbackFanOut: fb.out.get(id)?.length ?? 0,
	}));
	stats.sort((a, b) => {
		const degreeDiff = b.fanIn + b.fanOut - (a.fanIn + a.fanOut);
		return degreeDiff !== 0 ? degreeDiff : compareIds(a.id, b.id);
	});
	return stats;
}
