/**
 * Pure logic for sweeping completed chains out of a roadmap (issue #1125's
 * "回収対象の判定" design record). Given the two JSON payloads the pfdsl CLI
 * already exposes — `graph edges --json` and `status list --json` — derives
 * which process/artifact ids are safe to delete. No I/O: CLI invocation,
 * verification and file writes live in sweep-completed-chains.mjs.
 *
 * Retention rule:
 *   - keep process: any process with an "output" edge to an artifact whose
 *     status is not "done" (it still has undone work to produce).
 *   - keep artifact: every artifact that appears on any edge — input, output
 *     or feedback — of a keep process.
 *   - delete target: every `done` artifact `status list` returns, plus every
 *     process id that appears anywhere in `graph edges`, minus keep process
 *     and keep artifact.
 *
 * A process with zero edges never appears in `graph edges` at all, so it
 * never enters the "all processes" side of that union and is therefore never
 * selected for deletion. This is an intentional gap, not an oversight: such a
 * process is already flagged by the existing V020 validation rule, and this
 * module leaves that case to V020 rather than duplicating the check.
 *
 * An artifact with zero edges has the same "invisible to keepArtifacts" gap,
 * but there the gap is not safe to leave open: sweeping exists to reclaim
 * completed chains, and an artifact never touched by an edge is an unstarted
 * plan, not a completed one. Restricting the artifact side of the delete
 * target to `status === "done"` closes that gap explicitly rather than
 * relying on it never coming up (#1125 defect 1).
 */

/**
 * @param {Array<{kind: string, process: string, artifact: string}>} edges
 * @param {Array<{id: string, status: string}>} artifacts
 * @returns {Set<string>} process ids to keep
 */
export function computeKeepProcesses(edges, artifacts) {
	const doneArtifacts = new Set(
		artifacts.filter((a) => a.status === "done").map((a) => a.id),
	);
	const keep = new Set();
	for (const edge of edges) {
		if (edge.kind !== "output") continue;
		if (!doneArtifacts.has(edge.artifact)) keep.add(edge.process);
	}
	return keep;
}

/**
 * @param {Array<{kind: string, process: string, artifact: string}>} edges
 * @param {Set<string>} keepProcesses
 * @returns {Set<string>} artifact ids to keep
 */
export function computeKeepArtifacts(edges, keepProcesses) {
	const keep = new Set();
	for (const edge of edges) {
		if (keepProcesses.has(edge.process)) keep.add(edge.artifact);
	}
	return keep;
}

/** @param {Array<{process: string}>} edges */
function allProcessIds(edges) {
	const ids = new Set();
	for (const edge of edges) ids.add(edge.process);
	return ids;
}

/**
 * @param {{
 *   edges: Array<{kind: string, process: string, artifact: string}>,
 *   artifacts: Array<{id: string, status: string}>,
 * }} input
 * @returns {string[]} ids to delete, sorted for a deterministic result
 */
export function computeDeleteTargets({ edges, artifacts }) {
	const keepProcesses = computeKeepProcesses(edges, artifacts);
	const keepArtifacts = computeKeepArtifacts(edges, keepProcesses);
	const processes = allProcessIds(edges);

	const deleteIds = [];
	for (const artifact of artifacts) {
		// status !== "done" guards against sweeping unstarted or in-progress
		// work that simply has no edges yet (see the module doc above).
		if (artifact.status === "done" && !keepArtifacts.has(artifact.id)) {
			deleteIds.push(artifact.id);
		}
	}
	for (const process of processes) {
		if (!keepProcesses.has(process)) deleteIds.push(process);
	}
	deleteIds.sort();
	return deleteIds;
}
