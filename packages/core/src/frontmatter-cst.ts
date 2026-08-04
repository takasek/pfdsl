import {
	Document,
	isAlias,
	isMap,
	isScalar,
	type Node,
	parseDocument,
} from "yaml";
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
	/**
	 * The raw YAML text between the fences, exactly as sliced for
	 * `parseDocument` (same #644 trailing-\r handling). Never carries its
	 * own trailing newline — callers that splice into it must supply the
	 * separator themselves when reassembling (see `padLine` in Task 3).
	 */
	yamlText: string;
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
			newline,
			yamlText: "",
		};
	}
	const firstNl = source.indexOf("\n");
	if (firstNl === -1) {
		return {
			present: false,
			doc: new Document(),
			body: source,
			newline,
			yamlText: "",
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
			newline,
			yamlText: "",
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
		newline,
		yamlText,
	};
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

export interface Splice {
	start: number;
	end: number;
	replacement: string;
}

/**
 * Apply non-overlapping byte-range replacements to `text` in one pass.
 * Splice order in the input array doesn't matter — they're sorted by
 * `start` before applying. Used by every write path in this file to touch
 * only the bytes an operation actually changed, leaving everything else
 * (comments, folded-scalar line wraps, indentation) byte-identical.
 */
export function applySplices(text: string, splices: Splice[]): string {
	const sorted = [...splices].sort((a, b) => a.start - b.start);
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i]!.start < sorted[i - 1]!.end) {
			throw new Error("applySplices: overlapping splices");
		}
	}
	let out = "";
	let cursor = 0;
	for (const s of sorted) {
		out += text.slice(cursor, s.start) + s.replacement;
		cursor = s.end;
	}
	return out + text.slice(cursor);
}

/** The indent (leading spaces/tabs) of the line containing byte offset `pos`. */
function lineIndent(text: string, pos: number): string {
	const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
	return (text.slice(lineStart, pos).match(/^[ \t]*/) ?? [""])[0];
}

/**
 * Render `value` the way the `yaml` package would inside a map with the
 * given flow-ness, without re-serializing anything else. Quoting rules
 * differ between flow and block context (`,` and `}` are structural only
 * in flow), so the throwaway document must match the real target's flow
 * setting for the quoting decision to come out right.
 */
function renderValue(value: string | number, flow: boolean): string {
	const tmp = parseDocument(flow ? "{ y: 0 }" : "y: 0");
	tmp.setIn(["y"], value);
	const rendered = tmp.toString({ lineWidth: 0 });
	return flow
		? rendered.replace(/^\{ y: /, "").replace(/ \}\n$/, "")
		: rendered.replace(/^y: /, "").replace(/\n$/, "");
}

/**
 * Render `value` the way `yaml` would if it overwrote the EXISTING scalar at
 * `originalValueText` in place — reusing that scalar's own raw source as a
 * skeleton so `setIn` (which preserves an existing node's style when only
 * its value changes) reproduces the same style (block-literal `|`,
 * block-folded `>`, plain, quoted, ...) for the new value instead of always
 * falling back to `renderValue`'s fresh plain rendering. `targetIndent` is
 * the original multi-line content's own indent (from its second line); a
 * skeleton parsed at a shallower nesting depth than the real document picks
 * yaml's own default indent step, which won't match unless the real
 * document happens to also use 2-space-per-level, so the rendered value's
 * continuation lines are re-indented to match.
 */
function renderValueLike(
	originalValueText: string,
	flow: boolean,
	newValue: string | number,
	targetIndent: string | null,
): string {
	const skeletonSrc = flow
		? `{ y: ${originalValueText} }`
		: `y: ${originalValueText}`;
	const tmp = parseDocument(skeletonSrc);
	tmp.setIn(["y"], newValue);
	const rendered = tmp.toString({ lineWidth: 0 });
	let extracted = flow
		? rendered.replace(/^\{ y: /, "").replace(/ \}\n$/, "")
		: rendered.replace(/^y: /, "").replace(/\n$/, "");
	if (!flow && targetIndent !== null && extracted.includes("\n")) {
		const lines = extracted.split("\n");
		const skeletonIndentMatch = lines[1]
			? (lines[1].match(/^[ \t]*/) as RegExpMatchArray)[0]
			: "";
		extracted = lines
			.map((line, i) => {
				if (i === 0 || line === "") return line;
				const dedented = line.startsWith(skeletonIndentMatch)
					? line.slice(skeletonIndentMatch.length)
					: line;
				return targetIndent + dedented;
			})
			.join("\n");
	}
	return extracted;
}

/**
 * Wrap `content` (a bare, unterminated new line of YAML) with whatever
 * leading/trailing newline the surrounding text is missing at `insertAt`,
 * checked against the single adjacent character. Never assumes based on
 * node type whether a boundary already has its own newline — block-map
 * and scalar `range` endpoints disagree on whether they swallow the
 * following newline, so the only reliable signal is the actual text.
 */
function padLine(
	yamlText: string,
	insertAt: number,
	content: string,
	newline: string,
): string {
	const before = yamlText.slice(0, insertAt);
	const afterChar = yamlText[insertAt];
	const lead = before.length > 0 && !before.endsWith("\n") ? newline : "";
	const trail =
		afterChar !== undefined && afterChar !== "\n" && afterChar !== "\r"
			? newline
			: "";
	return `${lead}${content}${trail}`;
}

/**
 * Compute the byte-range splice that sets `[kind, id, field]` to `value`,
 * without touching any other byte of `yamlText`. Returns `{ ok: false }`
 * when the node's field is an alias reference (splicing just the value
 * would desync it from whatever anchor it points at), when a field's
 * `Pair.value` is a raw `null` (an explicit-key field with no value line,
 * e.g. `? status` with no following `: value` — valid YAML, but there is no
 * `Node` range to splice into or anchor on), or when the parent map is an
 * empty block map (no sibling to anchor indentation on) — all rare enough
 * that callers fall back to full re-serialization.
 */
export function fieldValueSplice(
	yamlText: string,
	doc: Document,
	kind: NodeKind,
	id: string,
	field: string,
	value: string | number,
	newline: "\n" | "\r\n",
):
	| { ok: true; splice: Splice }
	| { ok: false; reason: "not-found" | "unsupported" } {
	const node = doc.getIn([kind, id], true);
	if (!isMap(node)) return { ok: false, reason: "not-found" };
	const pair = node.items.find((p) => isScalar(p.key) && p.key.value === field);

	if (pair) {
		if (pair.value === null) return { ok: false, reason: "unsupported" };
		if (isAlias(pair.value)) return { ok: false, reason: "unsupported" };
		const [start, end] = (pair.value as Node).range as [number, number, number];
		// A bare key with nothing after the colon (`status:`) still composes
		// to a real Scalar node — just a zero-width one, positioned
		// immediately after the colon with no space. Splicing straight into
		// that range would produce `status:done`: invalid YAML on re-parse
		// (MULTILINE_IMPLICIT_KEY) that merges the next field's key into the
		// corrupted line. Prepend the space the colon is missing.
		const needsSpace = start === end && yamlText[start - 1] === ":";
		// Reuse the EXISTING scalar's own raw source as the skeleton to
		// re-render from, rather than a style-agnostic throwaway (`renderValue`)
		// — this preserves block-literal (`|`), block-folded (`>`), and other
		// styles that a fresh plain rendering would otherwise flatten away.
		const originalValueText = yamlText.slice(start, end);
		const originalLines = originalValueText.split("\n");
		// A block scalar's first content line may legally be blank (a leading
		// blank line inside `|`/`>` is valid YAML), so a hardcoded index-1
		// lookup can land on an empty line and derive an empty indent. Skip
		// blank lines and use the first non-blank continuation line instead.
		const firstNonBlankContinuation = originalLines
			.slice(1)
			.find((line) => line.trim() !== "");
		// A block scalar's continuation lines may ALL be blank (a legal but
		// degenerate shape with no actual content) — there is then no line
		// to derive a safe reindent from, so `realTargetIndent` would be
		// `null`, which skips `renderValueLike`'s reindent entirely and
		// leaves the replacement at the throwaway skeleton's own indent
		// instead of the real document's. Decline the splice and let the
		// caller fall back to full re-serialization, which computes
		// indentation structurally instead of copying source text.
		if (originalLines.length > 1 && firstNonBlankContinuation === undefined) {
			return { ok: false, reason: "unsupported" };
		}
		const realTargetIndent =
			firstNonBlankContinuation !== undefined
				? (firstNonBlankContinuation.match(/^[ \t]*/) as RegExpMatchArray)[0]
				: null;
		let replacement = renderValueLike(
			originalValueText,
			!!node.flow,
			value,
			realTargetIndent,
		);
		// Multi-line block scalars' `range` swallows their own trailing
		// newline (unlike single-line scalars), so replacing the whole span
		// with a newline-less short value would glue the next field onto the
		// same line. Restore the separator the original span's own last
		// character shows was there.
		if (yamlText[end - 1] === "\n" && !replacement.endsWith("\n")) {
			replacement += "\n";
		}
		return {
			ok: true,
			splice: {
				start,
				end,
				replacement: needsSpace ? ` ${replacement}` : replacement,
			},
		};
	}

	const replacement = renderValue(value, !!node.flow);

	if (node.items.length === 0) {
		if (node.flow) {
			const openBrace = (node.range as [number, number, number])[0];
			return {
				ok: true,
				splice: {
					start: openBrace + 1,
					end: openBrace + 1,
					replacement: ` ${field}: ${replacement} `,
				},
			};
		}
		return { ok: false, reason: "unsupported" };
	}

	const last = node.items[node.items.length - 1]!;
	if (last.value === null) return { ok: false, reason: "unsupported" };
	const insertAt = ((last.value as Node).range as [number, number, number])[1];
	if (node.flow) {
		return {
			ok: true,
			splice: {
				start: insertAt,
				end: insertAt,
				replacement: `, ${field}: ${replacement}`,
			},
		};
	}
	const indent = lineIndent(
		yamlText,
		((last.key as Node).range as [number, number, number])[0],
	);
	const line = padLine(
		yamlText,
		insertAt,
		`${indent}${field}: ${replacement}`,
		newline,
	);
	return {
		ok: true,
		splice: { start: insertAt, end: insertAt, replacement: line },
	};
}

/**
 * Rewrite one node's field in `source`'s frontmatter, preserving everything
 * else (comments, quote style, flow-vs-block, and — unlike a full
 * `Document#toString()` round trip — the exact line-wrap positions of any
 * untouched folded/literal block scalar) byte-for-byte. Used by `meta set`
 * (ADR-0034). Quoting for the new value is left to the `yaml` package's own
 * core-schema judgment — pass a `number` for integer fields (e.g. `index`)
 * and a `string` for everything else. Returns null when there is no
 * frontmatter, or when `id` has no entry under `kind`.
 */
export function setFrontmatterField(
	source: string,
	kind: NodeKind,
	id: string,
	field: string,
	value: string | number,
): string | null {
	const { present, doc, body, newline, yamlText } = parseFrontmatterCst(source);
	if (!present || !doc.hasIn([kind, id])) return null;

	const result = fieldValueSplice(
		yamlText,
		doc,
		kind,
		id,
		field,
		value,
		newline,
	);
	if (result.ok) {
		const newYamlText = applySplices(yamlText, [result.splice]);
		return `---${newline}${newYamlText}${newline}---${newline}${body}`;
	}

	// Alias reference, null-valued field, or empty block map: nothing safe to
	// splice, fall back to the pre-existing full re-serialize path.
	doc.setIn([kind, id, field], value);
	return renderFrontmatterCst(doc, newline) + body;
}

/** Renders `key` the way `yaml` would quote it as a plain map key. */
function renderKey(key: string): string {
	const tmp = parseDocument("0: 0");
	tmp.set(key, 0);
	const line = tmp
		.toString({ lineWidth: 0 })
		.split("\n")
		.find((l) => l.endsWith(": 0") && !l.startsWith("0:"));
	return (line as string).slice(0, -": 0".length);
}

/**
 * Learn the file's actual per-level indent step from an existing sibling
 * entry's own nested field, instead of assuming the canonical 2 spaces —
 * indentation normalization is `fmt`'s job, not this function's.
 */
function childIndentStep(
	items: readonly { key: unknown; value: unknown }[],
	yamlText: string,
): number {
	for (const item of items) {
		const value = item.value;
		if (isMap(value) && value.items.length > 0) {
			const parentIndent = lineIndent(yamlText, (item.key as Node).range![0]);
			const childKey = value.items[0]!.key as Node;
			const childIndent = lineIndent(yamlText, childKey.range![0]);
			if (childIndent.length > parentIndent.length) {
				return childIndent.length - parentIndent.length;
			}
		}
	}
	return 2;
}

/**
 * Compute the byte-range splice that creates a brand-new `[kind, id]`
 * frontmatter entry with exactly one field (`field: value`), without
 * touching any other byte of `yamlText`. Shared by `insertDefinition`
 * (always `field: "label"`) and `reindex` (always `field: "index"`) — the
 * two places in this codebase that need to create a node's frontmatter
 * entry from nothing rather than edit an existing one (`fieldValueSplice`
 * handles the latter). Returns `{ ok: false, reason: "unsupported" }` when
 * there is no sibling entry to anchor indentation on (an empty block-style
 * `kind:` section, or an entirely empty document) — callers fall back to
 * full re-serialization for that rare case.
 */
export function newEntrySplice(
	yamlText: string,
	doc: Document,
	kind: "artifact" | "process",
	id: string,
	field: string,
	value: string | number,
	newline: "\n" | "\r\n",
): { ok: true; splice: Splice } | { ok: false; reason: "unsupported" } {
	const idKey = renderKey(id);
	const kindNode = doc.get(kind, true);

	if (isMap(kindNode) && kindNode.items.length > 0) {
		const last = kindNode.items[kindNode.items.length - 1]!;
		const insertAt = (last.value as Node).range![1];
		if (kindNode.flow) {
			return {
				ok: true,
				splice: {
					start: insertAt,
					end: insertAt,
					replacement: `, ${idKey}: { ${field}: ${renderValue(value, true)} }`,
				},
			};
		}
		const indent = lineIndent(yamlText, (last.key as Node).range![0]);
		const step = childIndentStep(kindNode.items, yamlText);
		const childIndent = indent + " ".repeat(step);
		const content =
			`${indent}${idKey}:\n${childIndent}${field}: ${renderValue(value, false)}`.replace(
				/\n/g,
				newline,
			);
		const line = padLine(yamlText, insertAt, content, newline);
		return {
			ok: true,
			splice: { start: insertAt, end: insertAt, replacement: line },
		};
	}

	if (isMap(kindNode) && kindNode.items.length === 0) {
		if (kindNode.flow) {
			const openBrace = (kindNode as unknown as Node).range![0];
			return {
				ok: true,
				splice: {
					start: openBrace + 1,
					end: openBrace + 1,
					replacement: ` ${idKey}: { ${field}: ${renderValue(value, true)} } `,
				},
			};
		}
		return { ok: false, reason: "unsupported" };
	}

	if (doc.has(kind)) {
		// `kind` key exists but isn't a map (e.g. bare `artifact:` with a null
		// value) — no sibling text to anchor on, and not safe to treat as a
		// fresh top-level key either (that would duplicate the existing key).
		return { ok: false, reason: "unsupported" };
	}

	// `kind` section doesn't exist yet — insert it as a new top-level key.
	const rootMap = doc.contents;
	if (!isMap(rootMap) || rootMap.items.length === 0) {
		return { ok: false, reason: "unsupported" };
	}
	const last = rootMap.items[rootMap.items.length - 1]!;
	const insertAt = (last.value as Node).range![1];
	const kindKey = renderKey(kind);
	const content =
		`${kindKey}:\n  ${idKey}:\n    ${field}: ${renderValue(value, false)}`.replace(
			/\n/g,
			newline,
		);
	const line = padLine(yamlText, insertAt, content, newline);
	return {
		ok: true,
		splice: { start: insertAt, end: insertAt, replacement: line },
	};
}
