import { Document, parseDocument } from "yaml";
import type { NodeKind } from "./types/index.js";

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
	/**
	 * The line ending `source` is written with, taken from its first line
	 * break. A file mixing both styles is treated as being in the style of its
	 * first break: the write path's job is to leave the file no more mixed
	 * than it found it, not to normalize what the author wrote (#644).
	 */
	newline: "\n" | "\r\n";
}

/** The line ending of `source`'s first line break; LF when it has none. */
function detectNewline(source: string): "\n" | "\r\n" {
	const nl = source.indexOf("\n");
	return nl > 0 && source[nl - 1] === "\r" ? "\r\n" : "\n";
}

/**
 * Parse the frontmatter block at the start of `source` into a mutable CST
 * `Document`. Callers are expected to have already gated on `analyze(source)`
 * reporting no parse errors; an absent or unclosed block is reported here as
 * `present: false` (rather than raising) so callers can fall back to
 * synthesizing a fresh block instead.
 */
export function parseFrontmatterCst(source: string): FrontmatterCst {
	const newline = detectNewline(source);
	if (!source.startsWith("---")) {
		return { present: false, doc: new Document(), body: source, newline };
	}
	const firstNl = source.indexOf("\n");
	if (firstNl === -1) {
		return { present: false, doc: new Document(), body: source, newline };
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
		return { present: false, doc: new Document(), body: source, newline };
	}
	// Under CRLF the closing fence's own line break is two characters, so
	// slicing to `closingStart - 1` leaves a \r on the last yaml line — which
	// the parser reads as part of that line's value and re-emits quoted, into
	// a field the caller never asked to touch (#644). Interior \r\n is handled
	// by the yaml parser itself; only this trailing one has to go. Mirrors the
	// same correction in frontmatter.ts (#636).
	const yamlText =
		closingStart > firstNl + 1
			? source.slice(firstNl + 1, closingStart - 1).replace(/\r$/, "")
			: "";
	const body = closingEnd === source.length ? "" : source.slice(closingEnd + 1);
	return { present: true, doc: parseDocument(yamlText), body, newline };
}

/**
 * Render a frontmatter CST `Document` back into a fenced `---` block. The
 * `yaml` package emits LF regardless of the input, so callers that write the
 * result back into a file pass that file's `newline` (from
 * `parseFrontmatterCst`) to keep the block consistent with the body they
 * concatenate it onto.
 */
export function renderFrontmatterCst(
	doc: Document,
	newline: "\n" | "\r\n" = "\n",
): string {
	const block = `---\n${doc.toString({ lineWidth: 0 })}---\n`;
	return newline === "\r\n" ? block.replace(/\n/g, "\r\n") : block;
}

/**
 * Rewrite one node's field in `source`'s frontmatter, preserving everything
 * else (comments, quote style, flow-vs-block). Used by `meta set` (ADR-0034).
 * Quoting for the new value is left to the `yaml` package's own core-schema
 * judgment — pass a `number` for integer fields (e.g. `index`) and a
 * `string` for everything else. Returns null when there is no frontmatter,
 * or when `id` has no entry under `kind`.
 */
export function setFrontmatterField(
	source: string,
	kind: NodeKind,
	id: string,
	field: string,
	value: string | number,
): string | null {
	const { present, doc, body, newline } = parseFrontmatterCst(source);
	if (!present || !doc.hasIn([kind, id])) return null;
	doc.setIn([kind, id, field], value);
	return renderFrontmatterCst(doc, newline) + body;
}
