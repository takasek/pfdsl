// Shared refs and other checkout effects are independent of executor ownership.
// These are command-boundary safeguards, not a general Git transaction monitor.

import { basename } from "node:path";

const CODEX_ROUTINE = "codex-git-routine.mjs";
// The Git mutations the routine performs, by the subcommand the guards use.
const CODEX_ROUTINE_GIT_MUTATIONS = new Map([
	["stage-all", "add"],
	["commit", "commit"],
	["branch-rename", "branch"],
]);
// Verification verbs only: every other verb (fetch-origin, worktree-add,
// stage-all, setup, commit, branch-rename) changes shared Git state or hooks.
const CODEX_ROUTINE_CHILD_VERBS = new Set([
	"test",
	"build",
	"typecheck",
	"node-test",
	"node-script",
]);

/**
 * The Codex Git routine a command's words invoke, or null. Both the direct
 * form (`<path>/codex-git-routine.mjs <verb> ...`) and the node-launched form
 * (`node <path>/codex-git-routine.mjs <verb> ...`) are recognized.
 * @param {string[]} values the command words, quoting stripped
 * @returns {{verb: string | undefined, targetAt: number, gitSubcommand: string | null, childAllowed: boolean} | null}
 */
export function classifyCodexGitRoutine(values) {
	let at;
	if (basename(values[0] ?? "") === CODEX_ROUTINE) at = 0;
	else if (
		basename(values[0] ?? "") === "node" &&
		basename(values[1] ?? "") === CODEX_ROUTINE
	)
		at = 1;
	else return null;
	const verb = values[at + 1];
	return {
		verb,
		targetAt: at + 2,
		gitSubcommand: CODEX_ROUTINE_GIT_MUTATIONS.get(verb) ?? null,
		childAllowed: CODEX_ROUTINE_CHILD_VERBS.has(verb),
	};
}

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
// as that option. An exemption is only as safe as the exact option it names:
// a later option can cancel it or an option value can consume it.
function isLongOptionPrefix(arg, name) {
	const given = arg.split("=", 1)[0];
	return given.startsWith("--") && given.length > 2 && name.startsWith(given);
}

const CREATE_LONG_OPTIONS = ["--create", "--force-create", "--orphan"];

const BRANCH_MODIFYING_OPTIONS = [
	"--delete",
	"--delete-merged",
	"--move",
	"--copy",
	"--force",
	"--edit-description",
	"--set-upstream-to",
	"--unset-upstream",
];
// Filters take a commit argument (separated or attached) and imply list mode.
const BRANCH_FILTER_OPTIONS = [
	"--contains",
	"--no-contains",
	"--merged",
	"--no-merged",
	"--points-at",
];
const BRANCH_READ_OPTIONS = new Set([
	"--all",
	"--remotes",
	"--verbose",
	"--column",
	"--no-column",
	"--color",
	"--no-color",
	"--ignore-case",
	"--abbrev",
	"--no-abbrev",
	"--omit-empty",
]);

// Mirrors how `git branch` parses its arguments: it lists only for the list
// options, a filter, or when no operand is left; `-v`, `--format` and `--sort`
// alone do not, so `git branch -v newb` still creates `newb`.
function parseBranchArgs(args) {
	const parsed = {
		modifying: false,
		list: false,
		unknown: false,
		operands: [],
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--") {
			parsed.operands.push(...args.slice(i + 1));
			break;
		}
		if (!arg.startsWith("-") || arg === "-") {
			parsed.operands.push(arg);
			continue;
		}
		if (!arg.startsWith("--")) {
			for (const letter of arg.slice(1)) {
				if ("dDmMcCfu".includes(letter)) parsed.modifying = true;
				else if (letter === "l") parsed.list = true;
				else if (!"arvqi".includes(letter)) parsed.unknown = true;
			}
			continue;
		}
		const name = arg.split("=", 1)[0];
		const attached = arg.includes("=");
		if (
			BRANCH_MODIFYING_OPTIONS.some((option) => isLongOptionPrefix(arg, option))
		)
			parsed.modifying = true;
		else if (name === "--list" || name === "--show-current") parsed.list = true;
		else if (BRANCH_FILTER_OPTIONS.includes(name)) {
			parsed.list = true;
			if (!attached) i++;
		} else if (name === "--format" || name === "--sort") {
			if (!attached) i++;
		} else if (name === "--abbrev" ? !attached : !BRANCH_READ_OPTIONS.has(name))
			parsed.unknown = true;
	}
	return parsed;
}

/**
 * Whether `git branch <args>` only lists: list mode, no modifying option and
 * only options known to be read-only. Anything else is not read-only.
 */
export function isReadOnlyGitBranch(args) {
	const parsed = parseBranchArgs(args);
	return (
		!parsed.modifying &&
		!parsed.unknown &&
		(parsed.list || parsed.operands.length === 0)
	);
}

export function isReadOnlyGitConfig(args) {
	// Modern verbs are recognized only in the first position. In legacy mode,
	// Git stops parsing options at the first key (or --), so later flag-looking
	// strings are values. Consume option arguments before looking for markers.
	if (["get", "list"].includes(args[0])) return true;
	let write = [
		"set",
		"unset",
		"edit",
		"rename-section",
		"remove-section",
	].includes(args[0]);
	let read = false;
	let i = write ? 1 : 0;
	for (; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--") {
			i++;
			break;
		}
		if (!arg.startsWith("-") || arg === "-") break;
		if (["--help", "-h"].includes(arg)) return true;
		if (
			[
				"--add",
				"--unset",
				"--unset-all",
				"--replace-all",
				"--edit",
				"-e",
				"--rename-section",
				"--remove-section",
				"--append",
				"--all",
			].includes(arg)
		) {
			write = true;
			continue;
		}
		if (
			[
				"--file",
				"-f",
				"--blob",
				"--type",
				"-t",
				"--default",
				"--value",
				"--comment",
			].includes(arg)
		) {
			i++;
			continue;
		}
		if (/^(?:--(?:file|blob|type|default|value|comment)=|-[ft].+)/.test(arg))
			continue;
		if (
			[
				"--get",
				"--get-all",
				"--get-regexp",
				"--get-urlmatch",
				"--list",
				"-l",
			].includes(arg)
		) {
			read = true;
			continue;
		}
		if (
			!/^--no-(?:global|system|local|worktree|file|blob|type|default|value|comment|all|append|fixed-value|includes|show-origin|show-scope)$/.test(
				arg,
			) &&
			![
				"--global",
				"--system",
				"--local",
				"--worktree",
				"--null",
				"-z",
				"--show-origin",
				"--show-scope",
				"--includes",
				"--no-includes",
				"--fixed-value",
				"--name-only",
				"--bool",
				"--int",
				"--bool-or-int",
				"--bool-or-str",
				"--path",
				"--expiry-date",
			].includes(arg)
		)
			return false;
	}
	return !write && (read || args.length - i === 1);
}

export function classifySharedGitEffect(subcommand, args) {
	if (hasGitHelpOption(subcommand, args)) return null;
	// A written setting (remote.<name>.fetch, core.*, ...) changes what later
	// commands do to shared refs, so a non-read config call is itself shared.
	if (subcommand === "config")
		return isReadOnlyGitConfig(args) ? null : { kind: "shared" };
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
			args[0] === "-c" ||
			isLongOptionPrefix(args[0] ?? "", "--move") ||
			isLongOptionPrefix(args[0] ?? "", "--copy")
		)
			return { kind: "rename-own", names: args.slice(1) };
		const parsed = parseBranchArgs(args);
		if (parsed.modifying) return { kind: "shared" };
		if (parsed.list) return null;
		return parsed.operands.length
			? { kind: "create-branch", ref: parsed.operands[0] }
			: null;
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
		// No `--dry-run` exemption: `--no-dry-run` can cancel it later in the
		// arguments, and an option value (`-o --dry-run`) can consume it.
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
