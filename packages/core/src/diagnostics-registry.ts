import type { DiagnosticSeverity } from "./types/index.js";

export interface DiagnosticRegistryEntry {
	/** Severities this code can be emitted with. Usually one entry; two for
	 * codes whose severity depends on `options?.strict` (FM003, V002, V003,
	 * V020, W002). */
	severities: readonly DiagnosticSeverity[];
	/** Spec section number (without the `§` prefix) that normatively defines
	 * the condition this code checks, e.g. "15.11". Must equal the section
	 * number that spec.md §16's 定義節 cell resolves to: the cell is either
	 * `§N.M` or a `[[SPEC_x]]` reference to the numbered heading that defines
	 * SPEC_x (checked by scripts/check-diag-registry.mjs). Used by
	 * `pfdsl explain <code>`. */
	section: string;
	/** Stable spec ID of that section, present when spec.md §16's 定義節 cell
	 * is a `[[SPEC_x]]` reference. Section numbers can be renumbered; this ID
	 * is what adopters should cite. Used by `pfdsl explain <code>`. */
	specId?: string;
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
		specId: "SPEC_yaml_front_matter",
		summary: "front matter is missing its closing `---`",
	},
	FM002: {
		severities: ["error"],
		section: "2.1",
		specId: "SPEC_yaml_front_matter",
		summary: "front matter YAML is malformed",
	},
	FM003: {
		severities: ["warning", "error"],
		section: "2.1",
		specId: "SPEC_yaml_front_matter",
		summary: "an inline comment may truncate an intended plain-scalar value",
	},

	FM004: {
		severities: ["error"],
		section: "2.1",
		specId: "SPEC_yaml_front_matter",
		summary: "a known front matter field has an invalid type",
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
		specId: "SPEC_single_producer_constraint",
		summary: "the same artifact is produced by multiple processes",
	},
	V002: {
		severities: ["warning", "error"],
		section: "15.2",
		specId: "SPEC_process_completeness_constraint",
		summary: "a process has no inputs",
	},
	V003: {
		severities: ["warning", "error"],
		section: "15.2",
		specId: "SPEC_process_completeness_constraint",
		summary: "a process has no outputs",
	},
	V004: {
		severities: ["error"],
		section: "15.5",
		specId: "SPEC_parts_constraint",
		summary: "a `parts` member is a Process",
	},
	V005: {
		severities: ["error"],
		section: "15.5",
		specId: "SPEC_parts_constraint",
		summary: "`parts` references itself",
	},
	V006: {
		severities: ["error"],
		section: "15.5",
		specId: "SPEC_parts_constraint",
		summary: "`parts` references form a cycle",
	},
	V007: {
		severities: ["error"],
		section: "15.6",
		specId: "SPEC_status_style_constraint",
		summary: "`status` has a value outside the allowed enum",
	},
	V008: {
		severities: ["error"],
		section: "15.6",
		specId: "SPEC_status_style_constraint",
		summary: "`statusStyles` has a key outside the allowed enum",
	},
	V009: {
		severities: ["error"],
		section: "15.6",
		specId: "SPEC_status_style_constraint",
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
		specId: "SPEC_feedback_validity_constraint",
		summary:
			"strict mode: a feedback artifact is already a true upstream ancestor of its target process (reverse cycle)",
	},
	V012: {
		severities: ["error"],
		section: "15.7",
		specId: "SPEC_criteria_constraint",
		summary: "`criteria:` is specified on a Process",
	},
	V014: {
		severities: ["error"],
		section: "15.8",
		specId: "SPEC_location_command_constraint",
		summary: "`command:` is specified on an Artifact",
	},
	V015: {
		severities: ["error"],
		section: "15.9",
		specId: "SPEC_revises_constraint",
		summary: "`revises:` is specified on a Process",
	},
	V016: {
		severities: ["error"],
		section: "15.9",
		specId: "SPEC_revises_constraint",
		summary: "`revises:` target does not exist, or is not a string",
	},
	V017: {
		severities: ["error"],
		section: "15.9",
		specId: "SPEC_revises_constraint",
		summary: "`revises:` references itself",
	},
	V018: {
		severities: ["error"],
		section: "15.9",
		specId: "SPEC_revises_constraint",
		summary:
			"`revises:` branches (multiple artifacts revise the same artifact)",
	},
	V019: {
		severities: ["error"],
		section: "15.9",
		specId: "SPEC_revises_constraint",
		summary: "`revises:` references form a cycle",
	},
	V020: {
		severities: ["warning", "error"],
		section: "15.10",
		specId: "SPEC_orphan_process_constraint",
		summary:
			"a process declared in front matter does not participate in any edge (orphaned declared process)",
	},
	V021: {
		severities: ["error"],
		section: "15.11",
		specId: "SPEC_subflow_boundary_constraint",
		summary: "subflow file is missing, or its path is absolute / a URL",
	},
	V022: {
		severities: ["error"],
		section: "15.11",
		specId: "SPEC_subflow_boundary_constraint",
		summary:
			"subflow references form a cycle (including self-reference and multi-hop)",
	},
	V023: {
		severities: ["error"],
		section: "15.11",
		specId: "SPEC_subflow_boundary_constraint",
		summary: "`subflow:` is specified on an Artifact",
	},
	V024: {
		severities: ["error"],
		section: "15.11",
		specId: "SPEC_subflow_boundary_constraint",
		summary: "`boundary:` is specified on a process without `subflow:`",
	},
	V025: {
		severities: ["error"],
		section: "2.8.4",
		specId: "SPEC_group_constraints",
		summary: "group `parent` chain forms a cycle",
	},
	V026: {
		severities: ["error"],
		section: "15.12",
		specId: "SPEC_extends_constraint",
		summary: "extends path is missing, or is absolute / a URL",
	},
	V027: {
		severities: ["error"],
		section: "15.12",
		specId: "SPEC_extends_constraint",
		summary:
			"extends references form a cycle (including self-reference and multi-hop)",
	},
	V028: {
		severities: ["error"],
		section: "15.12",
		specId: "SPEC_extends_constraint",
		summary: "preset file contains a disallowed top-level key",
	},
	V029: {
		severities: ["error"],
		section: "15.13",
		specId: "SPEC_index_constraint",
		summary: "`index:` is not a positive integer",
	},
	V030: {
		severities: ["error"],
		section: "15.11",
		specId: "SPEC_subflow_boundary_constraint",
		summary:
			"`boundary:` map key or value is not a parent/child boundary artifact",
	},
	V031: {
		severities: ["error"],
		section: "15.14",
		specId: "SPEC_type_constraint",
		summary: "`type:` has a value outside the allowed enum",
	},
	V032: {
		severities: ["error"],
		section: "15.11",
		specId: "SPEC_subflow_boundary_constraint",
		summary: "`boundary:` map is not a bijection",
	},
	V033: {
		severities: ["error"],
		section: "15.11",
		specId: "SPEC_subflow_boundary_constraint",
		summary: "`boundary:` map crosses sides (input <-> output)",
	},
	V034: {
		severities: ["error"],
		section: "15.11",
		specId: "SPEC_subflow_boundary_constraint",
		summary:
			"boundary set mismatch (bijection violation between parent I/O and child open input / terminal)",
	},
	V035: {
		severities: ["error"],
		section: "15.16",
		specId: "SPEC_roadmap_artifact_declaration_and_status",
		summary:
			"a roadmap file has an edge artifact with no frontmatter declaration (ghost node), or a declaration with no `status:`",
	},
	V036: {
		severities: ["error"],
		section: "15.4",
		specId: "SPEC_duplicate_edge_constraint",
		summary:
			"an artifact-process pair is connected as both a normal input (`>>`) and feedback (`>>?`)",
	},
	V037: {
		severities: ["error"],
		section: "15.18",
		specId: "SPEC_reference_resolution_constraint",
		summary: "`baseRef` or `ref` contains blank values or additional members",
	},
	V038: {
		severities: ["error"],
		section: "15.18",
		specId: "SPEC_reference_resolution_constraint",
		summary: "`ref` is specified on a process",
	},
	V039: {
		severities: ["error"],
		section: "15.18",
		specId: "SPEC_reference_resolution_constraint",
		summary:
			"an explicit reference target uses an absolute or out-of-collection path",
	},

	W001: {
		severities: ["warning"],
		section: "15.5",
		specId: "SPEC_parts_constraint",
		summary: "a `parts` member does not participate in any edge",
	},
	W002: {
		severities: ["warning", "error"],
		section: "15.7",
		specId: "SPEC_criteria_constraint",
		summary: "a produced artifact has no `criteria:` set",
	},
	W003: {
		severities: ["warning"],
		section: "15.6",
		specId: "SPEC_status_style_constraint",
		summary:
			"status is non-monotonic (an output artifact is done while an input artifact with explicit status is below done)",
	},
	W004: {
		severities: ["warning"],
		section: "15.13",
		specId: "SPEC_index_constraint",
		summary: "`index:` is duplicated within the same namespace",
	},
	W006: {
		severities: ["warning"],
		section: "15.14",
		specId: "SPEC_type_constraint",
		summary:
			"a file with no `type:` is treated as roadmap in a ready-gate context (ready / status-set / audit-sync)",
	},
	W007: {
		severities: ["warning", "error"],
		section: "15.15",
		specId: "SPEC_non_roadmap_status_constraint",
		summary: "a non-roadmap file's artifact has `status:` set",
	},
	W008: {
		severities: ["warning", "error"],
		section: "15.2",
		specId: "SPEC_process_completeness_constraint",
		summary:
			"a process has no normal input; feedback edges are its only inputs",
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
		specId: "SPEC_duplicate_edge_constraint",
		summary: "the same edge is stated more than once",
	},
	N004: {
		severities: ["error"],
		section: "15.17",
		specId: "SPEC_group_node_id_collision",
		summary: "a group ID is also declared or used as an artifact or process ID",
	},
};

const CODE_RE = /code:\s*"([A-Z]+\d+)"/g;
// Both spellings of "warning by default, error under --strict": the inline
// ternary, and the ctx.strictly() helper the rule modules call.
const STRICT_TERNARY_RE = /options\?\.strict\s*\?\s*"error"\s*:\s*"warning"/;
const STRICTLY_CALL_RE = /strictly\(\s*"(error|warning|info)"\s*\)/;
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
		if (STRICT_TERNARY_RE.test(window) || STRICTLY_CALL_RE.test(window)) {
			const strictlyMatch = window.match(STRICTLY_CALL_RE);
			severities = [strictlyMatch?.[1] ?? "warning", "error"];
		} else {
			const sevMatch = window.match(PLAIN_SEVERITY_RE);
			severities = sevMatch?.[1] !== undefined ? [sevMatch[1]] : [];
		}

		result[code] = severities;
	}

	return result;
}
