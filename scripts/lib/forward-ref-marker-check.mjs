/**
 * Pure functions for marker-based forward-reference resolution: matches
 * `<!-- forward-ref: <id> -->` markers against `<!-- implements: <id> -->`
 * markers by id. This only does the mechanical cross-referencing — whether a
 * match means the forward-ref is actually stale is left to human judgment.
 * See #326 (complements the phrase-grep in stale-forward-ref-check.mjs).
 */

const FORWARD_REF_RE = /<!--\s*forward-ref:\s*(\S+?)\s*-->/g;
const IMPLEMENTS_RE = /<!--\s*implements:\s*(\S+?)\s*-->/g;

/**
 * @param {string} text
 * @param {RegExp} re
 * @returns {Array<{line: number, id: string}>}
 */
function findMarkers(text, re) {
	const hits = [];
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		re.lastIndex = 0;
		let match;
		while ((match = re.exec(line)) !== null) {
			hits.push({ line: i + 1, id: match[1] });
		}
	}
	return hits;
}

/**
 * @param {string} text
 * @returns {Array<{line: number, id: string}>}
 */
export function findForwardRefMarkers(text) {
	return findMarkers(text, FORWARD_REF_RE);
}

/**
 * @param {string} text
 * @returns {Array<{line: number, id: string}>}
 */
export function findImplementsMarkers(text) {
	return findMarkers(text, IMPLEMENTS_RE);
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
