import { isScalar } from "yaml";
import {
	declarationPair,
	parseFrontmatterCst,
	renderFrontmatterCst,
} from "./frontmatter-cst.js";
import type { AnalyzeResult } from "./index.js";

/**
 * Rewrite group id `oldId` to `newId` in `source`: its declaration key (kept
 * in place among its siblings), every other group's `parent:` reference, and
 * every artifact's/process's `group:` field. Only the frontmatter changes —
 * the body never references groups (spec §2.8). Applied through the yaml
 * CST (ADR-0034), so comments, quoting, flow-vs-block style and folded (`>`)
 * scalars elsewhere survive. Returns the whole document, the rewritten
 * members (artifacts before processes, each in declaration order) and the
 * rewritten child groups (in declaration order).
 */
export function renameGroup(
	source: string,
	analysis: Pick<AnalyzeResult, "frontmatter">,
	oldId: string,
	newId: string,
): { output: string; members: string[]; children: string[] } {
	const { frontmatter } = analysis;
	const cst = parseFrontmatterCst(source);
	const doc = cst.doc;
	const pair = declarationPair(doc, oldId, "group");
	if (pair && isScalar(pair.key)) pair.key.value = newId;

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
		members,
		children,
	};
}
