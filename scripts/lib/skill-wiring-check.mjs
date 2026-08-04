// Checks that every distributed hand-written skill/agent is wired into both
// PFD edges that model it (#699).
//
// `.pfdsl/workflow.md` said outright that these edges are "check で強制されず
// 目視追随に依存する": distill_ops's outputs in workflow.pfdsl and gen_plugin's
// inputs in runtime-pipeline.pfdsl. #481 added grill_skill and missed three
// references; a retro audit found it afterwards.
//
// Everything this decides comes from data someone else already owns, so no
// list of skill names is maintained here — such a list would need the same
// hand-updating this check exists to remove:
//   - artifact metadata and edges come from @pfdsl/core's analyze() (the
//     caller passes the parsed result), not from regexes over .pfdsl text
//   - what the bundle carries comes from gen-plugin's own PLUGIN_MIRRORS,
//     the manifest the assembly and distribution-review both already read.
//     It excludes the pfdsl skill by construction ("rendered, not mirrored"),
//     so the generated skill needs no special case here
//   - "hand-written" means the runtime pipeline does not produce it

/**
 * A companion-relative location (`../.claude/x`) as a repo-relative path.
 * @param {string} location
 * @returns {string}
 */
export function repoRelative(location) {
	return location.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
}

/**
 * Whether gen-plugin mirrors this source path into the bundle, per its own
 * manifest: the mirror whose `src` the path sits under must also list the
 * member (a directory for `trees`, a file for `files`; `whole` takes all).
 * @param {string} sourcePath repo-relative
 * @param {Array<{src: string, trees?: string[], files?: string[], whole?: boolean}>} mirrors
 * @returns {boolean}
 */
export function isBundledSource(sourcePath, mirrors) {
	const path = sourcePath.replace(/\/$/, "");
	for (const mirror of mirrors) {
		const prefix = `${mirror.src}/`;
		if (!path.startsWith(prefix)) continue;
		if (mirror.whole) return true;
		const rest = path.slice(prefix.length);
		if (mirror.trees) return mirror.trees.includes(rest.split("/")[0]);
		return (mirror.files ?? []).includes(rest);
	}
	return false;
}

/**
 * The artifacts on one side of a process's edges. `process` is optional —
 * omitting it answers "produced anywhere in this graph".
 * @param {Array<{kind: string, artifact: string, process: string}>} edges analyze().edges
 * @param {{kind: "input" | "output" | "feedback", process?: string}} filter
 * @returns {Set<string>}
 */
export function edgeMembers(edges, { kind, process }) {
	return new Set(
		edges
			.filter(
				(edge) =>
					edge.kind === kind &&
					(process === undefined || edge.process === process),
			)
			.map((edge) => edge.artifact),
	);
}

/**
 * The line an artifact is declared on, for the report's file:line anchor.
 * Cosmetic only — nothing this check decides depends on it, since the
 * frontmatter analyze() returns carries no positions.
 * @param {string} text .pfdsl source
 * @param {string} id
 * @returns {number | null}
 */
export function declarationLine(text, id) {
	const lines = text.split("\n");
	const index = lines.findIndex((line) => line.trimEnd() === `  ${id}:`);
	return index === -1 ? null : index + 1;
}

/**
 * The distributed hand-written artifacts missing from one or both of the edges
 * that model them.
 * @param {{
 *   artifacts: Record<string, {location?: string}>,
 *   workflowEdges: Array<{kind: string, artifact: string, process: string}>,
 *   pipelineEdges: Array<{kind: string, artifact: string, process: string}>,
 *   mirrors: Array<object>,
 * }} input
 * @returns {Array<{id: string, location: string, missing: string[]}>}
 */
export function findUnwiredSkills({
	artifacts,
	workflowEdges,
	pipelineEdges,
	mirrors,
}) {
	const distillOutputs = edgeMembers(workflowEdges, {
		kind: "output",
		process: "distill_ops",
	});
	const genPluginInputs = edgeMembers(pipelineEdges, {
		kind: "input",
		process: "gen_plugin",
	});
	const generated = edgeMembers(pipelineEdges, { kind: "output" });

	const findings = [];
	for (const [id, meta] of Object.entries(artifacts)) {
		if (!meta?.location) continue;
		if (!isBundledSource(repoRelative(meta.location), mirrors)) continue;
		if (generated.has(id)) continue;

		const missing = [];
		if (!distillOutputs.has(id)) missing.push("distill_ops outputs");
		if (!genPluginInputs.has(id)) missing.push("gen_plugin inputs");
		if (missing.length > 0)
			findings.push({ id, location: meta.location, missing });
	}
	return findings;
}
