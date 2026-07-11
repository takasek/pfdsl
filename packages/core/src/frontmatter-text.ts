/**
 * Shared low-level helpers for surgical text edits within the YAML front
 * matter region (used by sort.ts, reindex.ts, and — per #430 — frontmatter.ts
 * and the CLI status-set command).
 */

/** Number of leading whitespace characters (spaces or tabs) on a line. */
export const indentOf = (line: string): number =>
	line.length - line.trimStart().length;
