// Shared refs and other checkout effects are independent of executor ownership.
// These are command-boundary safeguards, not a general Git transaction monitor.

export function classifySharedGitEffect(subcommand, args) {
	if (args.includes("--help") || args.includes("-h")) return null;
	if (subcommand === "update-ref")
		return { kind: "shared", unresolved: args.includes("--stdin") };
	if (subcommand === "symbolic-ref") {
		const operands = args.filter((arg) => !arg.startsWith("-"));
		return operands.length > 1 ||
			args.includes("--delete") ||
			args.includes("-d")
			? { kind: "shared" }
			: null;
	}
	if (subcommand === "worktree") {
		// Even detached or existing-branch adds register shared worktree metadata.
		if (args[0] === "add") return { kind: "shared" };
		if (
			args[0] === "prune" &&
			(args.includes("--dry-run") || args.includes("-n"))
		)
			return null;
		return ["remove", "move", "prune", "repair", "lock", "unlock"].includes(
			args[0],
		)
			? { kind: "shared" }
			: null;
	}
	if (subcommand === "branch") {
		if (
			args[0] === "-m" ||
			args[0] === "--move" ||
			args[0] === "-c" ||
			args[0] === "--copy"
		)
			return { kind: "rename-own", names: args.slice(1) };
		const modifying = args.some(
			(arg) =>
				/^-(?:[dDmMcCf]+)$/.test(arg) ||
				[
					"--delete",
					"--delete-merged",
					"--move",
					"--copy",
					"--force",
					"--edit-description",
					"--set-upstream-to",
					"--unset-upstream",
					"-u",
				].includes(arg) ||
				arg.startsWith("--set-upstream-to="),
		);
		if (modifying) return { kind: "shared" };
		if (
			args.some(
				(arg) =>
					[
						"--list",
						"-l",
						"--show-current",
						"-a",
						"--all",
						"-r",
						"--remotes",
						"-v",
						"-vv",
						"--contains",
						"--no-contains",
						"--merged",
						"--no-merged",
						"--points-at",
					].includes(arg) || arg.startsWith("--format="),
			)
		)
			return null;
		const operands = [];
		for (let i = 0; i < args.length; i++) {
			if (["--track"].includes(args[i])) continue;
			if (!args[i].startsWith("-")) operands.push(args[i]);
		}
		return operands.length ? { kind: "create-branch", ref: operands[0] } : null;
	}
	if (subcommand === "checkout" || subcommand === "switch") {
		const attached = args
			.map((arg) => arg.match(/^-[^-]*?[bBcC](.+)$/))
			.find(Boolean);
		if (attached) return { kind: "enter-branch", ref: attached[1] };
		const inline = args.find((arg) =>
			/^--(?:create|force-create|orphan)=/.test(arg),
		);
		if (inline)
			return {
				kind: "enter-branch",
				ref: inline.slice(inline.indexOf("=") + 1),
			};
		if (
			args.includes("--") ||
			args.includes("--detach") ||
			(subcommand === "switch" && args.includes("-d"))
		)
			return null;
		const branchFlag = args.findIndex((arg) =>
			[
				"-b",
				"-B",
				"-c",
				"-C",
				"--orphan",
				"--create",
				"--force-create",
			].includes(arg),
		);
		const ref =
			branchFlag >= 0
				? args[branchFlag + 1]
				: args.find((arg) => !arg.startsWith("-"));
		if (ref) return { kind: "enter-branch", ref };
	}
	if (subcommand === "fetch") {
		if (args.includes("--dry-run") || args.includes("-n")) return null;
		// Explicit local destinations / refmaps can replace a default or another
		// checkout's branch, even when Git is launched from an own feature tree.
		if (args.some((arg) => arg === "--refmap" || arg.startsWith("--refmap=")))
			return { kind: "shared" };
		let repository = false;
		for (const arg of args) {
			if (arg.startsWith("-")) continue;
			if (!repository) {
				repository = true;
				continue;
			}
			const colon = arg.indexOf(":");
			if (colon < 0 || arg.startsWith("-")) continue;
			const destination = arg.slice(colon + 1);
			if (
				!destination ||
				destination.startsWith("//") ||
				destination.startsWith("refs/remotes/") ||
				destination.startsWith("refs/tags/")
			)
				continue;
			return { kind: "shared" };
		}
	}
	return null;
}

export function evaluateSharedGitEffect(
	effect,
	mainBranch,
	currentBranch,
	relation = "own",
) {
	if (
		effect.kind === "rename-own" &&
		relation === "own" &&
		currentBranch &&
		currentBranch !== mainBranch &&
		(effect.names.length === 1 ||
			(effect.names.length === 2 && effect.names[0] === currentBranch)) &&
		effect.names.every((name) => name !== mainBranch && !/[$`*?]/.test(name))
	)
		return { decision: "allow" };
	if (
		["create-branch", "enter-branch"].includes(effect.kind) &&
		effect.ref !== mainBranch &&
		effect.ref !== `refs/heads/${mainBranch}`
	) {
		if (!/[$`*?]/.test(effect.ref)) return { decision: "allow" };
	}
	return {
		decision:
			["create-branch", "enter-branch"].includes(effect.kind) ||
			effect.unresolved
				? "deny"
				: "ask",
		reason:
			"Blocked shared Git effect: this operation can change the default ref or another checkout's refs, stash, or worktree metadata. Executor ownership does not authorize those effects. Use an isolated feature change; repository maintenance belongs in your own terminal.",
	};
}
