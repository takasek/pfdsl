import { type AnalyzeResult, analyze, isUnreadableError } from "./index.js";
import { renameGroup } from "./rename-group.js";
import { renameId } from "./rename-id.js";
import type { Diagnostic, NodeKind } from "./types/index.js";

/** Why `rename` refused, with what a caller needs to phrase the refusal. */
export type RenameRefusal =
	/** `source` could not be read; `diagnostics` are its FM / L / P errors. */
	| { ok: false; reason: "unreadable"; diagnostics: Diagnostic[] }
	/** `oldId` is not one of this file's own artifact, process or group ids. */
	| { ok: false; reason: "notFound" }
	/** `oldId` is a local group id and also an artifact/process id (`clashingKind`). */
	| { ok: false; reason: "ambiguous"; clashingKind: "artifact" | "process" }
	/** `newId` is already this file's `existingKind` id; `kind` is `oldId`'s. */
	| {
			ok: false;
			reason: "newExists";
			kind: NodeKind;
			existingKind: NodeKind;
	  };

export type RenameResult =
	| { ok: true; output: string; kind: "artifact" | "process" }
	| {
			ok: true;
			output: string;
			kind: "group";
			/** Artifacts/processes whose `group:` was rewritten, artifacts first, each in declaration order. */
			members: string[];
			/** Groups whose `parent:` was rewritten, in declaration order. */
			children: string[];
	  }
	| RenameRefusal;

export interface RenameOptions {
	/** `analyze(source)`, when the caller already has it. */
	analysis?: AnalyzeResult;
}

/** Own-property lookup, so a prototype member name like `toString` reads as undeclared. */
function declares(section: object | undefined, id: string): boolean {
	return section !== undefined && Object.hasOwn(section, id);
}

/**
 * `id`'s kind in this file, or the kind it clashes with when it is a local
 * group id that is also an artifact/process id — declared in frontmatter,
 * used in a body edge, or an isolated body node (an artifact unless
 * declared otherwise, §5.1.3). `nodeKinds` holds one kind per id, so the
 * clash is read from the sections and the body instead.
 */
function resolveKind(
	analysis: AnalyzeResult,
	id: string,
): NodeKind | { clashingKind: "artifact" | "process" } | undefined {
	const { frontmatter, edges, isolatedNodes, nodeKinds } = analysis;
	if (declares(frontmatter?.group, id)) {
		if (
			declares(frontmatter?.artifact, id) ||
			edges.some((e) => e.artifact === id)
		) {
			return { clashingKind: "artifact" };
		}
		if (
			declares(frontmatter?.process, id) ||
			edges.some((e) => e.process === id)
		) {
			return { clashingKind: "process" };
		}
		if (isolatedNodes.has(id)) return { clashingKind: "artifact" };
		return "group";
	}
	const kind = nodeKinds.get(id);
	return kind === "artifact" || kind === "process" ? kind : undefined;
}

/**
 * Rename one of `source`'s own ids — artifact, process, or group — and every
 * reference to it in this file, in one rewrite (see `renameId` and
 * `renameGroup` for what each kind rewrites).
 *
 * Refuses, without rewriting, a source that could not be read, an `oldId`
 * that is not this file's own id, an `oldId` that is both a local group id
 * and an artifact/process id, and a `newId` that is already any of this
 * file's ids. A validation (V) or normalizer (N) error does not refuse: the
 * rename is performed and the caller judges the result. Ids that come from
 * other files (an `extends:` preset, a subflow child) are the caller's to
 * check.
 */
export function rename(
	source: string,
	oldId: string,
	newId: string,
	opts: RenameOptions = {},
): RenameResult {
	const analysis = opts.analysis ?? analyze(source);
	const unreadable = analysis.diagnostics.filter(isUnreadableError);
	if (unreadable.length > 0) {
		return { ok: false, reason: "unreadable", diagnostics: unreadable };
	}

	const kind = resolveKind(analysis, oldId);
	if (kind === undefined) return { ok: false, reason: "notFound" };
	if (typeof kind === "object") {
		return { ok: false, reason: "ambiguous", clashingKind: kind.clashingKind };
	}

	// `nodeKinds` holds every artifact, process and group id of this file.
	const existingKind = analysis.nodeKinds.get(newId);
	if (existingKind !== undefined) {
		return { ok: false, reason: "newExists", kind, existingKind };
	}

	if (kind === "group") {
		return { ok: true, kind, ...renameGroup(source, analysis, oldId, newId) };
	}
	return {
		ok: true,
		kind,
		output: renameId(source, analysis, oldId, newId, kind),
	};
}
