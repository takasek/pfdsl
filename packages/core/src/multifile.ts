import { dirname, resolve } from "node:path";
import { zeroRange } from "./position.js";
import type { Diagnostic } from "./types/diagnostic.js";
import type { Frontmatter } from "./types/frontmatter.js";

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
