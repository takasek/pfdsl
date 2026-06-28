import { parse as parseYaml } from "yaml";
import type {
	Diagnostic,
	Frontmatter,
	LoadResult,
	Range,
} from "./types/index.js";

/**
 * Locate the front matter key line of each artifact and process node, keyed by
 * id. Used to point diagnostics at the offending node. Node id keys are matched
 * at exactly 2-space indent (the canonical front matter style).
 */
export function findFrontmatterNodeRanges(source: string): Map<string, Range> {
	const result = new Map<string, Range>();
	const { bodyStartLine } = loadFrontmatter(source);
	const fmEndLine = bodyStartLine - 1;
	const lines = source.split("\n");
	let inNodeSection = false;
	for (let i = 0; i < fmEndLine && i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		// Top-level section key (no leading spaces)
		if (/^\S/.test(line)) {
			inNodeSection =
				line.startsWith("artifact:") || line.startsWith("process:");
			continue;
		}
		if (!inNodeSection) continue;
		// Node ID keys are at exactly 2-space indent
		const m = /^( {2})(\S[^:]*)\s*:/.exec(line);
		if (!m) continue;
		const id = m[2] ?? "";
		if (!id) continue;
		const lineNum = i + 1; // 1-based
		const col = 3; // 2 spaces + 1-based = column 3
		result.set(id, {
			start: { line: lineNum, column: col, offset: 0 },
			end: { line: lineNum, column: col + id.length, offset: 0 },
		});
	}
	return result;
}

/** @deprecated use findFrontmatterNodeRanges (now covers process nodes too) */
export const findFrontmatterArtifactRanges = findFrontmatterNodeRanges;

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
