import { loadFrontmatter } from "@pfdsl/core";
import { resolveLocationFsPath } from "./location-path.js";
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

const LOCATION_LINE = /^(\s+location:\s+)(['"]?)(.+?)\2\s*$/;
const SUBFLOW_LINE = /^(\s+subflow:\s+)(['"]?)(.+?)\2\s*$/;

function isUrl(value: string): boolean {
	return /^https?:\/\//.test(value);
}

/**
 * Extract document links from the frontmatter of a .pfdsl source string.
 * Links are produced for `location:` (artifact and process) and `subflow:` (process) fields.
 * URL values link to the URL; relative file paths are resolved against `docFsPath`.
 */
export function extractDocumentLinks(
	source: string,
	docFsPath: string,
): LinkRange[] {
	const { bodyStartLine, frontmatter } = loadFrontmatter(source);
	const basePath = frontmatter?.basePath;
	const lines = source.split("\n");
	const results: LinkRange[] = [];

	for (let i = 0; i < bodyStartLine - 1 && i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;

		for (const pattern of [LOCATION_LINE, SUBFLOW_LINE]) {
			const m = pattern.exec(line);
			if (!m) continue;
			const prefix = m[1] ?? "";
			const quote = m[2] ?? "";
			const rawValue = m[3] ?? "";

			const values = normalizeLocation(rawValue);
			if (values.length === 0) continue;
			const value = values[0]!;

			const startChar = prefix.length + quote.length;
			const endChar = startChar + rawValue.length;

			const target = isUrl(value)
				? value
				: `file://${resolveLocationFsPath(docFsPath, value, basePath)}`;

			results.push({ line: i, startChar, endChar, target });
			break;
		}
	}

	return results;
}
