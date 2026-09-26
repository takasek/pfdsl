import { isMap, isScalar } from "yaml";
import {
	parseFrontmatterCst,
	renderFrontmatterCst,
} from "./frontmatter-cst.js";
import { analyze } from "./index.js";
import type { Diagnostic } from "./types/index.js";

export interface RenameGroupResult {
	/**
	 * The whole document (frontmatter + body) with `oldId`'s declaration key,
	 * every other group's `parent:` reference to it, and every artifact's/
	 * process's `group:` reference to it renamed to `newId`. Only the
	 * frontmatter changes — the body never references groups (spec §2.8).
	 * Unchanged (the original `source`) when `oldId` has no declaration in
	 * the local `group:` section, or when `source` already carries a parse
	 * error — there is nothing safe to rewrite.
	 */
	output: string;
	/** True when `oldId` had a local `group:` declaration to rename. */
	found: boolean;
	/**
	 * Artifact/process ids whose `group:` field was rewritten, in frontmatter
	 * declaration order (every renamed artifact before every renamed process).
	 */
	members: string[];
	/** Other group ids whose `parent:` field was rewritten, in frontmatter declaration order. */
	children: string[];
	diagnostics: Diagnostic[];
}

/**
 * Rename a group id in one atomic in-place rewrite (issue #1218): the
 * declaration key (`group.<oldId>` -> `<newId>`), every other group's
 * `parent: <oldId>` reference, and every artifact's/process's
 * `group: <oldId>` field. Built on the yaml CST (ADR-0034, the same
 * `parseFrontmatterCst` / `renderFrontmatterCst` pair `setFrontmatterField`
 * and `deleteNodes` use) so comments, quoting, flow-vs-block style, and
 * folded (`>`) scalars elsewhere in the frontmatter survive untouched. The
 * declaration key's Pair is mutated in place (its key scalar's `.value`) —
 * not deleted and re-added — so its position in the `group:` map is kept.
 *
 * Refusal/validation (does `oldId` exist, is `newId` free, extends-chain
 * conflicts) is the CLI layer's job (`meta rename-group`), not this
 * function's: it always performs the rename it is asked for when `oldId` is
 * locally declared, and reports a no-op (`found: false`) otherwise.
 */
export function renameGroup(
	source: string,
	oldId: string,
	newId: string,
): RenameGroupResult {
	const { frontmatter, diagnostics } = analyze(source);
	const noop: RenameGroupResult = {
		output: source,
		found: false,
		members: [],
		children: [],
		diagnostics,
	};
	if (diagnostics.some((d) => d.severity === "error")) return noop;

	const cst = parseFrontmatterCst(source);
	if (!cst.present) return noop;

	const doc = cst.doc;
	const groupMap = doc.getIn(["group"], true);
	if (!isMap(groupMap)) return noop;
	const pair = groupMap.items.find(
		(p) => isScalar(p.key) && p.key.value === oldId,
	);
	if (!pair || !isScalar(pair.key)) return noop;
	pair.key.value = newId;

	const children: string[] = [];
	for (const [gid, meta] of Object.entries(frontmatter?.group ?? {})) {
		if (gid === oldId) continue;
		if (meta?.parent === oldId) {
			doc.setIn(["group", gid, "parent"], newId);
			children.push(gid);
		}
	}

	const members: string[] = [];
	for (const [aid, meta] of Object.entries(frontmatter?.artifact ?? {})) {
		if (meta?.group === oldId) {
			doc.setIn(["artifact", aid, "group"], newId);
			members.push(aid);
		}
	}
	for (const [pid, meta] of Object.entries(frontmatter?.process ?? {})) {
		if (meta?.group === oldId) {
			doc.setIn(["process", pid, "group"], newId);
			members.push(pid);
		}
	}

	const frontmatterOutput = renderFrontmatterCst(
		doc,
		cst.newline,
		cst.yamlText,
	);
	return {
		output: frontmatterOutput + cst.body,
		found: true,
		members,
		children,
		diagnostics,
	};
}
