import {
	type Document,
	isAlias,
	isMap,
	isNode,
	isPair,
	isScalar,
	isSeq,
	type Node,
	parseDocument,
	parse as parseYaml,
	visit,
} from "yaml";
import type { $ZodIssue } from "zod/v4/core";
import en from "zod/v4/locales/en.js";
import { detectChildIndent } from "./frontmatter-text.js";
import { frontmatterInputSchema } from "./types/frontmatter.js";
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

/** Validate only the declared string-sequence paths, leaving extension metadata open. */
function frontmatterTypeDiagnostics(
	document: Document,
	frontmatter: unknown,
	source: string,
	yamlOffset: number,
): Diagnostic[] {
	// Resolve aliases along the whole path, but locate errors at the first use
	// site rather than at a shared anchor declaration.
	function at(path: (string | number)[]) {
		let node: unknown = document.contents;
		let alias: Node | undefined;
		for (const key of [...path, undefined]) {
			if (isAlias(node)) {
				alias ??= node;
				node = node.resolve(document);
			}
			if (key === undefined) break;
			if (isMap(node)) {
				// YAML object keys are stringified by toJS (null becomes "").
				// Follow the same identity for numeric and boolean node IDs.
				let value: unknown;
				for (const pair of node.items) {
					const mapKey = isAlias(pair.key)
						? pair.key.resolve(document)
						: pair.key;
					if (isScalar(mapKey) && String(mapKey.value ?? "") === String(key))
						value = pair.value;
				}
				node = value;
			} else {
				node =
					isSeq(node) && typeof key === "number" ? node.items[key] : undefined;
			}
		}
		return { node, alias };
	}
	function position(offset: number) {
		const before = source.slice(0, offset);
		return {
			line: before.split("\n").length,
			column: offset - before.lastIndexOf("\n"),
			offset,
		};
	}
	const diagnostics: Diagnostic[] = [];
	const result = frontmatterInputSchema.safeParse(frontmatter, {
		error: en().localeError,
	});
	// Union branches report a parent issue. Prefer errors below that parent,
	// e.g. the invalid element in string | string[], not the whole sequence.
	function leaves(issues: $ZodIssue[]): $ZodIssue[] {
		return issues.flatMap((issue) => {
			if (issue.code !== "invalid_union") return [issue];
			const nested = issue.errors.flatMap((branch) =>
				leaves(
					branch.map((child) => ({
						...child,
						path: [...issue.path, ...child.path],
					})),
				),
			);
			const deeper = nested.filter(
				(child) => child.path.length > issue.path.length,
			);
			return deeper.length ? deeper : [issue];
		});
	}
	if (!result.success)
		for (const issue of leaves(result.error.issues)) {
			const path = issue.path.map((key) =>
				typeof key === "number" ? key : String(key),
			);
			const item = at(path);
			const location = item.alias ?? item.node;
			const range = isNode(location) ? location.range : undefined;
			const start = yamlOffset + (range?.[0] ?? 0);
			const end = yamlOffset + (range?.[1] ?? 0);
			diagnostics.push({
				severity: "error",
				code: "FM004",
				message: `Invalid front matter field '${path.join(".") || "<root>"}': ${issue.message}`,
				range: { start: position(start), end: position(end) },
			});
		}
	return diagnostics;
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
	let parsed: unknown = null;
	let yamlValid = true;

	try {
		parsed = parseYaml(yamlText);
	} catch (e) {
		yamlValid = false;
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

	const yamlDocument = parseDocument(yamlText);
	if (yamlValid && (parsed !== null || yamlDocument.contents !== null)) {
		const typeDiagnostics = frontmatterTypeDiagnostics(
			yamlDocument,
			parsed,
			source,
			firstNl + 1,
		);
		diagnostics.push(...typeDiagnostics);
		// Like malformed YAML, invalid typed metadata must not reach consumers.
		if (typeDiagnostics.length === 0) {
			// Checked above. Retain the original YAML values (including extension
			// aliases), normalizing only the documented empty declarations.
			frontmatter = { ...(parsed as Frontmatter) };
			for (const section of ["artifact", "process", "group", "tag"] as const) {
				const entries = frontmatter[section];
				if (entries) frontmatter[section] = { ...entries };
				if (entries)
					for (const [id, meta] of Object.entries(entries)) {
						if (meta === null) {
							const normalized = frontmatter[section];
							if (normalized) normalized[id] = {};
						}
					}
			}
		}
	}
	visit(yamlDocument, {
		Scalar(_key, scalar, path) {
			if (
				scalar.type !== "PLAIN" ||
				!scalar.range ||
				path.some((step) => isPair(step) && step.key === scalar)
			)
				return;
			const valueEnd = scalar.range[1];
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
