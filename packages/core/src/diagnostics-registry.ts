import type { DiagnosticSeverity } from "./types/index.js";

export interface DiagnosticRegistryEntry {
	/** Severities this code can be emitted with. Usually one entry; two for
	 * codes whose severity depends on `options?.strict` (W002, W005). */
	severities: readonly DiagnosticSeverity[];
	/** Spec section number (without the `§` prefix) that normatively defines
	 * the condition this code checks, e.g. "15.11". Matches spec.md §16's
	 * 定義節 column. Used by `pfdsl explain <code>`. */
	section: string;
	/** One-line English summary of the condition this code checks, for
	 * `pfdsl explain <code>` output. Not a translation of spec.md's prose;
	 * a terse restatement for terminal display. */
	summary: string;
}

/**
 * Registry of every diagnostic code emittable by
 * frontmatter.ts / parser.ts / validator.ts / multifile.ts / lexer.ts /
 * normalizer.ts.
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
	FM001: {
		severities: ["error"],
		section: "2.1",
		summary: "front matter is missing its closing `---`",
	},
	FM002: {
		severities: ["error"],
		section: "2.1",
		summary: "front matter YAML is malformed",
	},

	P001: {
		severities: ["error"],
		section: "8",
		summary: "syntax error (generic token error)",
	},
	P002: {
		severities: ["error"],
		section: "11",
		summary: "expected an identifier in an artifact set",
	},
	P003: {
		severities: ["error"],
		section: "11",
		summary: "expected an identifier after a comma in an artifact set",
	},
	P004: {
		severities: ["error"],
		section: "9",
		summary: "expected an artifact expression after `->`",
	},
	P005: {
		severities: ["error"],
		section: "9",
		summary: "expected `>>` or `>>?` after an artifact",
	},
	P006: {
		severities: ["error"],
		section: "9",
		summary: "expected a process identifier",
	},
	P007: {
		severities: ["error"],
		section: "10",
		summary: "expected an artifact expression after `->` in a chain",
	},
	P008: {
		severities: ["error"],
		section: "10",
		summary: "expected a process identifier in a chain continuation",
	},
	P010: {
		severities: ["error"],
		section: "10",
		summary: "expected an artifact expression in a chain continuation",
	},
	P011: {
		severities: ["error"],
		section: "11",
		summary: "artifact set is missing its closing `]`",
	},

	V001: {
		severities: ["error"],
		section: "15.1",
		summary: "the same artifact is produced by multiple processes",
	},
	V002: {
		severities: ["error"],
		section: "15.2",
		summary: "a process has no inputs",
	},
	V003: {
		severities: ["error"],
		section: "15.2",
		summary: "a process has no outputs",
	},
	V004: {
		severities: ["error"],
		section: "15.5",
		summary: "a `parts` member is a Process",
	},
	V005: {
		severities: ["error"],
		section: "15.5",
		summary: "`parts` references itself",
	},
	V006: {
		severities: ["error"],
		section: "15.5",
		summary: "`parts` references form a cycle",
	},
	V007: {
		severities: ["error"],
		section: "15.6",
		summary: "`status` has a value outside the allowed enum",
	},
	V008: {
		severities: ["error"],
		section: "15.6",
		summary: "`statusStyles` has a key outside the allowed enum",
	},
	V009: {
		severities: ["error"],
		section: "15.6",
		summary: "`statusStyles` / `tag.<id>.style` has a disallowed attribute key",
	},
	V010: {
		severities: ["error"],
		section: "16",
		summary: "the primary graph contains a cycle",
	},
	V011: {
		severities: ["error"],
		section: "15.3",
		summary:
			"strict mode: a feedback artifact is unreachable from its target process",
	},
	V012: {
		severities: ["error"],
		section: "15.7",
		summary: "`criteria:` is specified on a Process",
	},
	V014: {
		severities: ["error"],
		section: "15.8",
		summary: "`command:` is specified on an Artifact",
	},
	V015: {
		severities: ["error"],
		section: "15.9",
		summary: "`revises:` is specified on a Process",
	},
	V016: {
		severities: ["error"],
		section: "15.9",
		summary: "`revises:` target does not exist, or is not a string",
	},
	V017: {
		severities: ["error"],
		section: "15.9",
		summary: "`revises:` references itself",
	},
	V018: {
		severities: ["error"],
		section: "15.9",
		summary:
			"`revises:` branches (multiple artifacts revise the same artifact)",
	},
	V019: {
		severities: ["error"],
		section: "15.9",
		summary: "`revises:` references form a cycle",
	},
	V020: {
		severities: ["error"],
		section: "15.10",
		summary:
			"a process declared in front matter does not participate in any edge (orphaned declared process)",
	},
	V021: {
		severities: ["error"],
		section: "15.11",
		summary:
			"subflow path must be relative — absolute paths and URLs are rejected",
	},
	V022: {
		severities: ["error"],
		section: "15.11",
		summary:
			"subflow references form a cycle (including self-reference and multi-hop)",
	},
	V023: {
		severities: ["error"],
		section: "15.11",
		summary: "`subflow:` is specified on an Artifact",
	},
	V024: {
		severities: ["error"],
		section: "15.11",
		summary: "`boundary:` is specified on a process without `subflow:`",
	},
	V025: {
		severities: ["error"],
		section: "2.8.4",
		summary: "group `parent` chain forms a cycle",
	},
	V026: {
		severities: ["error"],
		section: "15.12",
		summary: "extends path is missing, or is absolute / a URL",
	},
	V027: {
		severities: ["error"],
		section: "15.12",
		summary:
			"extends references form a cycle (including self-reference and multi-hop)",
	},
	V028: {
		severities: ["error"],
		section: "15.12",
		summary: "preset file contains a disallowed top-level key",
	},
	V029: {
		severities: ["error"],
		section: "15.13",
		summary: "`index:` is not a positive integer",
	},
	V030: {
		severities: ["error"],
		section: "15.11",
		summary:
			"`boundary:` map key or value is not a parent/child boundary artifact",
	},
	V031: {
		severities: ["error"],
		section: "15.14",
		summary: "`type:` has a value outside the allowed enum",
	},
	V032: {
		severities: ["error"],
		section: "15.11",
		summary: "`boundary:` map is not a bijection",
	},
	V033: {
		severities: ["error"],
		section: "15.11",
		summary: "`boundary:` map crosses sides (input <-> output)",
	},
	V034: {
		severities: ["error"],
		section: "15.11",
		summary:
			"boundary set mismatch (bijection violation between parent I/O and child open input / terminal)",
	},

	W001: {
		severities: ["warning"],
		section: "15.5",
		summary: "a `parts` member does not participate in any edge",
	},
	W002: {
		severities: ["warning", "error"],
		section: "15.7",
		summary: "a produced artifact has no `criteria:` set",
	},
	W003: {
		severities: ["warning"],
		section: "15.6",
		summary:
			"status is non-monotonic (an output artifact is done while an input artifact with explicit status is below done)",
	},
	W004: {
		severities: ["warning"],
		section: "15.13",
		summary: "`index:` is duplicated within the same namespace",
	},
	W005: {
		severities: ["warning", "error"],
		section: "15.15",
		summary: "a roadmap file's produced artifact has no `status:` set",
	},
	W006: {
		severities: ["warning"],
		section: "15.14",
		summary:
			"a file with no `type:` is treated as roadmap in a ready-gate context (ready / status-set / audit-sync)",
	},

	L001: {
		severities: ["error"],
		section: "4.2",
		summary: 'a quoted identifier is missing its closing `"`',
	},
	L002: {
		severities: ["error"],
		section: "8",
		summary: "a character does not start any valid token",
	},

	N001: {
		severities: ["error"],
		section: "5.1",
		summary: "an ID is declared as both artifact and process in front matter",
	},
	N002: {
		severities: ["error"],
		section: "5.1",
		summary: "an ID is used as both artifact and process in the graph body",
	},
	N003: {
		severities: ["warning"],
		section: "15.4",
		summary: "the same edge is stated more than once",
	},
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
