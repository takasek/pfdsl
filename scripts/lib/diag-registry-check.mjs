/**
 * Pure functions for diffing spec.md's §16 diagnostic code table against the
 * DIAGNOSTIC_REGISTRY exported by @pfdsl/core. Network/FS I/O and the core
 * import live in the main script; this module stays testable without a build.
 */

import { findNumberedSectionIds } from "./spec-id-check.mjs";

const SEVERITY_LABELS = {
	error: ["error"],
	warning: ["warning"],
	"warning (--strict: error)": ["warning", "error"],
};

/**
 * Parses the `| コード | severity | 定義節 | 条件 |` markdown table out of
 * spec.md's §16. Returns a map of code -> normalized severities array.
 * Throws if a severity cell doesn't match a known label.
 *
 * @param {string} specText
 * @returns {Record<string, string[]>}
 */
export function parseSpecDiagTable(specText) {
	const result = {};
	for (const { code, severityCell } of specDiagRows(specText)) {
		const severities = SEVERITY_LABELS[severityCell];
		if (!severities) {
			throw new Error(
				`spec.md §16 table: unrecognized severity "${severityCell}" for code ${code}`,
			);
		}
		result[code] = severities;
	}
	return result;
}

function specDiagRows(specText) {
	const lines = specText.split("\n");
	const headerIdx = lines.findIndex((l) =>
		/^\|\s*コード\s*\|\s*severity\s*\|/.test(l),
	);
	if (headerIdx === -1) {
		throw new Error("§16 diagnostic code table header not found in spec.md");
	}

	const result = [];
	// Row format: | CODE | severity | §section | condition text |
	const ROW_RE = /^\|\s*([A-Z]+\d+)\s*\|\s*([^|]+?)\s*\|/;

	for (let i = headerIdx + 2; i < lines.length; i++) {
		const line = lines[i];
		if (!line.startsWith("|")) break; // table ended
		const m = line.match(ROW_RE);
		if (!m) continue;
		const [, code, severityCell] = m;
		result.push({
			code,
			severityCell,
			sectionCell: line.slice(m[0].length).split("|")[0].trim(),
		});
	}

	return result;
}

/** @returns {Record<string, string | null>} */
export function parseSpecDiagSections(specText) {
	const sectionsById = new Map(
		[...findNumberedSectionIds(specText)].map(([section, id]) => [id, section]),
	);
	const result = {};
	for (const { code, sectionCell } of specDiagRows(specText)) {
		const literal = /^§(\d+(?:\.\d+)*)$/.exec(sectionCell);
		const ref = /^\[\[(SPEC_[A-Za-z0-9_]+)\]\]$/.exec(sectionCell);
		result[code] = literal
			? literal[1]
			: ref
				? (sectionsById.get(ref[1]) ?? null)
				: null;
	}
	return result;
}

/**
 * @param {Record<string, string | null>} specSections
 * @param {Record<string, {section: string}>} registry
 * @returns {string[]}
 */
export function diffDiagSections(specSections, registry) {
	return Object.keys(specSections)
		.filter(
			(code) =>
				code in registry && specSections[code] !== registry[code].section,
		)
		.sort();
}

/** @returns {Record<string, string | null>} code -> spec ID, null for a cell that cites a section number */
export function parseSpecDiagSpecIds(specText) {
	const result = {};
	for (const { code, sectionCell } of specDiagRows(specText)) {
		result[code] =
			/^\[\[(SPEC_[A-Za-z0-9_]+)\]\]$/.exec(sectionCell)?.[1] ?? null;
	}
	return result;
}

/**
 * @param {Record<string, string | null>} specIds
 * @param {Record<string, {specId?: string}>} registry
 * @returns {string[]}
 */
export function diffDiagSpecIds(specIds, registry) {
	return Object.keys(specIds)
		.filter(
			(code) =>
				code in registry && specIds[code] !== (registry[code].specId ?? null),
		)
		.sort();
}

/**
 * Compares the spec.md table entries against the DIAGNOSTIC_REGISTRY.
 *
 * @param {Record<string, string[]>} specCodes
 * @param {Record<string, {severities: readonly string[]}>} registry
 * @returns {{missingInSpec: string[], staleInSpec: string[], severityMismatches: string[]}}
 */
export function diffDiagRegistry(specCodes, registry) {
	const missingInSpec = Object.keys(registry).filter(
		(code) => !(code in specCodes),
	);
	const staleInSpec = Object.keys(specCodes).filter(
		(code) => !(code in registry),
	);
	const severityMismatches = Object.keys(specCodes)
		.filter((code) => code in registry)
		.filter((code) => {
			const a = [...specCodes[code]].sort();
			const b = [...registry[code].severities].sort();
			return JSON.stringify(a) !== JSON.stringify(b);
		});

	return {
		missingInSpec: missingInSpec.sort(),
		staleInSpec: staleInSpec.sort(),
		severityMismatches: severityMismatches.sort(),
	};
}

/**
 * check-diag-registry.mjs orchestration: four independent drift kinds each
 * set `failed` and print their own message; none of that wiring was tested
 * (#645) — only parseSpecDiagTable/diffDiagRegistry had tests. This guards
 * against e.g. an accidental `else if` between checks, which would
 * silently stop reporting all but the first kind of drift found.
 *
 * No I/O: takes the already-diffed result plus the spec code count for the
 * OK message. The dynamic `import()` of packages/core/dist/index.js stays a
 * module-load boundary in the main script, not injected here.
 *
 * @param {{missingInSpec: string[], staleInSpec: string[], severityMismatches: string[], sectionMismatches: string[], specIdMismatches: string[], specCodesCount: number}} args
 * @returns {{exitCode: 0|1, stdoutLines: string[], stderrLines: string[]}}
 */
export function evaluateDiagRegistryDiff({
	missingInSpec,
	staleInSpec,
	severityMismatches,
	sectionMismatches,
	specIdMismatches,
	specCodesCount,
}) {
	for (const [name, value] of Object.entries({
		missingInSpec,
		staleInSpec,
		severityMismatches,
		sectionMismatches,
		specIdMismatches,
	})) {
		if (!Array.isArray(value)) {
			throw new TypeError(`evaluateDiagRegistryDiff: ${name} must be an array`);
		}
	}
	const stderrLines = [];
	let failed = false;

	if (missingInSpec.length > 0) {
		failed = true;
		stderrLines.push(
			`Codes emitted by core but missing from spec.md §16 table: ${missingInSpec.join(", ")}`,
		);
	}
	if (staleInSpec.length > 0) {
		failed = true;
		stderrLines.push(
			`Codes in spec.md §16 table but not emitted by core (stale): ${staleInSpec.join(", ")}`,
		);
	}
	if (severityMismatches.length > 0) {
		failed = true;
		stderrLines.push(
			`Severity mismatch between spec.md §16 table and core registry: ${severityMismatches.join(", ")}`,
		);
	}

	if (sectionMismatches.length > 0) {
		failed = true;
		stderrLines.push(
			`Section mismatch between spec.md §16 table and core registry: ${sectionMismatches.join(", ")}`,
		);
	}

	if (specIdMismatches.length > 0) {
		failed = true;
		stderrLines.push(
			`Spec ID mismatch between spec.md §16 table and core registry: ${specIdMismatches.join(", ")}`,
		);
	}

	if (failed) {
		stderrLines.push(
			"\ncheck-diag-registry: FAILED. Update docs/spec/spec.md §16 and/or packages/core/src/diagnostics-registry.ts to match.",
		);
		return { exitCode: 1, stdoutLines: [], stderrLines };
	}
	return {
		exitCode: 0,
		stdoutLines: [`check-diag-registry: OK (${specCodesCount} codes match)`],
		stderrLines: [],
	};
}
