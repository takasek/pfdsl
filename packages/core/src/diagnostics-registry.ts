import type { DiagnosticSeverity } from "./types/index.js";

export interface DiagnosticRegistryEntry {
	/** Severities this code can be emitted with. Usually one entry; two for
	 * codes whose severity depends on `options?.strict` (W002, W005). */
	severities: readonly DiagnosticSeverity[];
}

/**
 * Registry of every diagnostic code emittable by
 * frontmatter.ts / parser.ts / validator.ts / multifile.ts.
 *
 * Kept honest by diagnostics-registry.test.ts, which extracts every
 * `code: "..."` / `severity: ...` pair actually present in those source
 * files and diffs it against this table. Update both together.
 *
 * Note: P009 does not exist in source (reserved/unused). V013 was retired
 * by #310 (location on Process is now permitted) and intentionally has no
 * entry here.
 */
export const DIAGNOSTIC_REGISTRY: Readonly<
	Record<string, DiagnosticRegistryEntry>
> = {
	FM001: { severities: ["error"] },
	FM002: { severities: ["error"] },

	P001: { severities: ["error"] },
	P002: { severities: ["error"] },
	P003: { severities: ["error"] },
	P004: { severities: ["error"] },
	P005: { severities: ["error"] },
	P006: { severities: ["error"] },
	P007: { severities: ["error"] },
	P008: { severities: ["error"] },
	P010: { severities: ["error"] },
	P011: { severities: ["error"] },

	V001: { severities: ["error"] },
	V002: { severities: ["error"] },
	V003: { severities: ["error"] },
	V004: { severities: ["error"] },
	V005: { severities: ["error"] },
	V006: { severities: ["error"] },
	V007: { severities: ["error"] },
	V008: { severities: ["error"] },
	V009: { severities: ["error"] },
	V010: { severities: ["error"] },
	V011: { severities: ["error"] },
	V012: { severities: ["error"] },
	V014: { severities: ["error"] },
	V015: { severities: ["error"] },
	V016: { severities: ["error"] },
	V017: { severities: ["error"] },
	V018: { severities: ["error"] },
	V019: { severities: ["error"] },
	V020: { severities: ["error"] },
	V021: { severities: ["error"] },
	V022: { severities: ["error"] },
	V023: { severities: ["error"] },
	V024: { severities: ["error"] },
	V025: { severities: ["error"] },
	V026: { severities: ["error"] },
	V027: { severities: ["error"] },
	V028: { severities: ["error"] },
	V029: { severities: ["error"] },
	V030: { severities: ["error"] },
	V031: { severities: ["error"] },
	V032: { severities: ["error"] },
	V033: { severities: ["error"] },
	V034: { severities: ["error"] },

	W001: { severities: ["warning"] },
	W002: { severities: ["warning", "error"] },
	W003: { severities: ["warning"] },
	W004: { severities: ["warning"] },
	W005: { severities: ["warning", "error"] },
	W006: { severities: ["warning"] },
};

const CODE_RE = /code:\s*"([A-Z]+\d+)"/g;
const STRICT_TERNARY_RE = /options\?\.strict\s*\?\s*"error"\s*:\s*"warning"/;
const PLAIN_SEVERITY_RE = /"(error|warning|info)"/;

/**
 * Scan TS source for every `{ ... code: "X001", ... }`-shaped diagnostic
 * object literal and return a map of code -> severities found in that same
 * object literal. `severity:` may appear before or after `code:` in the
 * literal; this function looks in a small window of source around the code
 * match rather than assuming a fixed order.
 */
export function extractDiagnosticCodesFromSource(
	source: string,
): Record<string, string[]> {
	const result: Record<string, string[]> = {};

	for (const match of source.matchAll(CODE_RE)) {
		const code = match[1];
		if (code === undefined) continue;
		const idx = match.index ?? 0;
		// Look at the enclosing object literal: scan back to the nearest
		// `{` and forward to the nearest `}` from the code match.
		const openIdx = source.lastIndexOf("{", idx);
		const closeIdx = source.indexOf("}", idx);
		const windowStart = openIdx === -1 ? Math.max(0, idx - 200) : openIdx;
		const windowEnd = closeIdx === -1 ? source.length : closeIdx;
		const window = source.slice(windowStart, windowEnd);

		let severities: string[];
		if (STRICT_TERNARY_RE.test(window)) {
			severities = ["warning", "error"];
		} else {
			const sevMatch = window.match(PLAIN_SEVERITY_RE);
			severities = sevMatch?.[1] !== undefined ? [sevMatch[1]] : [];
		}

		result[code] = severities;
	}

	return result;
}
