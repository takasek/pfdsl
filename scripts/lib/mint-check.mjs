/**
 * Pure functions for the mint-check tool (#405): before minting a new spec ID
 * slug, enumerate every prior occurrence of that slug so the minter can see a
 * collision before it happens. Composes the three occurrence finders defined
 * for the SPEC_<id> cross-reference system (ADR-0027):
 *
 *   - definition    `(SPEC_<slug>)`   — findSpecIdDefinitions (#328)
 *   - strict-ref    `[[SPEC_<slug>]]` — findStrictRefs (#328)
 *   - forward-ref   `[[SPEC_<slug>?]]` — findForwardRefMarkers (#326)
 *
 * The forward-ref kind is the reason this tool exists: a forward-ref marker is
 * a permissive reference with no required definition, so minting the same slug
 * for a *different* concept is neither a duplicate nor a dangling error — it
 * slips past check-spec-ids and only surfaces as a misleading "likely
 * resolved" reminder (ADR-0027 §"ID の性質"). mint-check catches it up front.
 *
 * tombstone (the 4th kind named in ADR-0027) is out of scope until the first
 * ID deletion introduces the tombstone list's concrete form (#405 defers it).
 *
 * No I/O — callers read files and pass text in, mirroring the sibling libs.
 */

import { findSpecIdDefinitions, findStrictRefs } from "./spec-id-check.mjs";
import { findForwardRefMarkers } from "./forward-ref-marker-check.mjs";

/**
 * Ensure the argument carries the fixed `SPEC_` prefix (ADR-0027 §"命名").
 * @param {string} input
 * @returns {string}
 */
export function normalizeId(input) {
	return input.startsWith("SPEC_") ? input : `SPEC_${input}`;
}

/**
 * Find every occurrence of `id` in a single file's text, labeled by kind and
 * carrying the source line text for reporting.
 * @param {string} id  normalized SPEC_ id
 * @param {string} file
 * @param {string} text
 * @returns {Array<{kind: string, file: string, line: number, id: string, text: string}>}
 */
export function findOccurrencesInText(id, file, text) {
	const lines = text.split("\n");
	const labeled = [
		["definition", findSpecIdDefinitions(text)],
		["strict-ref", findStrictRefs(text)],
		["forward-ref", findForwardRefMarkers(text)],
	];
	const occurrences = [];
	for (const [kind, hits] of labeled) {
		for (const hit of hits) {
			if (hit.id !== id) continue;
			occurrences.push({
				kind,
				file,
				line: hit.line,
				id: hit.id,
				text: lines[hit.line - 1] ?? "",
			});
		}
	}
	occurrences.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
	return occurrences;
}

/**
 * Render occurrences as `file:line: kind text` lines (ADR-0027 / #405 output).
 * @param {Array<{kind: string, file: string, line: number, text: string}>} occurrences
 * @returns {string}
 */
export function formatOccurrences(occurrences) {
	return occurrences
		.map((o) => `${o.file}:${o.line}: ${o.kind} ${o.text}`.trimEnd())
		.join("\n");
}

/**
 * Exit code contract (#405): a prior occurrence blocks the mint → 1; none → 0.
 * @param {Array<unknown>} occurrences
 * @returns {0 | 1}
 */
export function mintCheckExitCode(occurrences) {
	return occurrences.length > 0 ? 1 : 0;
}
