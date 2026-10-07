// Shared refs and other checkout effects are independent of executor ownership.
// These are command-boundary safeguards, not a general Git transaction monitor.

export function hasGitHelpOption(subcommand, args) {
	// Only waive protection for an unambiguous option, never an operand or an
	// option's value. Other command forms conservatively retain their guard.
	let i = subcommand === "worktree" && !args[0]?.startsWith("-") ? 1 : 0;
	while (i < args.length) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") return true;
		if (subcommand !== "worktree") return false;
		if (arg === "--") return false;
		// worktree parse-options permits options after ordinary operands.
		if (!arg.startsWith("-") || arg === "-") {
			i++;
			continue;
		}
		if (/^-[^-]/.test(arg)) {
			let consumesNext = false;
			for (let j = 1; j < arg.length; j++) {
				if (arg[j] === "h") return true;
				if (arg[j] === "b" || arg[j] === "B") {
					consumesNext = j === arg.length - 1;
					break;
				}
				if (!"fdqnv".includes(arg[j])) return false;
			}
			i += consumesNext ? 2 : 1;
			continue;
		}
		if (["--reason", "--expire"].includes(arg)) {
			i += 2;
			continue;
		}
		if (/^--(?:reason|expire)=/.test(arg)) {
			i++;
			continue;
		}
		if (
			!/^--(?:no-)?(?:force|detach|lock|checkout|quiet|guess-remote|orphan|track|relative-paths|dry-run|verbose)$/.test(
				arg,
			) &&
			!/^--track=/.test(arg) &&
			!["--no-reason", "--no-expire"].includes(arg)
		)
			return false;
		i++;
	}
	return false;
}

// parse-options accepts any unique prefix of a long option, so an argument
// whose name part (before `=`) is a prefix of a dangerous option must be read
// as that option. Exemptions, by contrast, require the exact spelling.
function isLongOptionPrefix(arg, name) {
	const given = arg.split("=", 1)[0];
	return given.startsWith("--") && given.length > 2 && name.startsWith(given);
}

const CREATE_LONG_OPTIONS = ["--create", "--force-create", "--orphan"];

export function classifySharedGitEffect(subcommand, args) {
	if (hasGitHelpOption(subcommand, args)) return null;
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
		// Everything after `--` is a path, except that `switch` has no path
		// restore form: its operand after `--` is still the branch.
		const separator = args.indexOf("--");
		const options = separator >= 0 ? args.slice(0, separator) : args;
		const afterSeparator = separator >= 0 ? args.slice(separator + 1) : [];
		// Entering a branch another checkout holds is a shared effect even when
		// Git is told to allow it.
		if (
			options.some((arg) => isLongOptionPrefix(arg, "--ignore-other-worktrees"))
		)
			return { kind: "shared" };
		for (let i = 0; i < options.length; i++) {
			const arg = options[i];
			const attached = arg.match(/^-[^-]*?[bBcC](.+)$/);
			let ref;
			if (attached) ref = attached[1];
			else if (["-b", "-B", "-c", "-C"].includes(arg)) ref = options[i + 1];
			else if (
				// `--force` is its own exact option, not an abbreviation of
				// `--force-create`.
				arg !== "--force" &&
				CREATE_LONG_OPTIONS.some((name) => isLongOptionPrefix(arg, name))
			)
				ref = arg.includes("=")
					? arg.slice(arg.indexOf("=") + 1)
					: options[i + 1];
			else continue;
			return ref ? { kind: "enter-branch", ref } : null;
		}
		if (
			options.includes("--detach") ||
			(subcommand === "switch" && options.includes("-d")) ||
			(subcommand === "checkout" && afterSeparator.length > 0)
		)
			return null;
		const ref =
			options.find((arg) => !arg.startsWith("-")) ??
			(subcommand === "switch" ? afterSeparator[0] : undefined);
		if (ref) return { kind: "enter-branch", ref };
	}
	if (subcommand === "fetch") {
		// `-n` is `--no-tags` here; only the exact long spelling is a dry run.
		if (args.includes("--dry-run")) return null;
		// Refspecs read from stdin are unresolvable at this boundary.
		if (args.some((arg) => isLongOptionPrefix(arg, "--stdin")))
			return { kind: "shared", unresolved: true };
		// Explicit local destinations / refmaps can replace a default or another
		// checkout's branch, even when Git is launched from an own feature tree.
		if (args.some((arg) => isLongOptionPrefix(arg, "--refmap")))
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
