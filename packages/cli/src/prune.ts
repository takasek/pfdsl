import type { analyze } from "@pfdsl/core";

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

/** Only the completed-process count may change when pruning. */
export function comparableReady(stdout: string): string {
	const payload = JSON.parse(stdout);
	if (payload.empty) delete payload.empty.complete;
	return JSON.stringify(payload);
}
