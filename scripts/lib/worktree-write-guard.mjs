// Guards absolute Edit/Write file_path targets from a linked worktree when
// they point inside the main checkout but outside the active worktree.
// This covers the main checkout and sibling worktrees located under it.
// Relative paths, missing roots, calls from the main checkout, and paths
// outside the main checkout are allowed; those targets are not inspected.
//
// Deny before execution: the write would change another checkout's working
// tree. An advisory after the write cannot prevent that mutation.
//
// worktreeRoot/mainRoot are resolved by the hook wrapper via `git rev-parse
// --show-toplevel` / `--git-common-dir` rather than by matching cwd against
// the `.claude/worktrees/<name>` naming convention here. This is about which
// worktree the session is running from, not about where a write points: git's
// own notion of worktree boundaries recognizes a session started in a worktree
// created anywhere else (e.g. a bare `git worktree add ../scratch`), which a
// path regex over cwd would miss. Such a worktree is still only recognized as
// the session's own root — as a write target it sits outside mainRoot, which
// the allow above already covers.

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
