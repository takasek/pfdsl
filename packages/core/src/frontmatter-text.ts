/**
 * Shared low-level helpers for read-only frontmatter diagnostics — locating
 * an error position within the YAML front matter region (used by index.ts
 * and frontmatter.ts). The write-side (surgical text edit) helpers this file
 * used to hold for sort.ts/reindex.ts were removed once those commands moved
 * to the frontmatter yaml CST (ADR-0034); this file is out of that ADR's
 * scope.
 */

/** Number of leading whitespace characters (spaces or tabs) on a line. */
const indentOf = (line: string): number =>
	line.length - line.trimStart().length;

/** Escape a string for literal use inside a `new RegExp(...)` pattern. */
export function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detect the indent width of a section's node keys from the first non-empty,
 * non-comment line among the given content lines. Falls back to `fallback`
 * (default 2) when no such line exists — supports 2-space, 4-space, or any
 * other consistent indent instead of hardcoding 2-space.
 */
export function detectChildIndent(lines: string[], fallback = 2): number {
	for (const line of lines) {
		if (line.trim() !== "" && !line.trimStart().startsWith("#")) {
			return indentOf(line);
		}
	}
	return fallback;
}
