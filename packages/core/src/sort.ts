import { isMap, isScalar, type Pair, type YAMLMap } from "yaml";
import { compareIds } from "./compare.js";
import {
	parseFrontmatterCst,
	renderFrontmatterCst,
} from "./frontmatter-cst.js";
import { analyze } from "./index.js";
import { computeTopoOrder } from "./sorter.js";
import type { Diagnostic, NodeKind } from "./types/index.js";

export type SortKey = "index" | "topological" | "group" | "id";

export interface SortOptions {
	by: SortKey[];
}

export interface SortResult {
	output: string;
	changed: boolean;
	diagnostics: Diagnostic[];
}

/** The node id a `Pair`'s key represents, or "" when the key isn't a plain scalar. */
function pairId(pair: Pair): string {
	return isScalar(pair.key) ? String(pair.key.value) : "";
}

/**
 * `yaml` attaches a leading comment/blank-line immediately after the section
 * header to the map itself, but only for the very first entry — every other
 * entry carries its own leading comment/blank-line on its key node. Move that
 * map-level trivia onto the current first entry's key so it travels with the
 * entry (rather than the position) once `map.items` is reordered; `yaml`
 * renders a non-first entry's leading comment/blank-line identically to a
 * first entry's, so this is a no-op on output when the first entry stays
 * first.
 */
function hoistLeadingTrivia(map: YAMLMap): void {
	const first = map.items[0];
	if (!first || !isScalar(first.key)) return;
	if (map.commentBefore != null) {
		first.key.commentBefore = first.key.commentBefore
			? `${map.commentBefore}\n${first.key.commentBefore}`
			: map.commentBefore;
		map.commentBefore = null;
	}
	if (map.spaceBefore) {
		first.key.spaceBefore = true;
		map.spaceBefore = false;
	}
}

/**
 * Reorder nodes within the frontmatter `artifact:`/`process:` sections by one
 * or more sort keys. Applied through the frontmatter yaml CST (ADR-0034):
 * each section's `YAMLMap.items` (an array of `Pair`s) is stable-sorted and
 * reassigned in place, so per-node comments, quote style, and flow-vs-block
 * choice — for both individual nodes and whole sections written as a single
 * flow-style line — survive untouched.
 */
export function sort(source: string, opts: SortOptions): SortResult {
	const { edges, graph, nodeKinds, frontmatter, diagnostics } = analyze(source);
	if (diagnostics.some((d) => d.severity === "error")) {
		return { output: source, changed: false, diagnostics };
	}

	// Compute topological order only when needed.
	const topoOrder = new Map<string, number>();
	if (opts.by.includes("topological")) {
		const order = computeTopoOrder(edges, graph, frontmatter);
		for (const [rank, id] of order.entries()) topoOrder.set(id, rank);
	}

	const kindOf = (id: string): NodeKind => nodeKinds.get(id) ?? "artifact";

	const getGroup = (id: string): string | null => {
		const kind = kindOf(id);
		const meta =
			kind === "artifact"
				? frontmatter?.artifact?.[id]
				: frontmatter?.process?.[id];
		return typeof meta?.group === "string" ? meta.group : null;
	};

	const getSortValue = (
		id: string,
		key: Exclude<SortKey, "group">,
	): string | number => {
		const kind = kindOf(id);
		const meta =
			kind === "artifact"
				? frontmatter?.artifact?.[id]
				: frontmatter?.process?.[id];

		switch (key) {
			case "index":
				return typeof meta?.index === "number"
					? meta.index
					: Number.MAX_SAFE_INTEGER;
			case "topological":
				return topoOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
			case "id":
				return id;
		}
	};

	const cst = parseFrontmatterCst(source);
	if (!cst.present) {
		return { output: source, changed: false, diagnostics };
	}

	let anyChanged = false;
	for (const section of ["artifact", "process"] as const) {
		const map = cst.doc.get(section, true);
		if (!isMap(map) || map.items.length === 0) continue;

		const indexed = map.items.map((item, idx) => ({
			item,
			idx,
			id: pairId(item as Pair),
		}));

		indexed.sort((a, b) => {
			for (const key of opts.by) {
				let cmp: number;
				if (key === "group") {
					const ga = getGroup(a.id);
					const gb = getGroup(b.id);
					// nodes without a group always sort after nodes with a group
					if (ga === null && gb === null) cmp = 0;
					else if (ga === null) cmp = 1;
					else if (gb === null) cmp = -1;
					else cmp = compareIds(ga, gb);
				} else {
					const va = getSortValue(a.id, key);
					const vb = getSortValue(b.id, key);
					if (typeof va === "number" && typeof vb === "number") {
						cmp = va - vb;
					} else {
						cmp = compareIds(String(va), String(vb));
					}
				}
				if (cmp !== 0) return cmp;
			}
			return a.idx - b.idx;
		});

		const orderChanged = indexed.some((x, i) => x.idx !== i);
		if (!orderChanged) continue;

		hoistLeadingTrivia(map);
		map.items = indexed.map((x) => x.item);
		anyChanged = true;
	}

	if (!anyChanged) {
		return { output: source, changed: false, diagnostics };
	}

	const output = renderFrontmatterCst(cst.doc) + cst.body;
	return { output, changed: true, diagnostics };
}
