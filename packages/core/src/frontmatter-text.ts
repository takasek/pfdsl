/**
 * Shared low-level helpers for surgical text edits within the YAML front
 * matter region (used by sort.ts, reindex.ts, and — per #430 — frontmatter.ts
 * and the CLI status-set command).
 */

/** Number of leading whitespace characters (spaces or tabs) on a line. */
export const indentOf = (line: string): number =>
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
