import { tryRun } from "./run-exec.mjs";

/** Diagnostic observations only: never used to authorize an ancestor's worktree. */
export function observeHookProcessChain({
	parentPid = process.ppid,
	environment = process.env,
	probeProcess = tryRun,
} = {}) {
	const rows = [];
	let pid = parentPid;
	for (
		let depth = 0;
		depth < 3 && Number.isSafeInteger(pid) && pid > 0;
		depth++
	) {
		if (rows.some((row) => row.pid === pid)) break;
		try {
			const result = probeProcess(
				"ps",
				["-o", "pid=,ppid=,lstart=,comm=", "-p", String(pid)],
				{
					env: { ...environment, LC_ALL: "C", TZ: "UTC" },
					captureStderr: true,
					timeout: 200,
				},
			);
			const match =
				result.ok &&
				result.out.trim().match(/^(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
			if (
				!match ||
				Number(match[1]) !== pid ||
				!Number.isSafeInteger(Number(match[2]))
			)
				throw new Error("unavailable");
			rows.push({
				pid,
				ppid: Number(match[2]),
				start: match[3].trim().replace(/\s+/g, " "),
				command: match[4].slice(0, 256),
			});
			pid = Number(match[2]);
		} catch {
			rows.push({ pid, status: "unavailable" });
			break;
		}
	}
	return rows;
}
