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

const FORWARD_REF_RE = /\[\[SPEC_([A-Za-z0-9_]+)\?\]\]/g;
const HEADING_RE = /^#{1,6}\s/;
const IMPLEMENTS_TRAILING_RE = /\(SPEC_([A-Za-z0-9_]+)\)\s*$/;
const FENCE_RE = /^(```|~~~)/;

/**
 * @param {string} text
 * @param {(line: string, lineNumber: number, hits: Array<{line: number, id: string}>) => void} visit
 */
export function forEachNonFencedLine(text, visit) {
	const lines = text.split("\n");
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (FENCE_RE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		visit(line, i + 1);
	}
}

/**
 * @param {string} text
 * @returns {Array<{line: number, id: string}>}
 */
export function findForwardRefMarkers(text) {
	const hits = [];
	forEachNonFencedLine(text, (line, lineNumber) => {
		FORWARD_REF_RE.lastIndex = 0;
		let match;
		while ((match = FORWARD_REF_RE.exec(line)) !== null) {
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
		if (!HEADING_RE.test(line)) return;
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
