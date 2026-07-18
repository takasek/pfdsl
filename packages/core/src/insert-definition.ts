import {
	detectChildIndent,
	escapeRe,
	findFrontmatterFences,
	locateSection,
} from "./frontmatter-text.js";

export interface Insertion {
	/** 0-based line index in `source` to insert `text` before. */
	line: number;
	/** Newline-terminated text to insert as whole lines; nothing else in `source` is touched. */
	text: string;
}

export interface InsertDefinitionResult {
	/** Source with a definition block inserted (unchanged when already defined). */
	output: string;
	inserted: boolean;
	/** The minimal edit that produces `output` from `source`. Present iff `inserted`. */
	insertion?: Insertion;
}

/**
 * Insert a `label: <id>` definition block for a node that appears only in
 * edges. Surgical text edit (mirrors reindex.ts) so unrelated comments and
 * formatting are preserved; a no-op (and idempotent) when `id` is already
 * defined under `kind`. Also reports the insertion as a minimal (line, text)
 * edit point, so callers like a VS Code code action can apply a targeted
 * `WorkspaceEdit.insert` instead of replacing the whole document.
 */
export function insertDefinition(
	source: string,
	kind: "artifact" | "process",
	id: string,
): InsertDefinitionResult {
	const lines = source.split("\n");
	const trailingNewline = source.endsWith("\n");

	const fences = findFrontmatterFences(lines);

	// No front matter: synthesize one around the source.
	if (!fences) {
		const text = [
			"---",
			`${kind}:`,
			`  ${id}:`,
			`    label: ${id}`,
			"---",
			"",
		].join("\n");
		return {
			output: `${text}${source}`,
			inserted: true,
			insertion: { line: 0, text },
		};
	}

	const { open, close } = fences;
	const yaml = lines.slice(open + 1, close);
	const section = locateSection(yaml, kind);
	const pad = (n: number) => " ".repeat(n);
	let insertion: Insertion;

	if (!section) {
		const newLines = [`${kind}:`, `  ${id}:`, `    label: ${id}`];
		yaml.push(...newLines);
		insertion = { line: close, text: `${newLines.join("\n")}\n` };
	} else if (section.flowStyle) {
		// Inline flow-style section (`kind: { ... }`) — splicing a block-style
		// entry in isn't safe without a full YAML rewrite, and re-appending a
		// second top-level `kind:` header would produce a duplicate-key error.
		return { output: source, inserted: false };
	} else {
		const { start: sectionStart, end: sectionEnd } = section;
		const sectionIndent = detectChildIndent(
			yaml.slice(sectionStart + 1, sectionEnd),
		);

		const keyRe = new RegExp(`^(\\s+)${escapeRe(id)}:`);
		for (let i = sectionStart + 1; i < sectionEnd; i++) {
			const m = keyRe.exec(yaml[i]!);
			if (m && m[1]!.length === sectionIndent) {
				return { output: source, inserted: false };
			}
		}

		const newLines = [
			`${pad(sectionIndent)}${id}:`,
			`${pad(sectionIndent * 2)}label: ${id}`,
		];
		yaml.splice(sectionEnd, 0, ...newLines);
		insertion = {
			line: open + 1 + sectionEnd,
			text: `${newLines.join("\n")}\n`,
		};
	}

	const rebuilt = [...lines.slice(0, open + 1), ...yaml, ...lines.slice(close)];
	let result = rebuilt.join("\n");
	if (trailingNewline && !result.endsWith("\n")) result += "\n";
	return { output: result, inserted: true, insertion };
}
