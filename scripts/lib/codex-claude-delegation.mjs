import { basename } from "node:path";
import { tryRun, withoutGitTargetEnvironment } from "./run-exec.mjs";

export function isClaudeDelegatedCodex(environment) {
	return (
		!environment.CLAUDE_PROJECT_DIR?.trim() && environment.CLAUDECODE === "1"
	);
}

/**
 * Observed native shape: hook -> Codex CLI -> shell -> Claude CLI.
 * CLAUDECODE only restricts authority; the live chain and native lock must
 * separately agree before any ordinary file becomes own. No ancestor search
 * or successful observation is cached. Missing evidence never means parent.
 */
export function observeCodexClaudeDelegation({
	environment = process.env,
	parentPid = process.ppid,
	probeProcess = tryRun,
} = {}) {
	if (!isClaudeDelegatedCodex(environment)) return null;
	const options = {
		env: {
			...withoutGitTargetEnvironment(environment),
			LC_ALL: "C",
			TZ: "UTC",
		},
		captureStderr: true,
		timeout: 500,
	};
	let pid = parentPid;
	for (const names of [["codex"], ["zsh", "bash", "sh"], ["claude"]]) {
		if (!Number.isSafeInteger(pid) || pid <= 1) return { owner: null };
		const result = probeProcess(
			"ps",
			["-o", "pid=,ppid=,lstart=,comm=", "-p", String(pid)],
			options,
		);
		const row =
			result.ok && result.out.trim().match(/^(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
		if (!row || Number(row[1]) !== pid || !names.includes(basename(row[4])))
			return { owner: null };
		if (names[0] === "claude")
			return { owner: { pid, start: row[3].trim().replace(/\s+/g, " ") } };
		pid = Number(row[2]);
	}
	return { owner: null };
}
