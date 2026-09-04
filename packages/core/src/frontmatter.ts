import {
	isMap,
	isScalar,
	isSeq,
	parseDocument,
	parse as parseYaml,
	visit,
} from "yaml";
import { detectChildIndent } from "./frontmatter-text.js";
import type {
	Diagnostic,
	Frontmatter,
	LoadResult,
	Range,
} from "./types/index.js";

/**
 * Locate the front matter key line of each artifact and process node, keyed by
 * id. Used to point diagnostics at the offending node. Each section's node id
 * indent is detected from its first content line (supports 2-space, 4-space,
 * etc. — not hardcoded; see #430).
 */
export function findFrontmatterNodeRanges(source: string): Map<string, Range> {
	const result = new Map<string, Range>();
	const { bodyStartLine } = loadFrontmatter(source);
	const fmEndLine = bodyStartLine - 1;
	const lines = source.split("\n");
	let inNodeSection = false;
	let sectionIndent: number | null = null;
	for (let i = 0; i < fmEndLine && i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		// Top-level section key (no leading spaces)
		if (/^\S/.test(line)) {
			inNodeSection =
				line.startsWith("artifact:") || line.startsWith("process:");
			sectionIndent = inNodeSection
				? detectChildIndent(lines.slice(i + 1, fmEndLine))
				: null;
			continue;
		}
		if (!inNodeSection || sectionIndent === null) continue;
		// Node ID keys sit at the section's detected indent width.
		const m = new RegExp(`^( {${sectionIndent}})(\\S[^:]*)\\s*:`).exec(line);
		if (!m) continue;
		const id = m[2] ?? "";
		if (!id) continue;
		const lineNum = i + 1; // 1-based
		const col = sectionIndent + 1; // indent width + 1-based
		result.set(id, {
			start: { line: lineNum, column: col, offset: 0 },
			end: { line: lineNum, column: col + id.length, offset: 0 },
		});
	}
	return result;
}

export function loadFrontmatter(
	source: string,
	options?: { strict?: boolean },
): LoadResult {
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

	// The -1 drops the newline that ends the last yaml line. On CRLF input that
	// newline is two characters, so the \r survived into the yaml text and ended
	// up on the last line's value — a last-line `status: done` then failed V007
	// (#636). Earlier lines were fine, since the yaml parser handles \r\n inside
	// the text it is given.
	const yamlText =
		closingLineStart > firstNl + 1
			? source.slice(firstNl + 1, closingLineStart - 1).replace(/\r$/, "")
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

	visit(parseDocument(yamlText), {
		Pair(_key, pair, path) {
			if (
				!isScalar(pair.value) ||
				pair.value.type !== "PLAIN" ||
				!pair.value.range ||
				path.some((step) => Boolean((isMap(step) || isSeq(step)) && step.flow))
			)
				return;
			const valueEnd = pair.value.range[1];
			const comment = /^[ \t]+#/.exec(yamlText.slice(valueEnd));
			if (!comment) return;
			const markerOffset = valueEnd + comment[0].length - 1;
			const sourceOffset = firstNl + 1 + markerOffset;
			const beforeMarker = yamlText.slice(0, markerOffset);
			const line = beforeMarker.split("\n").length + 1;
			const column = markerOffset - beforeMarker.lastIndexOf("\n");
			diagnostics.push({
				severity: options?.strict ? "error" : "warning",
				code: "FM003",
				message:
					"Inline comment may truncate an intended plain-scalar value; quote the value or use a block scalar.",
				range: {
					start: { line, column, offset: sourceOffset },
					end: { line, column: column + 1, offset: sourceOffset + 1 },
				},
			});
		},
	});

	return { frontmatter, body, bodyStartLine, diagnostics };
}
