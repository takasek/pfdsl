import { dirname, resolve } from "node:path";
import { zeroRange } from "./position.js";
import type { Diagnostic } from "./types/diagnostic.js";
import type { Frontmatter } from "./types/frontmatter.js";
import type { NormalizedEdge } from "./types/index.js";

/**
 * Result of resolving a cross-file reference (`subflow:` / `extends:`).
 * Relative paths resolve against the containing file's directory (§2.9.2).
 * Absolute paths and URLs are rejected.
 */
export type RefResult =
	| { ok: true; path: string }
	| { ok: false; reason: "absolute" | "url" };

/**
 * Resolve a relative cross-file reference against the containing file (§2.9.2).
 * Absolute paths and URLs (`://`) are not permitted.
 */
export function resolveRefPath(fromFile: string, ref: string): RefResult {
	if (ref.includes("://")) return { ok: false, reason: "url" };
	if (ref.startsWith("/")) return { ok: false, reason: "absolute" };
	return { ok: true, path: resolve(dirname(fromFile), ref) };
}

/** A subflow reference: the declaring process id and the child path. */
export interface SubflowRef {
	process: string;
	ref: string;
}

/** Collect the `extends:` preset references from a frontmatter, in order (§2.9.4). */
export function collectExtendsRefs(fm: Frontmatter): string[] {
	const ext = fm.extends;
	if (ext === undefined) return [];
	return Array.isArray(ext) ? [...ext] : [ext];
}

/** Collect the `subflow:` references declared by processes (§2.9.3). */
export function collectSubflowRefs(fm: Frontmatter): SubflowRef[] {
	const refs: SubflowRef[] = [];
	for (const [process, meta] of Object.entries(fm.process ?? {})) {
		if (typeof meta.subflow === "string") {
			refs.push({ process, ref: meta.subflow });
		}
	}
	return refs;
}

/** A document with at least its parsed frontmatter (what the loader walks). */
export interface DocWithFrontmatter {
	frontmatter: Frontmatter | null;
}

export interface LoadedGraph<T> {
	/** Resolved absolute path → loaded document, including the entry. */
	docs: Map<string, T>;
	/** Cross-file diagnostics: missing path (V021), circular subflow (V022). */
	diagnostics: Diagnostic[];
}

/**
 * Recursively load an entry .pfdsl and its `subflow:` children (§2.9.3 / §15.11).
 * `load` reads + analyzes a file by absolute path, returning null when absent.
 * Detects self-referential and multi-hop subflow cycles (V022) and missing
 * paths (V021). Shared children reached by multiple parents load once.
 */
export function loadSubflowGraph<T extends DocWithFrontmatter>(
	entryPath: string,
	load: (path: string) => T | null,
): LoadedGraph<T> {
	const docs = new Map<string, T>();
	const diagnostics: Diagnostic[] = [];
	const stack = new Set<string>(); // current DFS path

	function visit(path: string): void {
		if (stack.has(path)) {
			diagnostics.push({
				severity: "error",
				code: "V022",
				message: `circular subflow reference: ${path}`,
				range: zeroRange(),
			});
			return;
		}
		if (docs.has(path)) return; // already fully loaded (shared child, not a cycle)
		const doc = load(path);
		if (doc === null) {
			diagnostics.push({
				severity: "error",
				code: "V021",
				message: `subflow file not found: ${path}`,
				range: zeroRange(),
			});
			return;
		}
		docs.set(path, doc);
		stack.add(path);
		for (const { ref } of collectSubflowRefs(doc.frontmatter ?? {})) {
			const resolved = resolveRefPath(path, ref);
			if (!resolved.ok) {
				diagnostics.push({
					severity: "error",
					code: "V021",
					message: `invalid subflow path (${resolved.reason}): ${ref}`,
					range: zeroRange(),
				});
				continue;
			}
			visit(resolved.path);
		}
		stack.delete(path);
	}

	visit(entryPath);
	return { docs, diagnostics };
}

/**
 * Compute the set of "open input" artifacts in a flow:
 * artifacts that have NO output edge producing them AND are consumed by at
 * least one normal `>>` input edge (§15.11). Unproduced artifacts consumed
 * only via `>>?` are cross-cutting loop elements, excluded symmetrically to
 * feedback-consumed terminals (§2.9.3).
 */
export function computeOpenInputs(edges: NormalizedEdge[]): Set<string> {
	const consumedByInput = new Set<string>();
	const produced = new Set<string>();
	for (const e of edges) {
		if (e.kind === "input") consumedByInput.add(e.artifact);
		if (e.kind === "output") produced.add(e.artifact);
	}
	return new Set([...consumedByInput].filter((a) => !produced.has(a)));
}

/**
 * Compute the set of "terminal" artifacts in a flow:
 * artifacts that appear in the flow but are consumed by NEITHER `>>` (input) NOR `>>?` (feedback) (§15.11).
 */
export function computeTerminals(edges: NormalizedEdge[]): Set<string> {
	const all = new Set<string>();
	const consumed = new Set<string>();
	for (const e of edges) {
		all.add(e.artifact);
		if (e.kind === "input" || e.kind === "feedback") consumed.add(e.artifact);
	}
	return new Set([...all].filter((a) => !consumed.has(a)));
}

/** Context for validating a single subflow boundary (§15.11). */
export interface SubflowBoundaryContext {
	processId: string;
	/** Artifact IDs from parent's `>>` (normal input, NOT feedback) edges into this process. */
	parentNormalInputs: Set<string>;
	/** Artifact IDs from parent's `->` (output) edges from this process. */
	parentOutputs: Set<string>;
	/** boundary: map from frontmatter (parent_id → child_id). Empty object if no boundary. */
	boundaryMap: Record<string, string>;
	childOpenInputs: Set<string>;
	childTerminals: Set<string>;
}

/**
 * Validate the boundary between a parent process and its subflow child (§15.11).
 * Returns V030 (dangling key/value), V032 (non-injective), V033 (side mismatch),
 * or V034 (set mismatch) diagnostics for any violations.
 */
export function validateSubflowBoundary(
	ctx: SubflowBoundaryContext,
): Diagnostic[] {
	const {
		processId,
		parentNormalInputs,
		parentOutputs,
		boundaryMap,
		childOpenInputs,
		childTerminals,
	} = ctx;
	const diagnostics: Diagnostic[] = [];

	const parentBoundary = new Set([...parentNormalInputs, ...parentOutputs]);
	const childBoundary = new Set([...childOpenInputs, ...childTerminals]);

	// C1 — map keys must be parent boundary IDs
	let hasC1orC2Error = false;
	for (const key of Object.keys(boundaryMap)) {
		if (!parentBoundary.has(key)) {
			hasC1orC2Error = true;
			diagnostics.push({
				severity: "error",
				code: "V030",
				message: `boundary key '${key}' on process '${processId}' is not a parent boundary artifact`,
				range: zeroRange(),
			});
		}
	}

	// C2 — map values must be child boundary IDs
	for (const val of Object.values(boundaryMap)) {
		if (!childBoundary.has(val)) {
			hasC1orC2Error = true;
			diagnostics.push({
				severity: "error",
				code: "V030",
				message: `boundary value '${val}' on process '${processId}' is not a child boundary artifact`,
				range: zeroRange(),
			});
		}
	}

	// Skip main bijection checks if C1/C2 failed
	if (hasC1orC2Error) return diagnostics;

	// Build effective map: parent ID -> child ID (using boundaryMap or identity)
	const effective = new Map<string, string>();
	for (const p of parentBoundary) {
		effective.set(p, boundaryMap[p] ?? p);
	}

	// C3 — effective map must be injective
	const childToParent = new Map<string, string>();
	for (const [p, c] of effective) {
		if (childToParent.has(c)) {
			diagnostics.push({
				severity: "error",
				code: "V032",
				message: `boundary map for process '${processId}' is not injective: multiple parent IDs map to child '${c}'`,
				range: zeroRange(),
			});
		} else {
			childToParent.set(c, p);
		}
	}

	// C4 — side alignment
	for (const p of parentNormalInputs) {
		const c = effective.get(p)!;
		if (childTerminals.has(c) && !childOpenInputs.has(c)) {
			diagnostics.push({
				severity: "error",
				code: "V033",
				message: `boundary maps input '${p}' to terminal '${c}' (side mismatch) on process '${processId}'`,
				range: zeroRange(),
			});
		}
	}
	for (const p of parentOutputs) {
		const c = effective.get(p)!;
		if (childOpenInputs.has(c) && !childTerminals.has(c)) {
			diagnostics.push({
				severity: "error",
				code: "V033",
				message: `boundary maps output '${p}' to open input '${c}' (side mismatch) on process '${processId}'`,
				range: zeroRange(),
			});
		}
	}

	// If C3/C4 errors, skip main bijection to avoid cascading noise
	if (diagnostics.length > 0) return diagnostics;

	// Main bijection check — input side
	const mappedInputs = new Set(
		[...parentNormalInputs].map((p) => effective.get(p)!),
	);
	if (!setsEqual(mappedInputs, childOpenInputs)) {
		diagnostics.push({
			severity: "error",
			code: "V034",
			message: `subflow boundary mismatch on process '${processId}': ${formatSetDiff("inputs", mappedInputs, childOpenInputs)}`,
			range: zeroRange(),
		});
	}

	// Main bijection check — output side
	const mappedOutputs = new Set(
		[...parentOutputs].map((p) => effective.get(p)!),
	);
	if (!setsEqual(mappedOutputs, childTerminals)) {
		diagnostics.push({
			severity: "error",
			code: "V034",
			message: `subflow boundary mismatch on process '${processId}': ${formatSetDiff("outputs", mappedOutputs, childTerminals)}`,
			range: zeroRange(),
		});
	}

	return diagnostics;
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
	if (a.size !== b.size) return false;
	for (const x of a) if (!b.has(x)) return false;
	return true;
}

/**
 * Render the diff between the parent-mapped set and the child set for a
 * V034 message: what the child has that the parent side lacks ("missing"),
 * and what the parent side has that the child lacks ("extra"). Omits a
 * clause when that side has no difference, per issue #301.
 */
function formatSetDiff(
	label: string,
	parentSide: Set<string>,
	childSide: Set<string>,
): string {
	const missing = [...childSide].filter((x) => !parentSide.has(x)).sort();
	const extra = [...parentSide].filter((x) => !childSide.has(x)).sort();
	const clauses: string[] = [];
	if (missing.length > 0) {
		clauses.push(`missing in parent ${label}: ${JSON.stringify(missing)}`);
	}
	if (extra.length > 0) {
		clauses.push(`extra in parent ${label}: ${JSON.stringify(extra)}`);
	}
	return clauses.join("; ");
}

/**
 * Recursively load an entry file and its `extends:` preset chain (§2.9.4 / §15.12).
 * `load` reads + analyzes a file by absolute path, returning null when absent.
 * Detects self-referential and multi-hop extends cycles (V027) and missing
 * paths / invalid paths (V026). Diamond-shaped presets (same file reachable via
 * multiple paths) are loaded only once — not treated as a cycle.
 */
export function loadExtendsChain<T extends DocWithFrontmatter>(
	entryPath: string,
	load: (path: string) => T | null,
): LoadedGraph<T> {
	const docs = new Map<string, T>();
	const diagnostics: Diagnostic[] = [];
	const stack = new Set<string>(); // current DFS path

	function visit(path: string): void {
		if (stack.has(path)) {
			diagnostics.push({
				severity: "error",
				code: "V027",
				message: `circular extends reference: ${path}`,
				range: zeroRange(),
			});
			return;
		}
		if (docs.has(path)) return; // diamond — already loaded, not a cycle
		const doc = load(path);
		if (doc === null) {
			diagnostics.push({
				severity: "error",
				code: "V026",
				message: `extends file not found: ${path}`,
				range: zeroRange(),
			});
			return;
		}
		docs.set(path, doc);
		stack.add(path);
		for (const ref of collectExtendsRefs(doc.frontmatter ?? {})) {
			const resolved = resolveRefPath(path, ref);
			if (!resolved.ok) {
				diagnostics.push({
					severity: "error",
					code: "V026",
					message: `invalid extends path (${resolved.reason}): ${ref}`,
					range: zeroRange(),
				});
				continue;
			}
			visit(resolved.path);
		}
		stack.delete(path);
	}

	visit(entryPath);
	return { docs, diagnostics };
}

/**
 * Build the ordered chain for `resolvePresentation` from an already-loaded
 * extends graph (§2.9.4 決定的解決アルゴリズム). `resolve(F)` merges
 * `resolve(P1) → … → resolve(Pn) → F のローカル定義`, so each preset's own
 * extends must resolve before the preset's own locals, and the entry file's
 * locals must land last — a post-order DFS over the `extends:` refs, visited
 * in list order, with the current node appended after its refs.
 */
export function buildPresentationChain<T extends DocWithFrontmatter>(
	entryPath: string,
	docs: Map<string, T>,
): { path: string; fm: Frontmatter | null }[] {
	const chain: { path: string; fm: Frontmatter | null }[] = [];
	const stack = new Set<string>(); // current DFS path — guards cycles (V027 already reported)

	function visit(path: string): void {
		if (stack.has(path)) return;
		const doc = docs.get(path);
		if (doc === undefined) return; // missing file — V026 already reported
		stack.add(path);
		for (const ref of collectExtendsRefs(doc.frontmatter ?? {})) {
			const resolved = resolveRefPath(path, ref);
			if (!resolved.ok) continue;
			visit(resolved.path);
		}
		stack.delete(path);
		chain.push({ path, fm: doc.frontmatter ?? null });
	}

	visit(entryPath);
	return chain;
}

/**
 * Prepare a preset file's source for `analyze`. Plain YAML preset files
 * (`.yaml` / `.yml`) have no `---` delimiters; wrap them so loadFrontmatter
 * picks up their content as frontmatter. Other sources pass through as-is.
 */
export function wrapPresetSource(path: string, src: string): string {
	if (
		!src.startsWith("---") &&
		(path.endsWith(".yaml") || path.endsWith(".yml"))
	) {
		return `---\n${src}\n---\n`;
	}
	return src;
}

/**
 * Resolve the `extends:` chain of `entryPath` and merge the resulting
 * statusStyles / tag / group into a copy of `frontmatter` (§2.9.4), so
 * renderers (CLI graph, VS Code preview/export) share one resolution path.
 * Chain diagnostics are intentionally dropped — rendering is lenient; strict
 * validation happens in `check`. Returns `frontmatter` as-is when the chain
 * contributes nothing.
 */
export function resolveEffectiveFrontmatter<T extends DocWithFrontmatter>(
	entryPath: string,
	frontmatter: Frontmatter | null,
	load: (path: string) => T | null,
): Frontmatter | null {
	const { docs } = loadExtendsChain(entryPath, load);
	const chain = buildPresentationChain(entryPath, docs);
	const resolved = resolvePresentation(chain);
	if (
		resolved.statusStyles === undefined &&
		resolved.tag === undefined &&
		resolved.group === undefined
	) {
		return frontmatter;
	}
	const effective: Frontmatter = { ...frontmatter };
	if (resolved.statusStyles !== undefined) {
		effective.statusStyles = resolved.statusStyles;
	}
	if (resolved.tag !== undefined) effective.tag = resolved.tag;
	if (resolved.group !== undefined) effective.group = resolved.group;
	return effective;
}

/** Allowed top-level keys in a preset file (§2.9.5). */
const PRESET_ALLOWED_KEYS = new Set([
	"extends",
	"statusStyles",
	"tag",
	"group",
]);

/**
 * Validate that a preset file only contains presentation-layer keys (§2.9.5).
 * Returns V028 diagnostics for every forbidden key found.
 */
export function validatePresetKeys(
	path: string,
	fm: Frontmatter | null,
): Diagnostic[] {
	if (fm === null) return [];
	const diagnostics: Diagnostic[] = [];
	for (const key of Object.keys(fm)) {
		if (!PRESET_ALLOWED_KEYS.has(key)) {
			diagnostics.push({
				severity: "error",
				code: "V028",
				message: `preset '${path}' contains non-presentation key '${key}'`,
				range: zeroRange(),
			});
		}
	}
	return diagnostics;
}

/** The merged presentation values resolved from an extends chain. */
export interface ResolvedPresentation {
	statusStyles: Frontmatter["statusStyles"];
	tag: Frontmatter["tag"];
	group: Frontmatter["group"];
}

/**
 * Merge statusStyles / tag / group from a sequence of frontmatters in order
 * (lowest priority first, local last). Each element's values override the
 * previous at attribute level (§2.9.4 "属性レベル深マージ").
 */
export function resolvePresentation(
	chain: { path: string; fm: Frontmatter | null }[],
): ResolvedPresentation {
	let statusStyles: Frontmatter["statusStyles"];
	let tag: Frontmatter["tag"];
	let group: Frontmatter["group"];

	for (const { fm } of chain) {
		if (fm === null) continue;

		// Merge statusStyles: Record<Status, NodeStyle> — attribute-level merge
		if (fm.statusStyles !== undefined) {
			if (statusStyles === undefined) {
				statusStyles = {};
			}
			for (const [status, nodeStyle] of Object.entries(fm.statusStyles)) {
				if (nodeStyle === undefined) continue;
				const existing =
					(statusStyles as Record<string, Record<string, string>>)[status] ??
					{};
				(statusStyles as Record<string, Record<string, string>>)[status] = {
					...existing,
					...nodeStyle,
				};
			}
		}

		// Merge tag: Record<string, TagMeta> — field-level merge, style attribute-level
		if (fm.tag !== undefined) {
			if (tag === undefined) {
				tag = {};
			}
			for (const [id, tagMeta] of Object.entries(fm.tag)) {
				if (tagMeta === undefined) continue;
				const existing = tag[id] ?? {};
				const { style: newStyle, ...otherFields } = tagMeta;
				const { style: existingStyle, ...existingOther } = existing;
				const mergedStyle =
					newStyle !== undefined || existingStyle !== undefined
						? { ...existingStyle, ...newStyle }
						: undefined;
				tag[id] = {
					...existingOther,
					...otherFields,
					...(mergedStyle !== undefined ? { style: mergedStyle } : {}),
				};
			}
		}

		// Merge group: Record<string, GroupMeta> — field-level merge
		if (fm.group !== undefined) {
			if (group === undefined) {
				group = {};
			}
			for (const [id, groupMeta] of Object.entries(fm.group)) {
				if (groupMeta === undefined) continue;
				group[id] = { ...(group[id] ?? {}), ...groupMeta };
			}
		}
	}

	return { statusStyles, tag, group };
}
