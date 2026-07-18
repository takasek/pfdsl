import { detectChildIndent, escapeRe } from "./frontmatter-text.js";

export interface InsertDefinitionResult {
	/** Source with a definition block inserted (unchanged when already defined). */
	output: string;
	inserted: boolean;
}

/**
 * Insert a `label: <id>` definition block for a node that appears only in
 * edges. Surgical text edit (mirrors reindex.ts) so unrelated comments and
 * formatting are preserved; a no-op (and idempotent) when `id` is already
 * defined under `kind`.
 */
export function insertDefinition(
	source: string,
	kind: "artifact" | "process",
	id: string,
): InsertDefinitionResult {
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

	// No front matter: synthesize one around the source.
	if (open === -1 || close === -1) {
		const fm = [
			"---",
			`${kind}:`,
			`  ${id}:`,
			`    label: ${id}`,
			"---",
			"",
		].join("\n");
		return { output: `${fm}${source}`, inserted: true };
	}

	const yaml = lines.slice(open + 1, close);

	let sectionStart = -1;
	for (let i = 0; i < yaml.length; i++) {
		const line = yaml[i]!;
		if (/^[^\s#]/.test(line) && line.replace(/:\s*$/, "") === kind) {
			sectionStart = i;
			break;
		}
	}

	const pad = (n: number) => " ".repeat(n);

	if (sectionStart === -1) {
		yaml.push(`${kind}:`, `  ${id}:`, `    label: ${id}`);
	} else {
		let sectionEnd = yaml.length;
		for (let i = sectionStart + 1; i < yaml.length; i++) {
			const line = yaml[i]!;
			if (line.trim() !== "" && /^[^\s#]/.test(line)) {
				sectionEnd = i;
				break;
			}
		}

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

		yaml.splice(
			sectionEnd,
			0,
			`${pad(sectionIndent)}${id}:`,
			`${pad(sectionIndent * 2)}label: ${id}`,
		);
	}

	const rebuilt = [...lines.slice(0, open + 1), ...yaml, ...lines.slice(close)];
	let result = rebuilt.join("\n");
	if (trailingNewline && !result.endsWith("\n")) result += "\n";
	return { output: result, inserted: true };
}
