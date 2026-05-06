import { parse as parseYaml } from "yaml";
import type { Diagnostic, Frontmatter, LoadResult } from "./types/index.js";

export function loadFrontmatter(source: string): LoadResult {
	if (!source.startsWith("---")) {
		return {
			frontmatter: null,
			body: source,
			bodyStartLine: 1,
			diagnostics: [],
		};
	}

	const firstNl = source.indexOf("\n");
	let closingLineStart = -1;
	let closingLineEnd = -1;
	let lineNum = 2;
	if (firstNl !== -1) {
		let lineStart = firstNl + 1;
		while (lineStart <= source.length) {
			const nl = source.indexOf("\n", lineStart);
			const lineEnd = nl === -1 ? source.length : nl;
			if (source.slice(lineStart, lineEnd).trimEnd() === "---") {
				closingLineStart = lineStart;
				closingLineEnd = lineEnd;
				break;
			}
			if (nl === -1) break;
			lineStart = nl + 1;
			lineNum++;
		}
	}

	if (closingLineStart === -1) {
		const diag: Diagnostic = {
			severity: "error",
			code: "FM001",
			message: "Unclosed front matter: missing closing ---",
			range: {
				start: { line: 1, column: 1, offset: 0 },
				end: { line: 1, column: 4, offset: 3 },
			},
		};
		return {
			frontmatter: null,
			body: source,
			bodyStartLine: 1,
			diagnostics: [diag],
		};
	}

	const yamlText =
		closingLineStart > firstNl + 1
			? source.slice(firstNl + 1, closingLineStart - 1)
			: "";
	const body =
		closingLineEnd === source.length ? "" : source.slice(closingLineEnd + 1);
	const bodyStartLine = lineNum + 1;

	const diagnostics: Diagnostic[] = [];
	let frontmatter: Frontmatter | null = null;

	try {
		const parsed = parseYaml(yamlText);
		if (parsed != null && typeof parsed === "object") {
			frontmatter = parsed as Frontmatter;
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		diagnostics.push({
			severity: "error",
			code: "FM002",
			message: `Invalid YAML in front matter: ${msg}`,
			range: {
				start: { line: 2, column: 1, offset: 4 },
				end: { line: 2, column: 1, offset: 4 },
			},
		});
	}

	return { frontmatter, body, bodyStartLine, diagnostics };
}
