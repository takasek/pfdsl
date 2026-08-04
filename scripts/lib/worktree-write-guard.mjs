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
//
// worktreeRoot/mainRoot are resolved by the hook wrapper via `git rev-parse
// --show-toplevel` / `--git-common-dir` rather than by matching cwd against
// the `.claude/worktrees/<name>` naming convention here — git's own notion
// of worktree boundaries also covers a worktree created anywhere else (e.g.
// a bare `git worktree add ../scratch`), which a path regex would miss.

/** Whether `path` is `root` itself or a descendant of it (prefix-safe: no partial-segment match). */
function isUnder(path, root) {
	return path === root || path.startsWith(`${root}/`);
}

/**
 * Decide whether a PreToolUse Edit/Write invocation may proceed.
 * @param {object} payload PreToolUse hook payload
 * @param {{worktreeRoot: string, mainRoot: string} | null} roots git-derived
 *   roots for the session's cwd, or null when they could not be resolved
 *   (cwd missing, not a git repo, `git rev-parse` failure)
 * @returns {{decision: "allow"} | {decision: "deny", reason: string}}
 */
export function evaluateWorktreeWriteGuard(payload, roots) {
	if (payload?.tool_name !== "Edit" && payload?.tool_name !== "Write")
		return { decision: "allow" };

	const filePath = payload?.tool_input?.file_path;
	if (typeof filePath !== "string" || !filePath.startsWith("/"))
		return { decision: "allow" };
	if (!roots) return { decision: "allow" };

	const { worktreeRoot, mainRoot } = roots;
	// cwd's toplevel and its git-common-dir's parent coincide exactly when cwd
	// is the main checkout itself — nothing to guard against there.
	if (worktreeRoot === mainRoot) return { decision: "allow" };

	if (isUnder(filePath, worktreeRoot)) return { decision: "allow" };
	if (!isUnder(filePath, mainRoot)) return { decision: "allow" };

	return {
		decision: "deny",
		reason:
			`Blocked write to '${filePath}': this session is running in worktree '${worktreeRoot}', ` +
			`but the target path is in the main checkout ('${mainRoot}') or a different worktree. Writing ` +
			"there would silently edit the wrong branch's working tree. If this is intentional, switch " +
			"the session's active directory to the target path first.",
	};
}
