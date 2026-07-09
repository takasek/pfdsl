/**
 * Pure functions for the SPEC_<id> strict-reference lint (#328): matches
 * `(SPEC_<id>)` id definitions (any non-fenced, non-inline-code line — heading,
 * list item, table row, or bare paragraph) against `[[SPEC_<id>]]` strict
 * references, so callers can flag (a) an id defined more than once and (b) a
 * strict reference with no matching definition anywhere in the corpus.
 *
 * Permissive references `[[SPEC_<id>?]]` are a separate, already-implemented
 * construct (see forward-ref-marker-check.mjs, #326) and are ignored here —
 * the strict-ref regex below never matches a trailing `?` since `?` isn't in
 * the id character class.
 */

import { forEachNonFencedLine } from "./forward-ref-marker-check.mjs";

const DEFINITION_RE = /\(SPEC_([A-Za-z0-9_]+)\)/g;
const STRICT_REF_RE = /\[\[SPEC_([A-Za-z0-9_]+)\]\]/g;
const INLINE_CODE_RE = /`[^`]*`/g;

/**
 * Blanks out inline code spans (single backtick pairs) on a line so markers
 * quoted inside them aren't matched. Doesn't handle multi-backtick fences
 * (`` `` ``); a single backtick pair is the required minimum (#328).
 * @param {string} line
 * @returns {string}
 */
function stripInlineCode(line) {
	return line.replace(INLINE_CODE_RE, "");
}

/**
 * @param {string} text
 * @returns {Array<{line: number, id: string}>}
 */
export function findSpecIdDefinitions(text) {
	const hits = [];
	forEachNonFencedLine(text, (line, lineNumber) => {
		const stripped = stripInlineCode(line);
		DEFINITION_RE.lastIndex = 0;
		let match;
		while ((match = DEFINITION_RE.exec(stripped)) !== null) {
			hits.push({ line: lineNumber, id: `SPEC_${match[1]}` });
		}
	});
	return hits;
}

/**
 * @param {string} text
 * @returns {Array<{line: number, id: string}>}
 */
export function findStrictRefs(text) {
	const hits = [];
	forEachNonFencedLine(text, (line, lineNumber) => {
		const stripped = stripInlineCode(line);
		STRICT_REF_RE.lastIndex = 0;
		let match;
		while ((match = STRICT_REF_RE.exec(stripped)) !== null) {
			hits.push({ line: lineNumber, id: `SPEC_${match[1]}` });
		}
	});
	return hits;
}

/**
 * @param {Array<{file: string, line: number, id: string}>} definitionHits
 * @returns {Array<{id: string, definitions: Array<{file: string, line: number, id: string}>}>}
 */
export function findDuplicateDefinitions(definitionHits) {
	const byId = new Map();
	for (const hit of definitionHits) {
		if (!byId.has(hit.id)) byId.set(hit.id, []);
		byId.get(hit.id).push(hit);
	}
	const duplicates = [];
	for (const [id, definitions] of byId) {
		if (definitions.length > 1) duplicates.push({ id, definitions });
	}
	return duplicates;
}

/**
 * @param {Array<{file: string, line: number, id: string}>} strictRefHits
 * @param {Array<{file: string, line: number, id: string}>} definitionHits
 * @returns {Array<{id: string, refs: Array<{file: string, line: number, id: string}>}>}
 */
export function findDanglingStrictRefs(strictRefHits, definitionHits) {
	const definedIds = new Set(definitionHits.map((hit) => hit.id));
	const byId = new Map();
	for (const hit of strictRefHits) {
		if (definedIds.has(hit.id)) continue;
		if (!byId.has(hit.id)) byId.set(hit.id, []);
		byId.get(hit.id).push(hit);
	}
	return [...byId.entries()].map(([id, refs]) => ({ id, refs }));
}

/**
 * @param {Array<{id: string, definitions: Array<{file: string, line: number, id: string}>}>} duplicates
 * @param {Array<{id: string, refs: Array<{file: string, line: number, id: string}>}>} dangling
 * @returns {string}
 */
export function formatSpecIdViolations(duplicates, dangling) {
	const lines = [];
	for (const dup of duplicates) {
		const locations = dup.definitions.map((h) => `${h.file}:${h.line}`).join(", ");
		lines.push(`duplicate definition of id "${dup.id}" at ${locations}`);
	}
	for (const dang of dangling) {
		const locations = dang.refs.map((h) => `${h.file}:${h.line}`).join(", ");
		lines.push(
			`dangling strict reference "${dang.id}" at ${locations} — no matching (${dang.id}) definition`,
		);
	}
	return lines.join("\n");
}
