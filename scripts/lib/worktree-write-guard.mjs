// Detects an Edit/Write whose file_path escapes the worktree the session is
// running in — the mistake behind #357: a worktree session copies an
// absolute path from grep/find output or writes with a bare filename that
// resolves against the wrong root, and lands on the main checkout's working
// tree instead. Git history shows nothing wrong because the working tree,
// not a commit, is what changed, so the usual `git status` habit does not
// catch it either (see CLAUDE.md "worktree でのファイル操作パス").
//
// Deny, not advisory: this event surfaces as "the edit silently landed on
// the wrong branch," which is the "proceeds unnoticed" shape the roadmap.md
// warning already calls out as the reason advisory would be missed.

const WORKTREE_SEGMENT = /^(.*)\/\.claude\/worktrees\/([^/]+)(?:\/.*)?$/;

/**
 * @param {string} cwd
 * @returns {{ mainRoot: string, worktreeRoot: string } | null}
 */
function worktreeRootsFromCwd(cwd) {
	const match = WORKTREE_SEGMENT.exec(cwd);
	if (!match) return null;
	const [, mainRoot, name] = match;
	return { mainRoot, worktreeRoot: `${mainRoot}/.claude/worktrees/${name}` };
}

/** Whether `path` is `root` itself or a descendant of it (prefix-safe: no partial-segment match). */
function isUnder(path, root) {
	return path === root || path.startsWith(`${root}/`);
}

/**
 * Decide whether a PreToolUse Edit/Write invocation may proceed.
 * @param {object} payload PreToolUse hook payload
 * @returns {{decision: "allow"} | {decision: "deny", reason: string}}
 */
export function evaluateWorktreeWriteGuard(payload) {
	if (payload?.tool_name !== "Edit" && payload?.tool_name !== "Write") return { decision: "allow" };

	const cwd = payload?.cwd;
	const filePath = payload?.tool_input?.file_path;
	if (typeof cwd !== "string" || typeof filePath !== "string") return { decision: "allow" };
	if (!filePath.startsWith("/")) return { decision: "allow" };

	const roots = worktreeRootsFromCwd(cwd);
	if (!roots) return { decision: "allow" };

	if (isUnder(filePath, roots.worktreeRoot)) return { decision: "allow" };
	if (!isUnder(filePath, roots.mainRoot)) return { decision: "allow" };

	return {
		decision: "deny",
		reason:
			`Blocked write to '${filePath}': this session's cwd ('${cwd}') is inside a worktree, ` +
			`but the target path is outside it. Writing there would silently edit the main checkout ` +
			`(or a different worktree) instead of this branch. If this is intentional, switch the ` +
			"session's active directory to the target path first.",
	};
}

/**
 * Build the PreToolUse hook response for a deny decision.
 * @param {{reason: string}} result
 */
export function buildDenyOutput(result) {
	return {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: result.reason,
		},
	};
}
