import { analyze } from "./index.js";
import { sortEdges } from "./sorter.js";
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

interface NodeBlock {
	id: string;
	/** Lines that form the block: preceding comment lines + key line + child lines. */
	lines: string[];
}

const indentOf = (line: string): number =>
	line.length - line.trimStart().length;

function extractNodeId(line: string): string {
	const m = /^\s+(\S[^:]*?)\s*:/.exec(line);
	return m?.[1] ?? "";
}

/**
 * Extract sortable node blocks and the inter-block gaps from the content lines
 * of an artifact/process section (everything after the section header line).
 *
 * A block = directly preceding comment lines (no blank line between) + key line
 * + child lines (deeper indent, no blank line).
 * Blank lines and orphaned comment lines (separated from the next key by a blank)
 * become part of the inter-block gap.
 *
 * Result: gaps[i] is the gap BEFORE blocks[i]; gaps[N] is the trailing gap.
 */
function extractBlocksAndGaps(
	sectionLines: string[],
	childIndent: number,
): { blocks: NodeBlock[]; gaps: string[][] } {
	const blocks: NodeBlock[] = [];
	const gaps: string[][] = [];

	let currentGap: string[] = [];
	let pendingComments: string[] = [];
	let i = 0;

	while (i < sectionLines.length) {
		const line = sectionLines[i]!;
		const trimmed = line.trim();

		if (trimmed === "") {
			// Blank line: flush any pending comments as orphaned (part of gap)
			if (pendingComments.length > 0) {
				currentGap.push(...pendingComments);
				pendingComments = [];
			}
			currentGap.push(line);
			i++;
			continue;
		}

		if (trimmed.startsWith("#")) {
			pendingComments.push(line);
			i++;
			continue;
		}

		if (indentOf(line) === childIndent) {
			// Node key line: close current gap, start new block
			gaps.push([...currentGap]);
			currentGap = [];

			const blockLines = [...pendingComments, line];
			pendingComments = [];
			i++;

			// Collect child lines: deeper indent, stop on blank or same/shallower
			while (i < sectionLines.length) {
				const childLine = sectionLines[i]!;
				if (childLine.trim() === "") break;
				if (indentOf(childLine) <= childIndent) break;
				blockLines.push(childLine);
				i++;
			}

			blocks.push({ id: extractNodeId(line), lines: blockLines });
			continue;
		}

		// Unexpected line: treat as gap material
		if (pendingComments.length > 0) {
			currentGap.push(...pendingComments);
			pendingComments = [];
		}
		currentGap.push(line);
		i++;
	}

	// Trailing gap
	const trailingGap = [...currentGap, ...pendingComments];
	gaps.push(trailingGap);

	return { blocks, gaps };
}

export function sort(source: string, opts: SortOptions): SortResult {
	const { edges, graph, nodeKinds, frontmatter, diagnostics } = analyze(source);
	if (diagnostics.some((d) => d.severity === "error")) {
		return { output: source, changed: false, diagnostics };
	}

	// Compute topological order only when needed.
	const topoOrder = new Map<string, number>();
	if (opts.by.includes("topological")) {
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

	// Parse frontmatter line range
	const lines = source.split("\n");
	const trailingNewline = source.endsWith("\n");

	let fmOpen = -1;
	let fmClose = -1;
	if (lines[0]?.trim() === "---") {
		fmOpen = 0;
		for (let i = 1; i < lines.length; i++) {
			if (lines[i]?.trim() === "---") {
				fmClose = i;
				break;
			}
		}
	}
	if (fmOpen === -1 || fmClose === -1) {
		return { output: source, changed: false, diagnostics };
	}

	const yaml = lines.slice(fmOpen + 1, fmClose);

	// Collect section modifications in order, then apply bottom-up.
	const sectionMods: Array<{
		yamlStart: number;
		yamlEnd: number;
		newLines: string[];
	}> = [];

	for (const section of ["artifact", "process"] as const) {
		let sectionStart = -1;
		for (let i = 0; i < yaml.length; i++) {
			const line = yaml[i]!;
			if (/^[^\s#]/.test(line) && line.replace(/\s*:.*$/, "") === section) {
				sectionStart = i;
				break;
			}
		}
		if (sectionStart === -1) continue;

		// Section content ends at the next top-level (indent-0, non-comment) line
		let sectionEnd = yaml.length;
		for (let i = sectionStart + 1; i < yaml.length; i++) {
			const line = yaml[i]!;
			if (line.trim() !== "" && /^[^\s#]/.test(line)) {
				sectionEnd = i;
				break;
			}
		}

		const sectionContent = yaml.slice(sectionStart + 1, sectionEnd);

		// Detect child indent from the first content line
		let childIndent = 2;
		for (const line of sectionContent) {
			if (line.trim() !== "" && !line.trimStart().startsWith("#")) {
				childIndent = indentOf(line);
				break;
			}
		}

		const { blocks, gaps } = extractBlocksAndGaps(sectionContent, childIndent);
		if (blocks.length === 0) continue;

		// Stable sort: track original index for stable tiebreaking
		const indexed = blocks.map((block, idx) => ({ block, idx }));
		indexed.sort((a, b) => {
			for (const key of opts.by) {
				let cmp: number;
				if (key === "group") {
					const ga = getGroup(a.block.id);
					const gb = getGroup(b.block.id);
					// nodes without a group always sort after nodes with a group
					if (ga === null && gb === null) cmp = 0;
					else if (ga === null) cmp = 1;
					else if (gb === null) cmp = -1;
					else cmp = ga.localeCompare(gb);
				} else {
					const va = getSortValue(a.block.id, key);
					const vb = getSortValue(b.block.id, key);
					if (typeof va === "number" && typeof vb === "number") {
						cmp = va - vb;
					} else {
						cmp = String(va).localeCompare(String(vb));
					}
				}
				if (cmp !== 0) return cmp;
			}
			return a.idx - b.idx;
		});

		const orderChanged = indexed.some((x, i) => x.idx !== i);
		if (!orderChanged) continue;

		const sortedBlocks = indexed.map((x) => x.block);

		// Reconstruct: gaps[i] before sortedBlocks[i], gaps[N] at the end
		const newLines: string[] = [];
		for (let j = 0; j < sortedBlocks.length; j++) {
			newLines.push(...gaps[j]!);
			newLines.push(...sortedBlocks[j]!.lines);
		}
		newLines.push(...gaps[sortedBlocks.length]!);

		sectionMods.push({
			yamlStart: sectionStart + 1,
			yamlEnd: sectionEnd,
			newLines,
		});
	}

	if (sectionMods.length === 0) {
		return { output: source, changed: false, diagnostics };
	}

	// Apply modifications bottom-up to preserve line indices
	const mutableYaml = [...yaml];
	for (const mod of [...sectionMods].reverse()) {
		mutableYaml.splice(
			mod.yamlStart,
			mod.yamlEnd - mod.yamlStart,
			...mod.newLines,
		);
	}

	const rebuilt = [
		...lines.slice(0, fmOpen + 1),
		...mutableYaml,
		...lines.slice(fmClose),
	];
	let result = rebuilt.join("\n");
	if (trailingNewline && !result.endsWith("\n")) result += "\n";

	return { output: result, changed: true, diagnostics };
}
