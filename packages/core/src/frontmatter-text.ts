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

export interface FrontmatterFences {
	/** Line index of the opening `---`. */
	open: number;
	/** Line index of the closing `---`. */
	close: number;
}

/** Locate the opening/closing `---` fence lines, or null if absent/unclosed. */
export function findFrontmatterFences(
	lines: string[],
): FrontmatterFences | null {
	if (lines[0]?.trim() !== "---") return null;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === "---") return { open: 0, close: i };
	}
	return null;
}

export interface Section {
	/** Line index of the `<name>:` header within the YAML region. */
	start: number;
	/** Line index just past the section's content (exclusive). */
	end: number;
	/**
	 * True when the section header itself carries an inline flow-style value
	 * (`name: { ... }`) rather than child lines below it — the section exists
	 * but isn't safe to splice a block-style entry into.
	 */
	flowStyle: boolean;
}

/** Locate a top-level (unindented) `<name>:` section within `yaml` lines. */
export function locateSection(yaml: string[], name: string): Section | null {
	let start = -1;
	let flowStyle = false;
	for (let i = 0; i < yaml.length; i++) {
		const line = yaml[i]!;
		if (!/^[^\s#]/.test(line) || !line.startsWith(`${name}:`)) continue;
		const rest = line.slice(name.length + 1).trim();
		// A bare header (optionally followed by a trailing comment) has no
		// non-comment content after the colon; anything else that isn't a
		// comment is an inline flow-style value.
		flowStyle = rest !== "" && !rest.startsWith("#");
		start = i;
		break;
	}
	if (start === -1) return null;

	let end = yaml.length;
	for (let i = start + 1; i < yaml.length; i++) {
		const line = yaml[i]!;
		if (line.trim() !== "" && /^[^\s#]/.test(line)) {
			end = i;
			break;
		}
	}
	return { start, end, flowStyle };
}
