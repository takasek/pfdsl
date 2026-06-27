import { analyze } from "./index.js";
import { sortEdges } from "./sorter.js";
import type { Diagnostic, NodeKind } from "./types/index.js";

export interface IndexChange {
	kind: NodeKind;
	id: string;
	/** Existing index, or null when the node had none. */
	from: number | null;
	to: number;
}

export interface ReindexResult {
	/** Source with index: assignments applied (unchanged on error). */
	output: string;
	/** Nodes whose index was assigned or changed (unchanged ones omitted). */
	changes: IndexChange[];
	diagnostics: Diagnostic[];
}

export interface ReindexOptions {
	/** Reassign every node from 1 (default: keep existing, fill only gaps). */
	renumber?: boolean;
}

interface Write {
	kind: NodeKind;
	id: string;
	value: number;
}

/**
 * Assign integer `index:` values to nodes in topological order, with
 * independent counters for processes and artifacts. Default mode fills only
 * nodes lacking an index; `renumber` reassigns all from 1. Edits are applied
 * surgically to the front matter text to preserve comments and formatting.
 */
export function reindex(
	source: string,
	opts: ReindexOptions = {},
): ReindexResult {
	const { edges, graph, nodeKinds, frontmatter, diagnostics } = analyze(source);
	if (diagnostics.some((d) => d.severity === "error")) {
		return { output: source, changes: [], diagnostics };
	}

	const kindOf = (id: string): NodeKind => {
		const k = nodeKinds.get(id);
		if (k) return k;
		return frontmatter?.process && id in frontmatter.process
			? "process"
			: "artifact";
	};
	const existingIndex = (id: string): number | undefined => {
		const meta =
			kindOf(id) === "process"
				? frontmatter?.process?.[id]
				: frontmatter?.artifact?.[id];
		return typeof meta?.index === "number" ? meta.index : undefined;
	};

	// Deterministic topological node order: first appearance across the
	// canonical edge sort (feedback edges are skipped — they carry no rank),
	// then any remaining declared/isolated nodes by id.
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
	const remaining = new Set<string>([
		...graph.nodes.keys(),
		...Object.keys(frontmatter?.artifact ?? {}),
		...Object.keys(frontmatter?.process ?? {}),
	]);
	for (const id of [...remaining].sort()) push(id);

	// Assign indices per kind.
	const assigned = new Map<string, number>();
	if (opts.renumber) {
		const counter: Record<NodeKind, number> = { artifact: 0, process: 0 };
		for (const id of order) {
			const kind = kindOf(id);
			counter[kind] += 1;
			assigned.set(id, counter[kind]);
		}
	} else {
		// fill: keep existing, hand out numbers above the current max per kind.
		const next: Record<NodeKind, number> = { artifact: 0, process: 0 };
		for (const id of order) {
			const cur = existingIndex(id);
			if (cur !== undefined) next[kindOf(id)] = Math.max(next[kindOf(id)], cur);
		}
		for (const id of order) {
			const cur = existingIndex(id);
			if (cur !== undefined) {
				assigned.set(id, cur);
				continue;
			}
			const kind = kindOf(id);
			next[kind] += 1;
			assigned.set(id, next[kind]);
		}
	}

	// Diff against existing to build change list + writes.
	const changes: IndexChange[] = [];
	const writes: Write[] = [];
	for (const id of order) {
		const to = assigned.get(id)!;
		const from = existingIndex(id) ?? null;
		if (from === to) continue;
		const kind = kindOf(id);
		changes.push({ kind, id, from, to });
		writes.push({ kind, id, value: to });
	}

	const output = writes.length ? applyWrites(source, writes) : source;
	return { output, changes, diagnostics };
}

// --- front matter text editing ---------------------------------------------

const SECTION_OF: Record<NodeKind, string> = {
	artifact: "artifact",
	process: "process",
};

function applyWrites(source: string, writes: Write[]): string {
	const lines = source.split("\n");
	const trailingNewline = source.endsWith("\n");

	let open = -1;
	let close = -1;
	if (lines[0]?.trim() === "---") {
		open = 0;
		for (let i = 1; i < lines.length; i++) {
			if (lines[i]?.trim() === "---") {
				close = i;
				break;
			}
		}
	}

	// No front matter: synthesize one from the writes.
	if (open === -1 || close === -1) {
		const fm = buildFrontmatter(writes);
		return `${fm}${source}`;
	}

	// Mutable view of the YAML region (exclusive of the --- fences).
	const yaml = lines.slice(open + 1, close);
	for (const w of writes) setIndex(yaml, w);

	const rebuilt = [...lines.slice(0, open + 1), ...yaml, ...lines.slice(close)];
	let result = rebuilt.join("\n");
	if (trailingNewline && !result.endsWith("\n")) result += "\n";
	return result;
}

function buildFrontmatter(writes: Write[]): string {
	const lines: string[] = ["---"];
	for (const section of ["artifact", "process"] as const) {
		const ws = writes.filter((w) => w.kind === section);
		if (ws.length === 0) continue;
		lines.push(`${section}:`);
		for (const w of ws) {
			lines.push(`  ${w.id}:`);
			lines.push(`    index: ${w.value}`);
		}
	}
	lines.push("---", "");
	return lines.join("\n");
}

const indentOf = (line: string): number =>
	line.length - line.trimStart().length;

function setIndex(yaml: string[], w: Write): void {
	const section = SECTION_OF[w.kind];
	// Locate the top-level section line (indent 0).
	let sectionStart = -1;
	for (let i = 0; i < yaml.length; i++) {
		const line = yaml[i]!;
		if (/^[^\s#]/.test(line) && line.replace(/:\s*$/, "") === section) {
			sectionStart = i;
			break;
		}
	}

	if (sectionStart === -1) {
		// Append a fresh section at the end of the YAML region.
		yaml.push(`${section}:`, `  ${w.id}:`, `    index: ${w.value}`);
		return;
	}

	// Section spans until the next top-level (indent-0, non-comment) line.
	let sectionEnd = yaml.length;
	for (let i = sectionStart + 1; i < yaml.length; i++) {
		const line = yaml[i]!;
		if (line.trim() !== "" && /^[^\s#]/.test(line)) {
			sectionEnd = i;
			break;
		}
	}

	// Node keys sit at the section's child-indent level, detected from the
	// first content line (supports 2-space, 4-space, etc. — not hardcoded).
	let sectionIndent = 2;
	for (let i = sectionStart + 1; i < sectionEnd; i++) {
		const line = yaml[i]!;
		if (line.trim() !== "" && !line.trimStart().startsWith("#")) {
			sectionIndent = indentOf(line);
			break;
		}
	}

	// Find the node key line within the section (block or inline mapping).
	const keyRe = new RegExp(`^(\\s+)${escapeRe(w.id)}:(.*)$`);
	let nodeLine = -1;
	let nodeIndent = sectionIndent;
	let nodeRest = "";
	for (let i = sectionStart + 1; i < sectionEnd; i++) {
		const m = keyRe.exec(yaml[i]!);
		if (m && m[1]!.length === sectionIndent) {
			nodeLine = i;
			nodeIndent = m[1]!.length;
			nodeRest = m[2]!;
			break;
		}
	}

	const pad = (n: number) => " ".repeat(n);

	if (nodeLine === -1) {
		// Node not declared: insert a fresh block at the end of the section,
		// matching the section's existing indentation.
		const block = [
			`${pad(sectionIndent)}${w.id}:`,
			`${pad(sectionIndent * 2)}index: ${w.value}`,
		];
		yaml.splice(sectionEnd, 0, ...block);
		return;
	}

	// Inline flow mapping: `id: { ... }` — edit inside the braces. A trailing
	// comment after the closing brace is allowed and preserved.
	const inline = /^\s*\{(.*)\}\s*(?:#.*)?$/.exec(nodeRest);
	if (inline) {
		const inner = inline[1]!.trim();
		if (/\bindex:\s*\d/.test(inner)) {
			// Replace only the integer value, leaving surrounding spacing intact.
			yaml[nodeLine] = yaml[nodeLine]!.replace(
				/(\bindex:\s*)\d+/,
				`$1${w.value}`,
			);
		} else {
			const merged =
				inner === "" ? `index: ${w.value}` : `index: ${w.value}, ${inner}`;
			yaml[nodeLine] = yaml[nodeLine]!.replace(/\{.*\}/, `{ ${merged} }`);
		}
		return;
	}

	// Within the block mapping, update an existing index: or insert a new one.
	const childIndent = nodeIndent + sectionIndent;
	for (let i = nodeLine + 1; i < sectionEnd; i++) {
		const line = yaml[i]!;
		if (line.trim() === "") continue;
		if (indentOf(line) <= nodeIndent) break; // left the node block
		if (/^\s*index:\s*/.test(line)) {
			// Replace the integer value; keep any trailing comment.
			yaml[i] = line.replace(/^(\s*index:\s*)\d+/, `$1${w.value}`);
			return;
		}
	}
	yaml.splice(nodeLine + 1, 0, `${pad(childIndent)}index: ${w.value}`);
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
