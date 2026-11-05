/**
 * Pure functions for the SPEC_<id> strict-reference lint (#328): matches
 * `(SPEC_<id>)` id definitions outside parsed code blocks and code spans
 * (heading, list item, table row, or bare paragraph) against `[[SPEC_<id>]]` strict
 * references, so callers can flag (a) an id defined more than once and (b) a
 * strict reference with no matching definition anywhere in the corpus.
 *
 * Permissive references `[[SPEC_<id>?]]` are a separate, already-implemented
 * construct (see forward-ref-marker-check.mjs, #326) and are ignored here —
 * the strict-ref regex below never matches a trailing `?` since `?` isn't in
 * the id character class.
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTable } from "micromark-extension-gfm-table";

const DEFINITION_RE = /\(SPEC_([A-Za-z0-9_]+)\)/g;
const STRICT_REF_RE = /\[\[SPEC_([A-Za-z0-9_]+)\]\]/g;

/**
 * Masks parsed code blocks and code spans without joining surrounding prose
 * or changing line numbers. SPEC syntax remains matched against source text.
 */
function nonCodeLines(text) {
	const chars = text.split("");
	function visit(node) {
		if (node.type === "code" || node.type === "inlineCode") {
			for (
				let i = node.position.start.offset;
				i < node.position.end.offset;
				i++
			) {
				if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
			}
			return;
		}
		for (const child of node.children ?? []) visit(child);
	}
	visit(
		fromMarkdown(text, {
			extensions: [gfmTable()],
			mdastExtensions: [gfmTableFromMarkdown()],
		}),
	);
	return chars.join("").split("\n");
}

/**
 * @param {string} text
 * @returns {Array<{line: number, id: string}>}
 */
export function findSpecIdDefinitions(text) {
	const hits = [];
	nonCodeLines(text).forEach((line, index) => {
		for (const match of line.matchAll(DEFINITION_RE)) {
			hits.push({ line: index + 1, id: `SPEC_${match[1]}` });
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
	nonCodeLines(text).forEach((line, index) => {
		for (const match of line.matchAll(STRICT_REF_RE)) {
			hits.push({ line: index + 1, id: `SPEC_${match[1]}` });
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
		const locations = dup.definitions
			.map((h) => `${h.file}:${h.line}`)
			.join(", ");
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
