// IO boundary for the single hook entry. Neither the table nor classifier
// observes Git, fs, process identity or native ownership by itself.
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { classifyAgentOperations } from "./agent-operation-classifier.mjs";
import { createGuardProbe } from "./guard-probe.mjs";
import {
	readNativeWorktreeMetadata,
	refineNativeWorktreeRelation,
} from "./native-worktree-owner.mjs";
import { resolvePhysicalPath } from "./physical-path.mjs";
import {
	hasGitTargetEnvironment,
	resolveGitRoots,
	tryRun,
	withoutGitTargetEnvironment,
} from "./run-exec.mjs";

const MCP_READ = new Set([
	"get_issue",
	"get_pull_request",
	"get_pull_request_files",
	"get_pull_request_comments",
	"get_file_contents",
	"list_issues",
	"list_pull_requests",
	"list_commits",
	"list_branches",
	"search_issues",
	"search_prs",
	"search_pull_requests",
	"search_code",
	"search_repositories",
	"get_repository",
	"get_me",
	"issue_read",
	"pull_request_read",
	"get_pr_info",
	"get_pr_diff",
	"get_repo",
	"fetch",
	"fetch_issue",
	"fetch_pr",
	"fetch_file",
]);
const MCP_WRITE = new Set([
	"create_pull_request",
	"update_pull_request",
	"create_issue",
	"update_issue",
	"add_issue_comment",
	"push_files",
	"create_or_update_file",
	"delete_file",
	"create_branch",
	"create_pull_request_review",
	"add_pull_request_review_comment",
	"submit_pull_request_review",
]);
const MCP_MERGE = new Set([
	"merge_pull_request",
	"enable_auto_merge",
	"enable_pull_request_auto_merge",
]);
const normalizeStart = (value) => value.trim().replace(/\s+/g, " ");

function existingDirectory(path) {
	for (let current = path; ; current = dirname(current)) {
		try {
			if (lstatSync(current).isDirectory()) return current;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		if (dirname(current) === current)
			throw new Error("No existing target directory");
	}
}

function worktreeRecords(text) {
	return text
		.split("\0\0")
		.filter(Boolean)
		.map((record) => {
			const fields = Object.fromEntries(
				record
					.split("\0")
					.filter(Boolean)
					.map((field) => {
						const separator = field.indexOf(" ");
						return separator < 0
							? [field, true]
							: [field.slice(0, separator), field.slice(separator + 1)];
					}),
			);
			if (typeof fields.worktree !== "string" || !isAbsolute(fields.worktree))
				throw new Error("Invalid Git worktree response");
			return fields;
		});
}

export function collectAgentOperationEnvironment(
	payload,
	{
		hookRoot,
		shell,
		environment = process.env,
		parentPid = process.ppid,
		probeGit = createGuardProbe(),
		probeProcess = tryRun,
		readMetadata = readNativeWorktreeMetadata,
	} = {},
) {
	const harness = environment.CLAUDE_PROJECT_DIR?.trim() ? "claude" : "codex";
	const origin =
		harness === "claude" ? environment.CLAUDE_PROJECT_DIR : payload.cwd;
	const sessionRoot =
		typeof origin === "string" && isAbsolute(origin)
			? resolvePhysicalPath(origin, null)
			: null;
	const sessionId =
		payload.session_id || (harness === "claude" ? `claude:${parentPid}` : null);
	const facts = {
		harness,
		health: "healthy",
		hookRoot,
		sessionRoot,
		sessionId,
		commonDir: null,
		defaultBranch: null,
		worktrees: [],
		branches: {},
		physicalPaths: {},
		physicalEntryPaths: {},
		gitMetadataPaths: [],
		gitTargetOverride: hasGitTargetEnvironment(environment),
		cdPathOverride:
			typeof environment.CDPATH === "string" && environment.CDPATH !== "",
		shell,
		mcpTools: {},
	};
	const tool = payload.tool_name
		?.match(/^mcp__.*github(?:__|_)(.+)$/i)?.[1]
		?.toLowerCase();
	if (tool)
		facts.mcpTools[payload.tool_name] = MCP_MERGE.has(tool)
			? "P"
			: MCP_READ.has(tool)
				? "R"
				: MCP_WRITE.has(tool)
					? "O"
					: "U";
	const paths = new Map(
		classifyAgentOperations(payload, facts)
			.operations.filter(({ executionInput }) => executionInput)
			.map(({ executionInput: path, followFinalSymlink = true }) => [
				`${followFinalSymlink ? "follow" : "entry"}:${path}`,
				{ path, followFinalSymlink },
			]),
	);
	if (!paths.size) return facts;
	if (!sessionRoot)
		throw new Error("Cannot establish the observed session origin");
	const env = withoutGitTargetEnvironment(environment);
	const roots = resolveGitRoots(existingDirectory(sessionRoot), {
		exec: probeGit,
		environment: env,
	});
	if (!roots) throw new Error("Cannot establish the session Git roots");
	facts.commonDir = roots.commonDir;
	facts.gitMetadataPaths.push(roots.commonDir);
	const head = probeGit(
		["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
		{ cwd: roots.worktreeRoot, env },
	);
	if (!head.ok || !/^origin\/.+/.test(head.out.trim()))
		throw new Error(
			"Cannot establish the default branch; restore origin/HEAD in a human terminal",
		);
	facts.defaultBranch = head.out.trim().slice("origin/".length);
	const listed = probeGit(["worktree", "list", "--porcelain", "-z"], {
		cwd: roots.worktreeRoot,
		env,
	});
	if (!listed.ok) throw new Error("Cannot observe the repository worktrees");
	const records = worktreeRecords(listed.out);
	if (!records.length) throw new Error("Empty Git worktree response");
	for (const [index, record] of records.entries()) {
		const root = resolvePhysicalPath(record.worktree, null);
		const branch =
			typeof record.branch === "string"
				? record.branch.replace(/^refs\/heads\//, "")
				: null;
		const tree = {
			root,
			commonDir: roots.commonDir,
			primary: index === 0,
			branch,
		};
		const lock =
			typeof record.locked === "string"
				? record.locked.match(
						/^claude session .+ \(pid ([1-9]\d*) start ([^)]+)\)$/,
					)
				: null;
		if (lock) {
			const started = probeProcess("ps", ["-o", "lstart=", "-p", lock[1]], {
				cwd: root,
				env: { ...env, LC_ALL: "C", TZ: "UTC" },
				captureStderr: true,
				timeout: 500,
			});
			if (started.ok && normalizeStart(started.out) === normalizeStart(lock[2]))
				tree.ownership = {
					ownerId:
						harness === "claude" && Number(lock[1]) === parentPid
							? sessionId
							: `claude:${lock[1]}:${normalizeStart(lock[2])}`,
					live: true,
				};
		}
		if (!tree.primary && !tree.ownership?.live) {
			const relation = refineNativeWorktreeRelation("sibling", {
				targetRoot: root,
				payload,
				environment,
				parentPid,
				execGit: probeGit,
				execProcess: probeProcess,
				readMetadata,
			});
			if (relation === "own")
				tree.ownership = { ownerId: sessionId, live: true };
			else if (harness === "codex") {
				const metadataPath = probeGit(
					["rev-parse", "--git-path", "codex-thread.json"],
					{ cwd: root, env },
				);
				try {
					const metadata = metadataPath.ok
						? JSON.parse(readMetadata(resolve(root, metadataPath.out.trim())))
						: null;
					if (
						metadata?.version === 1 &&
						typeof metadata.ownerThreadId === "string" &&
						metadata.ownerThreadId.trim()
					)
						// v1 has owner identity, not other-owner liveness. No dead/alive
						// claim is inferred from an unmatched thread identifier.
						tree.ownership = { ownerId: metadata.ownerThreadId, live: false };
				} catch {
					/* Optional native evidence cannot invent ownership. */
				}
			}
		}
		facts.worktrees.push(tree);
		if (branch) facts.branches[branch] = { checkedOutAt: root };
	}
	for (const { path, followFinalSymlink } of paths.values()) {
		const physical = resolvePhysicalPath(path, payload.cwd, {
			followFinalSymlink,
		});
		(followFinalSymlink ? facts.physicalPaths : facts.physicalEntryPaths)[
			path
		] = physical;
		const target = resolveGitRoots(existingDirectory(physical), {
			exec: probeGit,
			environment: env,
		});
		if (
			target &&
			!facts.worktrees.some(({ root }) => root === target.worktreeRoot)
		)
			facts.worktrees.push({
				root: target.worktreeRoot,
				commonDir: target.commonDir,
				primary: target.worktreeRoot === target.mainRoot,
				branch: null,
			});
	}
	return facts;
}
