import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { tryGit, tryRun, withoutGitTargetEnvironment } from "./run-exec.mjs";

const PROBE_TIMEOUT_MS = 500;
const normalizeStart = (value) => value.trim().replace(/\s+/g, " ");

function readMetadata(path) {
	const stat = statSync(path);
	if (!stat.isFile() || stat.size > 64 * 1024) return "";
	return readFileSync(path, "utf-8");
}

/**
 * Optional native evidence for an already resolved sibling, never a target
 * resolver or an execution permission. These private formats were observed
 * in Claude 2.1.286 and Codex managed-worktree metadata v1 (ADR-0045).
 * Missing, unsupported or failed evidence preserves the existing decision.
 * No success is cached across operations.
 */
export function refineNativeWorktreeRelation(
	relation,
	{
		targetRoot,
		payload,
		environment = process.env,
		parentPid = process.ppid,
		execGit = tryGit,
		execProcess = tryRun,
		readMetadata: read = readMetadata,
	} = {},
) {
	if (relation !== "sibling") return relation;
	const env = withoutGitTargetEnvironment(environment);
	const options = {
		cwd: targetRoot,
		env,
		timeout: PROBE_TIMEOUT_MS,
		captureStderr: true,
	};
	try {
		if (
			typeof environment.CLAUDE_PROJECT_DIR === "string" &&
			environment.CLAUDE_PROJECT_DIR.trim() !== ""
		) {
			const listed = execGit(
				["worktree", "list", "--porcelain", "-z"],
				options,
			);
			if (!listed.ok) return relation;
			// -z preserves non-ASCII paths and embedded newlines. Each record is
			// terminated by an empty NUL field, not an empty text line.
			const records = listed.out.split("\0\0");
			const record = records.find(
				(value) => value.split("\0")[0] === `worktree ${targetRoot}`,
			);
			const locked = record
				?.split("\0")
				.find((value) => value.startsWith("locked "));
			const match = locked?.match(
				/^locked claude session .+ \(pid ([1-9]\d*) start ([^)]+)\)$/,
			);
			if (!match || Number(match[1]) !== parentPid) return relation;
			// Looking through arbitrary ancestors would mistake a separately
			// launched nested session for its ancestor's worktree owner.
			const started = execProcess("ps", ["-o", "lstart=", "-p", match[1]], {
				...options,
				env: { ...env, LC_ALL: "C", TZ: "UTC" },
			});
			return started.ok &&
				normalizeStart(started.out) === normalizeStart(match[2])
				? "own"
				: relation;
		}
		const sessionId = payload?.session_id;
		if (typeof sessionId !== "string" || sessionId.trim() === "")
			return relation;
		const path = execGit(
			["rev-parse", "--git-path", "codex-thread.json"],
			options,
		);
		if (!path.ok || path.out.trim() === "") return relation;
		const metadata = JSON.parse(read(resolve(targetRoot, path.out.trim())));
		return metadata?.version === 1 &&
			typeof metadata.ownerThreadId === "string" &&
			metadata.ownerThreadId.trim() !== "" &&
			metadata.ownerThreadId === sessionId
			? "own"
			: relation;
	} catch {
		return relation;
	}
}
