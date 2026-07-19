import { loadFrontmatter, resolveLocationFsPath } from "@pfdsl/core";
import { normalizeLocation } from "./location-utils.js";

export interface LinkRange {
	/** 0-based line index in the document */
	line: number;
	/** 0-based column start of the target value (inside quotes or bare) */
	startChar: number;
	/** 0-based column end of the target value */
	endChar: number;
	/** Resolved target: file URI string (file://...) or URL string */
	target: string;
}

const SCALAR_LINE = /^(\s+(location|subflow):\s+)(['"]?)(.+?)\3\s*$/;
const FLOW_ARRAY_LINE = /^(\s+(location|subflow):\s+)\[\s*(.*?)\s*,?\s*\]\s*$/;
const KEY_ONLY_LINE = /^(\s+)(location|subflow):\s*$/;
const FLOW_ARRAY_OPEN = /^\s*\[\s*$/;
const FLOW_ARRAY_CLOSE = /^\s*\]\s*$/;
const DASH_ITEM_LINE = /^(\s+)(-\s+)(['"]?)(.+?)\3\s*$/;
const FLOW_ITEM_LINE = /^(\s+)(['"]?)(.+?)\2,?\s*$/;

function isUrl(value: string): boolean {
	return /^https?:\/\//.test(value);
}

function makeLink(
	docFsPath: string,
	basePath: string | undefined,
	key: string,
	line: number,
	startChar: number,
	rawValue: string,
): LinkRange | null {
	const value = normalizeLocation(rawValue)[0];
	if (!value) return null;
	// basePath applies to location: only (spec §2.3/§15.8); subflow:
	// always resolves against the containing .pfdsl file's directory (§15.8).
	const effectiveBasePath = key === "location" ? basePath : undefined;
	const target = isUrl(value)
		? value
		: `file://${resolveLocationFsPath(docFsPath, value, effectiveBasePath)}`;
	return { line, startChar, endChar: startChar + rawValue.length, target };
}

/** Push a link for each comma-separated item in `content`, columns relative to `line`. */
function pushFlowItems(
	results: LinkRange[],
	line: string,
	lineIndex: number,
	content: string,
	searchFrom: number,
	docFsPath: string,
	basePath: string | undefined,
	key: string,
): void {
	let cursor = searchFrom;
	for (const rawItem of content.split(",")) {
		const trimmed = rawItem.trim();
		if (!trimmed) continue;
		const itemStart = line.indexOf(trimmed, cursor);
		if (itemStart < 0) continue;
		const link = makeLink(
			docFsPath,
			basePath,
			key,
			lineIndex,
			itemStart,
			trimmed,
		);
		if (link) results.push(link);
		cursor = itemStart + trimmed.length;
	}
}

/**
 * Extract document links from the frontmatter of a .pfdsl source string.
 * Links are produced for `location:` (artifact and process) and `subflow:` (process) fields.
 * Values may be a scalar, a single-line flow array (`[a, b]`), a multi-line
 * flow array, or a block (dash) array. URL values link to the URL; relative
 * file paths are resolved against `docFsPath`.
 */
export function extractDocumentLinks(
	source: string,
	docFsPath: string,
): LinkRange[] {
	const { bodyStartLine, frontmatter } = loadFrontmatter(source);
	const basePath = frontmatter?.basePath;
	const lines = source.split("\n");
	const results: LinkRange[] = [];
	const lastLine = Math.min(bodyStartLine - 1, lines.length);

	for (let i = 0; i < lastLine; i++) {
		const line = lines[i];
		if (line === undefined) continue;

		const flowInline = FLOW_ARRAY_LINE.exec(line);
		if (flowInline) {
			const [, prefix = "", key = "", content = ""] = flowInline;
			pushFlowItems(
				results,
				line,
				i,
				content,
				prefix.length,
				docFsPath,
				basePath,
				key,
			);
			continue;
		}

		const scalar = SCALAR_LINE.exec(line);
		if (scalar) {
			const [, prefix = "", key = "", quote = "", rawValue = ""] = scalar;
			const link = makeLink(
				docFsPath,
				basePath,
				key,
				i,
				prefix.length + quote.length,
				rawValue,
			);
			if (link) results.push(link);
			continue;
		}

		const keyOnly = KEY_ONLY_LINE.exec(line);
		if (!keyOnly) continue;
		const [, indent = "", key = ""] = keyOnly;
		const keyIndent = indent.length;

		let j = i + 1;
		const next = lines[j];
		if (next !== undefined && FLOW_ARRAY_OPEN.test(next)) {
			j++;
			while (j < lastLine) {
				const itemLine = lines[j];
				if (itemLine === undefined || FLOW_ARRAY_CLOSE.test(itemLine)) break;
				const itemMatch = FLOW_ITEM_LINE.exec(itemLine);
				if (itemMatch) {
					const [, iPrefix = "", iQuote = "", iValue = ""] = itemMatch;
					const link = makeLink(
						docFsPath,
						basePath,
						key,
						j,
						iPrefix.length + iQuote.length,
						iValue,
					);
					if (link) results.push(link);
				}
				j++;
			}
			i = j;
			continue;
		}

		while (j < lastLine) {
			const itemLine = lines[j];
			if (itemLine === undefined) break;
			const itemMatch = DASH_ITEM_LINE.exec(itemLine);
			if (!itemMatch) break;
			const [, iIndent = "", iDash = "", iQuote = "", iValue = ""] = itemMatch;
			if (iIndent.length <= keyIndent) break;
			const link = makeLink(
				docFsPath,
				basePath,
				key,
				j,
				iIndent.length + iDash.length + iQuote.length,
				iValue,
			);
			if (link) results.push(link);
			j++;
		}
		i = j - 1;
	}

	return results;
}
