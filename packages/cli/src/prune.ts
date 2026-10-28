import { type analyze, compareIds } from "@pfdsl/core";

/** Keep unfinished producers and every artifact on any of their edges. */
export function pruneTargets({
	edges,
	frontmatter,
}: ReturnType<typeof analyze>): string[] {
	const done = new Set(
		Object.entries(frontmatter?.artifact ?? {})
			.filter(([, meta]) => meta.status === "done")
			.map(([id]) => id),
	);
	const keepProcesses = new Set(
		edges
			.filter((edge) => edge.kind === "output" && !done.has(edge.artifact))
			.map((edge) => edge.process),
	);
	const keepArtifacts = new Set(
		edges
			.filter((edge) => keepProcesses.has(edge.process))
			.map((edge) => edge.artifact),
	);
	return [
		...new Set([
			...[...done].filter((id) => !keepArtifacts.has(id)),
			...edges
				.map((edge) => edge.process)
				.filter((id) => !keepProcesses.has(id)),
		]),
	].sort();
}

const byId = (a: { id: string }, b: { id: string }) => compareIds(a.id, b.id);

/** Ignore presentation order and the removed completed-process count. */
export function comparableReady(stdout: string): string {
	const payload = JSON.parse(stdout);
	if (payload.empty) delete payload.empty.complete;
	for (const item of payload.ready ?? []) {
		item.inputs.sort(compareIds);
		item.outputs.sort(compareIds);
	}
	payload.ready?.sort(byId);
	return JSON.stringify(payload);
}

/** Preserve every blocker and field, independent of presentation order. */
export function comparableBlocked(stdout: string): string {
	const payload = JSON.parse(stdout);
	for (const item of payload.blocked ?? []) item.blockedBy.sort(compareIds);
	payload.blocked?.sort(byId);
	return JSON.stringify(payload);
}
