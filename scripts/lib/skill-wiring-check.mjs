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
		// A `whole` mirror carries its source directory itself, so an artifact
		// that models the directory (rather than a file inside it) points at the
		// bundled thing too. `trees` / `files` mirrors bundle only their listed
		// members, so their own directory is not bundled.
		if (mirror.whole && path === mirror.src) return true;
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
 * What one manifest entry actually bundles, as repo-relative paths: each listed
 * tree or file, or the source directory itself when the entry takes it whole.
 * @param {{src: string, trees?: string[], files?: string[], whole?: boolean}} mirror
 * @returns {string[]}
 */
function mirrorMembers(mirror) {
	if (mirror.whole) return [mirror.src];
	const listed = mirror.trees ?? mirror.files ?? [];
	return listed.map((name) => `${mirror.src}/${name}`);
}

/**
 * The bundled material no artifact models. `isBundledSource` answers "is this
 * artifact's location bundled?", which only ever runs over artifacts that
 * already exist — a bundled source with no artifact is never asked about, so
 * the check returns OK for it (#930). This asks the same question from the
 * manifest's side.
 *
 * The unit is the manifest **member**, not the entry: `PLUGIN_MIRRORS` has four
 * entries but each carries several trees or files, and an entry-level answer
 * goes silent for the rest of its members as soon as one of them has an
 * artifact — a whole skill tree can then drop out of both graphs unreported.
 *
 * A member counts as modelled when some artifact's location is that member,
 * sits inside it, or contains it: one artifact may legitimately model several
 * members from their shared directory (`pfd_commands` covers three command
 * files, #780), and another may point at a single file deep inside a tree.
 * @param {{
 *   artifacts: Record<string, {location?: string | string[]}>,
 *   mirrors: Array<{dest: string, src: string, trees?: string[], files?: string[], whole?: boolean}>,
 * }} input
 * @returns {Array<{dest: string, member: string}>}
 */
export function findUnmodeledMirrors({ artifacts, mirrors }) {
	const paths = [];
	for (const meta of Object.values(artifacts)) {
		if (!meta?.location) continue;
		const locations = Array.isArray(meta.location)
			? meta.location
			: [meta.location];
		for (const loc of locations)
			paths.push(repoRelative(loc).replace(/\/$/, ""));
	}

	const findings = [];
	for (const mirror of mirrors) {
		for (const member of mirrorMembers(mirror)) {
			const covered = paths.some(
				(path) =>
					path === member ||
					path.startsWith(`${member}/`) ||
					member.startsWith(`${path}/`),
			);
			if (!covered) findings.push({ dest: mirror.dest, member });
		}
	}
	return findings;
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
 * The distributed hand-written artifacts missing from one or both of the edges
 * that model them. `location` may be a scalar path or (per spec.md §15.8) an
 * array of them — an artifact counts as bundled if any one of its locations
 * is, since a single bundled entry is enough to need the wiring this checks.
 * @param {{
 *   artifacts: Record<string, {location?: string | string[]}>,
 *   workflowEdges: Array<{kind: string, artifact: string, process: string}>,
 *   pipelineEdges: Array<{kind: string, artifact: string, process: string}>,
 *   mirrors: Array<object>,
 * }} input
 * @returns {Array<{id: string, location: string | string[], missing: string[]}>}
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
		const locations = Array.isArray(meta.location)
			? meta.location
			: [meta.location];
		if (!locations.some((loc) => isBundledSource(repoRelative(loc), mirrors)))
			continue;
		if (generated.has(id)) continue;

		const missing = [];
		if (!distillOutputs.has(id)) missing.push("distill_ops outputs");
		if (!genPluginInputs.has(id)) missing.push("gen_plugin inputs");
		if (missing.length > 0)
			findings.push({ id, location: meta.location, missing });
	}
	return findings;
}
