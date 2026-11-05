/**
 * Decides how to point the repo-local skill path at the tracked generated copy.
 *
 * `.claude/skills/pfdsl` used to be its own generated, gitignored directory.
 * Nothing regenerated it on a branch switch, so an agent could read the
 * conventions of whichever branch last ran the generator (#714). Pointing it at
 * the tracked `generated/skills/pfdsl` hands that synchronisation to git.
 *
 * Kept separate from the filesystem work so the state machine — including the
 * migration from the old real directory — is testable without a fixture tree.
 */

/** Where .claude/skills/pfdsl points, relative to its own directory. */
export const SKILL_LINK_TARGET = "../../generated/skills/pfdsl";

/**
 * @param {{present: boolean, isSymlink?: boolean, linkTarget?: string}} state
 * @param {string} expectedTarget link target, relative to the link's own directory
 * @returns {{action: "create"|"relink"|"replace"|"ok", reason?: string}}
 */
export function decideSkillLinkAction(state, expectedTarget) {
	if (!state.present) return { action: "create" };
	if (!state.isSymlink) {
		return {
			action: "replace",
			reason: "a real directory is present (generated copy from before #714)",
		};
	}
	if (state.linkTarget !== expectedTarget) {
		return {
			action: "relink",
			reason: `symlink points at ${state.linkTarget}`,
		};
	}
	return { action: "ok" };
}
