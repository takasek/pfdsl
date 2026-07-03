// Detects drift between the typed frontmatter fields in
// packages/core/src/types/frontmatter.ts and the "Frontmatter structure"
// section of the pfdsl skill template. Every typed field must be mentioned
// (as a word) somewhere in that section — either as a YAML key in the block
// or by name in a pointer line. Used by scripts/gen-skill.mjs.

const SECTION_HEADING = "## Frontmatter structure";

// Interfaces to audit, in report order. Others (e.g. LoadResult) are ignored.
const AUDITED_INTERFACES = [
	"Frontmatter",
	"ArtifactMeta",
	"ProcessMeta",
	"GroupMeta",
	"TagMeta",
];

/**
 * Parse `export interface X { ... }` bodies and return top-level property
 * names per interface. Skips index signatures and properties of nested
 * object literal types (e.g. layout's direction/maxWidth).
 */
export function extractTypedFields(tsSource) {
	const result = {};
	const lines = tsSource.split("\n");
	let current = null;
	let depth = 0;

	for (const line of lines) {
		if (current === null) {
			const m = line.match(/^export interface (\w+)\s*\{/);
			if (m) {
				current = m[1];
				result[current] = [];
				depth = 1;
			}
			continue;
		}

		if (depth === 1) {
			const prop = line.match(/^\s*([A-Za-z_]\w*)\??:/);
			if (prop) result[current].push(prop[1]);
		}
		depth += (line.match(/\{/g) ?? []).length;
		depth -= (line.match(/\}/g) ?? []).length;
		if (depth <= 0) current = null;
	}
	return result;
}

/**
 * Return the text of a markdown section: from the heading line up to the
 * next heading of the same level (or EOF). Throws if the heading is absent.
 */
export function extractSectionText(source, heading = SECTION_HEADING) {
	const lines = source.split("\n");
	const start = lines.findIndex((l) => l.trim() === heading);
	if (start === -1) {
		throw new Error(`section heading not found: ${heading}`);
	}
	const level = heading.match(/^#+/)[0];
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((l) => l.startsWith(`${level} `));
	const body = end === -1 ? rest : rest.slice(0, end);
	return [lines[start], ...body].join("\n");
}

/**
 * Return `Interface.field` entries for every typed field not mentioned in
 * the template's frontmatter-structure section.
 */
export function findMissingFields(tsSource, templateSource) {
	const typed = extractTypedFields(tsSource);
	const section = extractSectionText(templateSource);
	const missing = [];
	for (const iface of AUDITED_INTERFACES) {
		for (const field of typed[iface] ?? []) {
			if (!new RegExp(`\\b${field}\\b`).test(section)) {
				missing.push(`${iface}.${field}`);
			}
		}
	}
	return missing;
}
