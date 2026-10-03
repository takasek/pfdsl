// Protect the repository's default branches by each file's actual checkout.
// Starting a session in one checkout does not make sibling checkouts foreign
// or establish ownership. This guard covers file tools, not arbitrary programs
// launched through Bash.
import {
	fileTargetScope,
	isFileEditTool,
	resolveFileTargetContext,
} from "./file-target-context.mjs";

export function evaluateWorktreeWriteGuard(payload, context) {
	if (!isFileEditTool(payload)) return { decision: "allow" };
	context ??= resolveFileTargetContext(payload);
	if (context.error) return { decision: "deny", reason: context.error };
	for (const target of context.targets) {
		const scope = fileTargetScope(target, context.sessionRoots);
		if (scope === "outside") continue;
		if (scope === "unknown" || target.currentBranch === undefined) {
			return {
				decision: "deny",
				reason: `Cannot resolve the repository and branch for '${target.path}'. Check the target checkout and retry with an absolute file path.`,
			};
		}
		if (target.currentBranch === target.mainBranch) {
			return {
				decision: "deny",
				reason: `Blocked write to '${target.path}': checkout '${target.roots.worktreeRoot}' is on protected branch '${target.currentBranch}'. Use a feature checkout and specify its absolute file path.`,
			};
		}
	}
	return { decision: "allow" };
}
