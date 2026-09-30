/**
 * Pure functions for marker-based forward-reference resolution: matches
 * `[[SPEC_<slug>?]]` forward-ref markers (anywhere in prose) against
 * `(SPEC_<slug>)` id definitions (trailing on a heading line) by id. This
 * only does the mechanical cross-referencing — whether a match means the
 * forward-ref is actually stale is left to human judgment. See #326.
 *
 * Note: strict references `[[SPEC_<slug>]]` (no trailing `?`) are a separate,
 * not-yet-implemented construct reserved for #328 and are ignored here.
 */

import { isHeading } from "./markdown-heading.mjs";

const FORWARD_REF_RE = /\[\[SPEC_([A-Za-z0-9_]+)\?\]\]/g;
const IMPLEMENTS_TRAILING_RE = /\(SPEC_([A-Za-z0-9_]+)\)\s*$/;
// A run of three or more backticks or tildes at the start of a line. A backtick fence's info string cannot contain a backtick, or the line is inline code rather than a fence.
const FENCE_OPEN_RE = /^(`{3,}(?!.*`)|~{3,})/;
const FENCE_CLOSE_RE = /^(`{3,}|~{3,})\s*$/;

/**
 * Visits each line outside a fenced code block. A fence closes only on a line
 * of the opener's character, at least as long as the opener, with nothing after
 * it (CommonMark), so a differing marker or a shorter run inside a block does
 * not end it. Fences indented under a list item are not recognized.
 * @param {string} text
 * @param {(line: string, lineNumber: number, hits: Array<{line: number, id: string}>) => void} visit
 */
export function forEachNonFencedLine(text, visit) {
	const lines = text.split("\n");
	let fence = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (fence === null) {
			const open = FENCE_OPEN_RE.exec(line);
			if (open) {
				fence = open[1];
				continue;
			}
			visit(line, i + 1);
			continue;
		}
		const close = FENCE_CLOSE_RE.exec(line);
		if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
			fence = null;
		}
	}
}

/**
 * @param {string} text
 * @returns {Array<{line: number, id: string}>}
 */
export function findForwardRefMarkers(text) {
	const hits = [];
	forEachNonFencedLine(text, (line, lineNumber) => {
		for (const match of line.matchAll(FORWARD_REF_RE)) {
			hits.push({ line: lineNumber, id: `SPEC_${match[1]}` });
		}
	});
	return hits;
}

/**
 * @param {string} text
 * @returns {Array<{line: number, id: string}>}
 */
export function findImplementsMarkers(text) {
	const hits = [];
	forEachNonFencedLine(text, (line, lineNumber) => {
		if (!isHeading(line)) return;
		const match = IMPLEMENTS_TRAILING_RE.exec(line);
		if (!match) return;
		hits.push({ line: lineNumber, id: `SPEC_${match[1]}` });
	});
	return hits;
}

/**
 * @param {Array<{file: string, line: number, id: string}>} forwardRefHits
 * @param {Array<{file: string, line: number, id: string}>} implementsHits
 * @returns {Array<{id: string, forwardRefs: Array<{file: string, line: number, id: string}>, implements: Array<{file: string, line: number, id: string}>}>}
 */
export function matchResolvedForwardRefs(forwardRefHits, implementsHits) {
	const resolved = [];
	const seenIds = new Set();
	for (const hit of forwardRefHits) {
		if (seenIds.has(hit.id)) continue;
		const matchingImplements = implementsHits.filter((i) => i.id === hit.id);
		if (matchingImplements.length === 0) continue;
		seenIds.add(hit.id);
		resolved.push({
			id: hit.id,
			forwardRefs: forwardRefHits.filter((h) => h.id === hit.id),
			implements: matchingImplements,
		});
	}
	return resolved;
}

/**
 * @param {Array<{id: string, forwardRefs: Array<{file: string, line: number, id: string}>, implements: Array<{file: string, line: number, id: string}>}>} resolved
 * @returns {string}
 */
export function formatResolvedForwardRefs(resolved) {
	return resolved
		.map((r) => {
			const forwardRefLines = r.forwardRefs
				.map((h) => `${h.file}:${h.line}`)
				.join(", ");
			const implementsLines = r.implements
				.map((h) => `${h.file}:${h.line}`)
				.join(", ");
			return `id "${r.id}": forward-ref at ${forwardRefLines} <- implements at ${implementsLines}`;
		})
		.join("\n");
}
