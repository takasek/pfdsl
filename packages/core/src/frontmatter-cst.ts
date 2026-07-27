import { Document, parseDocument } from "yaml";

/**
 * Fence-location + CST parse of a `.pfdsl` file's `---`-fenced frontmatter
 * block, for the write path introduced by ADR-0034 (`fmt` / `meta set` /
 * `reindex` / `insert-definition` rewrite frontmatter through the `yaml`
 * package's `Document` rather than by regex/line splicing).
 *
 * The fence math mirrors `loadFrontmatter` in frontmatter.ts, but is kept
 * independent: that function serves read-only diagnostics (out of scope for
 * ADR-0034) while this one serves the write path.
 */
export interface FrontmatterCst {
	/** True when `source` opens with a well-formed `---`-fenced block. */
	present: boolean;
	/** Parsed CST document for the frontmatter YAML (empty map when absent). */
	doc: Document;
	/** Everything in `source` after the closing fence — the pfdsl body, verbatim. */
	body: string;
}

/**
 * Parse the frontmatter block at the start of `source` into a mutable CST
 * `Document`. Callers are expected to have already gated on `analyze(source)`
 * reporting no parse errors; an absent or unclosed block is reported here as
 * `present: false` (rather than raising) so callers can fall back to
 * synthesizing a fresh block instead.
 */
export function parseFrontmatterCst(source: string): FrontmatterCst {
	if (!source.startsWith("---")) {
		return { present: false, doc: new Document(), body: source };
	}
	const firstNl = source.indexOf("\n");
	if (firstNl === -1) {
		return { present: false, doc: new Document(), body: source };
	}
	let lineStart = firstNl + 1;
	let closingStart = -1;
	let closingEnd = -1;
	while (lineStart <= source.length) {
		const nl = source.indexOf("\n", lineStart);
		const lineEnd = nl === -1 ? source.length : nl;
		if (source.slice(lineStart, lineEnd).trimEnd() === "---") {
			closingStart = lineStart;
			closingEnd = lineEnd;
			break;
		}
		if (nl === -1) break;
		lineStart = nl + 1;
	}
	if (closingStart === -1) {
		return { present: false, doc: new Document(), body: source };
	}
	const yamlText =
		closingStart > firstNl + 1
			? source.slice(firstNl + 1, closingStart - 1)
			: "";
	const body = closingEnd === source.length ? "" : source.slice(closingEnd + 1);
	return { present: true, doc: parseDocument(yamlText), body };
}

/** Render a frontmatter CST `Document` back into a fenced `---` block. */
export function renderFrontmatterCst(doc: Document): string {
	return `---\n${doc.toString({ lineWidth: 0 })}---\n`;
}
