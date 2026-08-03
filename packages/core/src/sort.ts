import { isMap, isScalar, type Node, type Pair, type YAMLMap } from "yaml";
import { compareIds } from "./compare.js";
import {
	applySplices,
	parseFrontmatterCst,
	type Splice,
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
 * The byte offset where `section`'s body begins — the start of the line
 * right after the section header (`artifact:` or `artifact: # comment`).
 * yaml attaches any comment/blank-line immediately after the header to the
 * map itself rather than to the first entry's key, so `map.range[0]` skips
 * past it; anchoring on the header line's own end instead means the first
 * entry's splice range naturally includes that leading trivia without
 * needing to touch yaml's comment-attribution model at all.
 */
function sectionBodyStart(
	yamlText: string,
	rootItems: readonly Pair[],
	section: string,
): number {
	const topPair = rootItems.find(
		(p) => isScalar(p.key) && p.key.value === section,
	) as Pair;
	const keyRange = (topPair.key as { range: [number, number, number] }).range;
	return yamlText.indexOf("\n", keyRange[1]) + 1;
}

/**
 * Compute the splice that reorders `section`'s entries by `compare`. Each
 * entry's own byte range runs from the previous entry's end (or the
 * section body's start, for the first entry) to its own value's end — so
 * leading comments/blank lines travel with the entry that follows them,
 * and no entry's own text is ever re-serialized. Returns null when the
 * section is absent, empty, or already in the target order.
 *
 * Block-style and flow-style sections use fundamentally different
 * separator grammars — a block-style section's entries are `\n`-delimited
 * (and a block-style value's range end already includes its own trailing
 * newline, unlike a flow-style value's), while a whole section written as
 * a single flow-style line (`artifact: { a: {...}, b: {...} }`) delimits
 * entries with `, ` and has no `\n` inside it at all — so `map.flow`
 * branches into two independent assembly strategies rather than forcing
 * one `\n`-shaped join to cover both.
 *
 * In the block-style branch, reassembling by position (not by original
 * array index) has to re-derive the separators from the actual bytes
 * rather than assume every non-first entry's bound already carries one: an
 * entry's leading newline is dropped when the original byte just before
 * its bound wasn't itself a newline (i.e. the newline inside the slice is
 * only a flow-value separator artifact, not meaningful trivia like a blank
 * line), and a single newline is (re)inserted between two adjacent parts
 * only when neither supplies one at the join.
 */
function sortSplice(
	yamlText: string,
	rootItems: readonly Pair[],
	map: YAMLMap,
	section: string,
	compare: (a: string, b: string) => number,
	newline: "\n" | "\r\n",
): Splice | null {
	if (map.items.length === 0) return null;

	if (map.flow) {
		const openBrace = (map.range as [number, number, number])[0];
		// map.range[1] includes the closing brace itself — excluded from the
		// spliced range so the original brace text is left untouched.
		const closeBrace = (map.range as [number, number, number])[1] - 1;
		const bounds = (map.items as Pair[]).map((item, i) => {
			const prev = map.items[i - 1] as Pair | undefined;
			const start = prev
				? ((prev.value as Node).range as [number, number, number])[1]
				: openBrace + 1;
			const end = ((item.value as Node).range as [number, number, number])[1];
			return { id: pairId(item), start, end };
		});
		const order = [...bounds].sort((a, b) => compare(a.id, b.id));
		const changed = order.some((b, i) => b !== bounds[i]);
		if (!changed) return null;
		const parts = order.map((b) => {
			// A leading ", " (or bare whitespace right after the opening brace)
			// is a structural separator, not part of the entry's own content —
			// strip it here and let `join(", ")` re-supply it below.
			return yamlText
				.slice(b.start, b.end)
				.replace(/^,\s*/, "")
				.replace(/^\s+/, "");
		});
		const replacement = ` ${parts.join(", ")} `;
		return { start: openBrace + 1, end: closeBrace, replacement };
	}

	const bodyStart = sectionBodyStart(yamlText, rootItems, section);
	const bounds = (map.items as Pair[]).map((item, i) => {
		const prev = map.items[i - 1] as Pair | undefined;
		const start = prev
			? ((prev.value as Node).range as [number, number, number])[1]
			: bodyStart;
		const end = ((item.value as Node).range as [number, number, number])[1];
		return { id: pairId(item), start, end };
	});
	const order = [...bounds].sort((a, b) => compare(a.id, b.id));
	const changed = order.some((b, i) => b !== bounds[i]);
	if (!changed) return null;

	const end = (map.range as [number, number, number])[1];
	const parts = order.map((b) => {
		let part = yamlText.slice(b.start, b.end);
		const precededByNewlineOriginally =
			yamlText.slice(Math.max(0, b.start - newline.length), b.start) ===
			newline;
		if (!precededByNewlineOriginally && part.startsWith(newline)) {
			part = part.slice(newline.length);
		}
		return part;
	});

	let replacement = "";
	for (const part of parts) {
		if (
			replacement.length > 0 &&
			!replacement.endsWith(newline) &&
			!part.startsWith(newline)
		) {
			replacement += newline;
		}
		replacement += part;
	}
	// The original text right after the splice's own end (whatever follows
	// `map.range[1]` — a following top-level key's own leading bytes, or
	// nothing when this section is the last thing in `yamlText`, in which
	// case the closing fence's own newline is appended later by `sort()`'s
	// template) tells us whether a separator is still needed here. Append
	// one only when something actually follows within `yamlText` and it
	// doesn't already start with a newline — mirroring the leading-boundary
	// check above. Skipping the empty-remainder case is what a flow-valued
	// last entry (whose own range doesn't end in a newline) needs: without
	// it, this would stack a second, spurious newline on top of the one
	// `sort()`'s template already supplies before `---`.
	const remainder = yamlText.slice(end);
	if (
		!replacement.endsWith(newline) &&
		remainder.length > 0 &&
		!remainder.startsWith(newline)
	) {
		replacement += newline;
	}

	return {
		start: bodyStart,
		end,
		replacement,
	};
}

/**
 * Reorder nodes within the frontmatter `artifact:`/`process:` sections by one
 * or more sort keys. Splices each section's entries directly into the
 * source (ADR-0034 / frontmatter-cst-splice-design): every entry's own
 * bytes — comments, quote style, flow-vs-block choice, folded-scalar line
 * wraps — survive untouched, whether or not that entry itself moved.
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

	const compare = (a: string, b: string): number => {
		for (const key of opts.by) {
			let cmp: number;
			if (key === "group") {
				const ga = getGroup(a);
				const gb = getGroup(b);
				// nodes without a group always sort after nodes with a group
				if (ga === null && gb === null) cmp = 0;
				else if (ga === null) cmp = 1;
				else if (gb === null) cmp = -1;
				else cmp = compareIds(ga, gb);
			} else {
				const va = getSortValue(a, key);
				const vb = getSortValue(b, key);
				cmp =
					typeof va === "number" && typeof vb === "number"
						? va - vb
						: compareIds(String(va), String(vb));
			}
			if (cmp !== 0) return cmp;
		}
		return 0;
	};

	const cst = parseFrontmatterCst(source);
	if (!cst.present) {
		return { output: source, changed: false, diagnostics };
	}

	const rootItems = (
		isMap(cst.doc.contents) ? cst.doc.contents.items : []
	) as Pair[];
	const splices: Splice[] = [];
	for (const section of ["artifact", "process"] as const) {
		const map = cst.doc.get(section, true);
		if (!isMap(map)) continue;
		const splice = sortSplice(
			cst.yamlText,
			rootItems,
			map,
			section,
			compare,
			cst.newline,
		);
		if (splice) splices.push(splice);
	}

	if (splices.length === 0) {
		return { output: source, changed: false, diagnostics };
	}

	const newYamlText = applySplices(cst.yamlText, splices);
	const output = `---${cst.newline}${newYamlText}${cst.newline}---${cst.newline}${cst.body}`;
	return { output, changed: true, diagnostics };
}
