import { Document, isPair, isScalar, isSeq, parseDocument, visit } from "yaml";
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
	 * The frontmatter's raw YAML text (LF-normalized), exactly as parsed into
	 * `doc`. `""` when `present` is false. Kept alongside the parsed `doc` so
	 * `renderFrontmatterCst` can diff re-rendered folded scalars against what
	 * the author actually wrote (#815).
	 */
	yamlText: string;
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
		return {
			present: false,
			doc: new Document(),
			body: source,
			yamlText: "",
			newline,
		};
	}
	const firstNl = source.indexOf("\n");
	if (firstNl === -1) {
		return {
			present: false,
			doc: new Document(),
			body: source,
			yamlText: "",
			newline,
		};
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
		return {
			present: false,
			doc: new Document(),
			body: source,
			yamlText: "",
			newline,
		};
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
	return {
		present: true,
		doc: parseDocument(yamlText),
		body,
		yamlText,
		newline,
	};
}

/** A folded (`>`) scalar's path from the document root, and its raw text and decoded value at that path. */
interface FoldedScalarSnapshot {
	keys: (string | number)[];
	raw: string;
	value: unknown;
	range: [number, number, number];
}

/**
 * Every BLOCK_FOLDED (`>`) scalar in `yamlText` that is reachable by a plain
 * `key1.key2...` map path, keyed by that path from the document root.
 * Sequence elements are skipped entirely (ADR-0037): a fold's `keys` here
 * are built from only the `isPair` steps on its `visit` path, which drops
 * any sequence index in between. Trying to keep that index would let a
 * fold's path collide with a sibling seq element when a map key happens to
 * be numeric (#816) — excluding the whole subtree up front is what the
 * `keys` shape can actually represent, not an accident of what `getIn`
 * later resolves.
 */
function collectFoldedScalars(yamlText: string): FoldedScalarSnapshot[] {
	const doc = parseDocument(yamlText);
	const found: FoldedScalarSnapshot[] = [];
	visit(doc, {
		Scalar(_key, node, path) {
			if (node.type !== "BLOCK_FOLDED" || !node.range) return;
			if (path.some((step) => isSeq(step))) return;
			const keys: (string | number)[] = [];
			for (const step of path) {
				if (!isPair(step)) continue;
				keys.push(
					isScalar(step.key)
						? (step.key.value as string | number)
						: String(step.key),
				);
			}
			found.push({
				keys,
				raw: yamlText.slice(node.range[0], node.range[1]),
				value: node.value,
				range: node.range as [number, number, number],
			});
		},
	});
	return found;
}

/**
 * True when `headerLine` (a fold's `key: >...` line) carries an explicit
 * indentation indicator — a digit directly after the `>`, e.g. `>2`, `>2-`,
 * `>-2`. Only the indicator zone between `>` and any trailing `# comment` is
 * checked: a comment containing a digit (an issue number is common in this
 * repo) is not an indentation indicator and must not trip this (#816).
 */
function headerHasIndentIndicator(headerLine: string): boolean {
	const withoutComment = headerLine.split("#")[0] ?? "";
	const foldMarker = withoutComment.lastIndexOf(">");
	if (foldMarker === -1) return false;
	return /\d/.test(withoutComment.slice(foldMarker + 1));
}

/**
 * The number of leading ASCII spaces at the start of `line` — YAML's only
 * valid indentation character. `String#trimStart()` also strips other
 * Unicode whitespace (full-width space U+3000, NBSP U+00A0, ...), which are
 * ordinary content characters in YAML, not indentation; measuring with it
 * over-counts a continuation line that happens to start with one of those
 * and eats it out of the reindented value (#816). Tabs are invalid YAML
 * indentation, so they aren't counted either.
 */
function leadingSpaceCount(line: string): number {
	return line.match(/^ */)?.[0].length ?? 0;
}

/**
 * Re-derive `origRaw`'s continuation-line wraps at `newRaw`'s (canonical)
 * indentation. Returns null when the reindent can't be trusted: an explicit
 * indentation indicator in the fold header (a digit, e.g. `>2`) makes the
 * continuation indent unambiguous already, so the yaml package's own
 * re-render of it is authoritative; a rendered scalar with no non-blank
 * continuation line has no indent to measure the replacement against.
 */
function reindentFold(origRaw: string, newRaw: string): string | null {
	const origLines = origRaw.split("\n");
	const newLines = newRaw.split("\n");
	if (headerHasIndentIndicator(origLines[0] ?? "")) return null;
	const newBody = newLines.slice(1);
	const firstNonBlank = newBody.find((line) => line.trim() !== "");
	if (firstNonBlank === undefined) return null;
	const targetIndent = leadingSpaceCount(firstNonBlank);
	const origBody = origLines.slice(1);
	const origIndents = origBody
		.filter((line) => line.trim() !== "")
		.map((line) => leadingSpaceCount(line));
	if (origIndents.length === 0) return null;
	const baseIndent = Math.min(...origIndents);
	const reindentedBody = origBody.map((line) =>
		line.trim() === "" ? "" : " ".repeat(targetIndent) + line.slice(baseIndent),
	);
	// origRaw's own trailing newline count can't be trusted: when the fold is
	// the last field in the frontmatter, parseFrontmatterCst's yamlText slice
	// (which excludes the fence's own line break) has dropped one newline that
	// newRaw's render always has, and a splice built purely from origRaw's line
	// structure loses it — corrupting the file at the closing fence (#816).
	// Trailing blank lines in the middle of a `>+` fold are part of the decoded
	// value and come from origBody unchanged; only the count of *fully trailing*
	// blank lines is corrected to match newRaw's.
	const trailingBlankCount = (lines: string[]): number => {
		let count = 0;
		for (let i = lines.length - 1; i >= 0 && lines[i] === ""; i--) count++;
		return count;
	};
	const trailingDelta =
		trailingBlankCount(newLines) - trailingBlankCount(origLines);
	const adjustedBody =
		trailingDelta > 0
			? [...reindentedBody, ...Array<string>(trailingDelta).fill("")]
			: trailingDelta < 0
				? reindentedBody.slice(0, reindentedBody.length + trailingDelta)
				: reindentedBody;
	return [newLines[0], ...adjustedBody].join("\n");
}

/**
 * Re-splice the author's original line wraps back into `rendered`'s folded
 * (`>`) scalars. `Document#toString({ lineWidth: 0 })` re-serializes every
 * folded scalar onto a single continuation line — pfdsl still owns the
 * frontmatter notation (ADR-0034), but a folded scalar's hand-chosen wrap
 * points are left as the author wrote them as long as the scalar's decoded
 * value hasn't itself changed (#815).
 */
function preserveFolds(originalYaml: string, rendered: string): string {
	const original = collectFoldedScalars(originalYaml.replace(/\r\n/g, "\n"));
	if (original.length === 0) return rendered;
	const renderedDoc = parseDocument(rendered);
	const splices: { start: number; end: number; text: string }[] = [];
	for (const fold of original) {
		const node = renderedDoc.getIn(fold.keys, true);
		if (!isScalar(node) || node.type !== "BLOCK_FOLDED" || !node.range)
			continue;
		// The author's edit changed this field's own value — let it re-serialize.
		if (node.value !== fold.value) continue;
		const newRaw = rendered.slice(node.range[0], node.range[1]);
		if (newRaw === fold.raw) continue;
		const replacement = reindentFold(fold.raw, newRaw);
		if (replacement === null) continue;
		splices.push({
			start: node.range[0],
			end: node.range[1],
			text: replacement,
		});
	}
	splices.sort((a, b) => b.start - a.start);
	let out = rendered;
	for (const splice of splices) {
		out = out.slice(0, splice.start) + splice.text + out.slice(splice.end);
	}
	return out;
}

/**
 * Render a frontmatter CST `Document` back into a fenced `---` block. The
 * `yaml` package emits LF regardless of the input, so callers that write the
 * result back into a file pass that file's `newline` (from
 * `parseFrontmatterCst`) to keep the block consistent with the body they
 * concatenate it onto.
 *
 * `originalYaml`, when given, is the frontmatter's yaml text before this
 * render (typically `parseFrontmatterCst`'s `yamlText`) — passing it
 * preserves hand-wrapped folded (`>`) scalar line breaks that
 * `Document#toString` would otherwise collapse (#815). Omit it for a freshly
 * synthesized document that has no "original" to preserve against.
 */
export function renderFrontmatterCst(
	doc: Document,
	newline: "\n" | "\r\n" = "\n",
	originalYaml?: string,
): string {
	const rendered = doc.toString({ lineWidth: 0 });
	const withFolds =
		originalYaml === undefined
			? rendered
			: preserveFolds(originalYaml, rendered);
	const block = `---\n${withFolds}---\n`;
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
	const { present, doc, body, yamlText, newline } = parseFrontmatterCst(source);
	if (!present || !doc.hasIn([kind, id])) return null;
	doc.setIn([kind, id, field], value);
	return renderFrontmatterCst(doc, newline, yamlText) + body;
}
