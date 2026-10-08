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
// The verbs a child may run: node-test and node-script only. The routine's
// `test`, `build` and `typecheck` verbs are pre-approved by the Codex rules
// (`decision = "allow"`), and `make test` / `make typecheck` run `build`,
// which reaches preflight and the shared pre-commit hook install in the common
// git dir. Through the wrapper a child would do that outside what its own
// sandboxed `make` could, so those verbs are denied for it. node-test and
// node-script have no such rule. Every other verb (fetch-origin, worktree-add,
// stage-all, setup, commit, branch-rename) changes shared Git state.
const CODEX_ROUTINE_CHILD_VERBS = new Set(["node-test", "node-script"]);

/**
 * The Codex Git routine a command's words invoke, or null. Both the direct
 * form (`<path>/codex-git-routine.mjs <verb> ...`) and the node-launched form
 * (`node [options] [--] <path>/codex-git-routine.mjs <verb> ...`) are recognized.
 * @param {string[]} values the command words, quoting stripped
 * @returns {{verb: string | undefined, targetAt: number, gitSubcommand: string | null, childAllowed: boolean} | null}
 */
export function classifyCodexGitRoutine(values) {
	let at;
	if (basename(values[0] ?? "") === CODEX_ROUTINE) at = 0;
	else if (basename(values[0] ?? "") === "node") {
		// Node options, their values and `--` may precede the script; the first
		// word that is the routine is the script, whatever arity those options have.
		at = values.findIndex(
			(value, index) => index > 0 && basename(value) === CODEX_ROUTINE,
		);
		if (at < 0) return null;
	} else return null;
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

// A toggle option (`--detach` / `--no-detach`) is honored only while the last
// occurrence is the exact positive spelling. A negation or any other prefix of
// either name, however it is abbreviated, cancels it.
function toggleIsOn(args, positives, positiveName, negativeName) {
	let on = false;
	for (const arg of args) {
		if (positives.includes(arg)) on = true;
		else if (
			isLongOptionPrefix(arg, negativeName) ||
			isLongOptionPrefix(arg, positiveName)
		)
			on = false;
	}
	return on;
}

const CREATE_LONG_OPTIONS = ["--create", "--force-create", "--orphan"];

// `-m`/`-c` and these only rename or copy the branch they name; everything
// else that modifies can reach another branch's ref.
const BRANCH_RENAME_OPTIONS = ["--move", "--copy"];
const BRANCH_MODIFYING_OPTIONS = [
	"--delete",
	"--delete-merged",
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
const BRANCH_CREATION_OPTIONS = [
	"--track",
	"--no-track",
	"--create-reflog",
	"--no-create-reflog",
];
const BRANCH_READ_OPTIONS = new Set([
	"--all",
	"--quiet",
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
		rename: false,
		creationOption: false,
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
				if ("mc".includes(letter)) parsed.rename = true;
				else if ("dDMCfu".includes(letter)) parsed.modifying = true;
				else if (letter === "l") parsed.list = true;
				else if (letter === "t") parsed.creationOption = true;
				else if (!"arvqi".includes(letter)) parsed.unknown = true;
			}
			continue;
		}
		const name = arg.split("=", 1)[0];
		const attached = arg.includes("=");
		if (BRANCH_RENAME_OPTIONS.some((option) => isLongOptionPrefix(arg, option)))
			parsed.rename = true;
		else if (
			BRANCH_MODIFYING_OPTIONS.some((option) => isLongOptionPrefix(arg, option))
		)
			parsed.modifying = true;
		else if (name === "--list" || name === "--show-current") parsed.list = true;
		// Documented creation options: known, but not a read.
		else if (BRANCH_CREATION_OPTIONS.includes(name))
			parsed.creationOption = true;
		else if (BRANCH_FILTER_OPTIONS.includes(name)) {
			parsed.list = true;
			if (!attached) i++;
		} else if (name === "--format" || name === "--sort") {
			if (!attached) i++;
		} else if (!BRANCH_READ_OPTIONS.has(name)) parsed.unknown = true;
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
		!parsed.rename &&
		!parsed.creationOption &&
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

/**
 * Whether `git reflog <args>` only reads. Git's reflog verbs are a closed set
 * (show, list, exists, expire, delete, drop, write); any other first word is a
 * ref handed to `show`, and a leading option also means `show` (so
 * `reflog --date=iso expire` is a failed show). The writers are exactly a first
 * argument of `write`, which can inject an entry, or `expire`, `delete` and
 * `drop`, which remove entries, including the stash's recovery information.
 */
export function isReadOnlyGitReflog(args) {
	return !["expire", "delete", "drop", "write"].includes(args[0]);
}

// Subcommands with no mode that writes a ref, the index, the config or a
// reflog: they print from the object database, refs, index or working tree.
// The second block is the ordinary search and inspection commands a command-line
// config such as `-c color.ui=never` is routinely paired with — grep, blame and
// annotate (history and content search), shortlog and cherry (log summaries),
// ls-remote (lists a remote's refs), diff-tree, diff-index and diff-files
// (plumbing diffs), name-rev, show-branch and range-diff (ref and range
// inspection), whatchanged (a log variant), check-ignore and check-attr
// (attribute queries), count-objects, verify-commit and verify-tag (reports),
// and version and var (print constants). Each only reads, so a child may run it
// and a config override on it is not a shared effect.
function remoteVerb(args) {
	return args.find((arg) => !["-v", "--verbose"].includes(arg));
}

/**
 * Whether `git remote <args>` only reads: no verb, `-v`/`--verbose`, `show`
 * or `get-url`. This is the narrow table a Codex child may run; `update`,
 * `prune` and `set-head` move refs, so they are not reads for it.
 */
export function isReadOnlyGitRemote(args) {
	const action = remoteVerb(args);
	return action === undefined || ["show", "get-url"].includes(action);
}

/**
 * Whether `git remote <args>` writes repository config: `add` (including
 * `--mirror`), `rename`, `remove`/`rm`, `set-url` and `set-branches`. A mirror
 * remote or a rewritten `remote.<name>.fetch` changes what a later plain fetch
 * does. `update`, `prune` and `set-head` touch only `refs/remotes/*`, which
 * is outside the protected set.
 */
function writesGitRemoteConfig(args) {
	return ["add", "rename", "remove", "rm", "set-url", "set-branches"].includes(
		remoteVerb(args),
	);
}

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
	"grep",
	"blame",
	"annotate",
	"shortlog",
	"cherry",
	"ls-remote",
	"diff-tree",
	"diff-index",
	"diff-files",
	"name-rev",
	"show-branch",
	"range-diff",
	"whatchanged",
	"check-ignore",
	"check-attr",
	"count-objects",
	"verify-commit",
	"verify-tag",
	"version",
	"var",
	"status",
	"diff",
	"log",
	"show",
	"rev-parse",
	"ls-files",
	"ls-tree",
	"show-ref",
	"for-each-ref",
	"cat-file",
	"rev-list",
	"merge-base",
	"describe",
	"help",
]);

/**
 * Whether `git <subcommand> <args>` only reads: the table of invocations a
 * Codex child may run, shared so that the parent classifies a read the same
 * way.
 */
export function isReadOnlyGitInvocation(subcommand, args) {
	if (READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) return true;
	if (subcommand === "branch" && isReadOnlyGitBranch(args)) return true;
	if (subcommand === "remote" && isReadOnlyGitRemote(args)) return true;
	if (subcommand === "config") return isReadOnlyGitConfig(args);
	if (subcommand === "reflog" && isReadOnlyGitReflog(args)) return true;
	if (subcommand === "stash" && ["list", "show"].includes(args[0])) return true;
	if (subcommand === "worktree" && args[0] === "list") return true;
	return hasGitHelpOption(subcommand, args);
}

/**
 * Whether a command-line configuration override (`git -c`, `--config-env`, a
 * visible `GIT_CONFIG_*` assignment) makes `subcommand` a shared effect. Any
 * key can matter, since `include.path` loads arbitrary settings, so every
 * invocation that is not a read is. The caller supplies the fact that an
 * override is present. "Read" is `isReadOnlyGitInvocation`, whose table
 * covers ordinary reads such as grep and blame; an earlier, narrower table
 * made `git -c color.ui=never grep` ask.
 */
export function isConfigOverrideEffect(subcommand, args) {
	return !isReadOnlyGitInvocation(subcommand, args);
}

export function classifySharedGitEffect(subcommand, args) {
	if (hasGitHelpOption(subcommand, args)) return null;
	if (subcommand === "reflog")
		return isReadOnlyGitReflog(args) ? null : { kind: "shared" };
	if (subcommand === "remote")
		return writesGitRemoteConfig(args) ? { kind: "shared" } : null;
	// `rebase --update-refs` moves the other branches that point into the
	// rebased range; the last toggle wins, and a prefix counts as the option.
	if (subcommand === "rebase") {
		let updatesRefs = false;
		for (const arg of args) {
			if (isLongOptionPrefix(arg, "--update-refs")) updatesRefs = true;
			else if (isLongOptionPrefix(arg, "--no-update-refs")) updatesRefs = false;
		}
		return updatesRefs ? { kind: "shared" } : null;
	}
	// A written setting (remote.<name>.fetch, core.*, ...) changes what later
	// commands do to shared refs, so a non-read config call is itself shared.
	if (subcommand === "config")
		return isReadOnlyGitConfig(args) ? null : { kind: "shared" };
	if (subcommand === "update-ref")
		return { kind: "shared", unresolved: args.includes("--stdin") };
	if (subcommand === "symbolic-ref") {
		const operands = args.filter((arg) => !arg.startsWith("-"));
		return operands.length > 1 ||
			args.some((arg) => isLongOptionPrefix(arg, "--delete")) ||
			args.includes("-d")
			? { kind: "shared" }
			: null;
	}
	if (subcommand === "worktree") {
		// Even detached or existing-branch adds register shared worktree metadata.
		if (args[0] === "add") return { kind: "shared" };
		if (
			args[0] === "prune" &&
			toggleIsOn(args, ["--dry-run", "-n"], "--dry-run", "--no-dry-run")
		)
			return null;
		return ["remove", "move", "prune", "repair", "lock", "unlock"].includes(
			args[0],
		)
			? { kind: "shared" }
			: null;
	}
	if (subcommand === "branch") {
		const parsed = parseBranchArgs(args);
		if (parsed.modifying) return { kind: "shared" };
		// A rename or copy is own work wherever the flag sits among the options.
		if (parsed.rename) return { kind: "rename-own", names: parsed.operands };
		if (parsed.list) return null;
		if (!parsed.operands.length) return null;
		// A creation form carrying an option this parser does not know could be
		// a reset or a rewrite it cannot see.
		return parsed.unknown
			? { kind: "shared" }
			: { kind: "create-branch", ref: parsed.operands[0] };
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
			// A short cluster ends at its first creating letter: the rest of the
			// token is the value, or the next token when nothing follows.
			const cluster = arg.match(/^-[^-]*?([bBcC])(.*)$/);
			let ref;
			let forced = false;
			if (cluster) {
				forced = "BC".includes(cluster[1]);
				ref = cluster[2] || options[i + 1];
			} else if (
				// `--force` is its own exact option, not an abbreviation of
				// `--force-create`.
				arg !== "--force" &&
				CREATE_LONG_OPTIONS.some((name) => isLongOptionPrefix(arg, name))
			) {
				forced = isLongOptionPrefix(arg, "--force-create");
				ref = arg.includes("=")
					? arg.slice(arg.indexOf("=") + 1)
					: options[i + 1];
			} else continue;
			// -B, -C and --force-create can reset an existing branch (another
			// checkout's, or the default), so they are a forced change, not creation.
			if (forced) return { kind: "shared" };
			return ref ? { kind: "enter-branch", ref } : null;
		}
		if (
			toggleIsOn(
				options,
				subcommand === "switch" ? ["--detach", "-d"] : ["--detach"],
				"--detach",
				"--no-detach",
			) ||
			(subcommand === "checkout" && afterSeparator.length > 0)
		)
			return null;
		const operands = [
			...options,
			...(subcommand === "switch" ? afterSeparator : []),
		];
		// The previous branch (`-`, `@{-N}`) resolves at run time to whatever
		// this checkout was on, possibly the default branch.
		if (operands.some((arg) => arg === "-" || arg.includes("@{-")))
			return { kind: "shared" };
		// Option arity is not modeled, so an option value (`--conflict merge main`)
		// cannot be told from the branch: every operand is a candidate.
		const refs = operands.filter((arg) => !arg.startsWith("-"));
		if (refs.length === 1) return { kind: "enter-branch", ref: refs[0] };
		if (refs.length) return { kind: "enter-branch", ref: refs[0], refs };
	}
	if (subcommand === "fetch") {
		// No `--dry-run` exemption: `--no-dry-run` can cancel it later in the
		// arguments, and an option value (`-o --dry-run`) can consume it.
		// `-u` lifts Git's own refusal to update the checked-out branch.
		if (
			args.some(
				(arg) =>
					/^-[^-]*u/.test(arg) || isLongOptionPrefix(arg, "--update-head-ok"),
			)
		)
			return { kind: "shared" };
		// Refspecs read from stdin are unresolvable at this boundary.
		if (args.some((arg) => isLongOptionPrefix(arg, "--stdin")))
			return { kind: "shared", unresolved: true };
		// Explicit local destinations / refmaps can replace a default or another
		// checkout's branch, even when Git is launched from an own feature tree.
		if (args.some((arg) => isLongOptionPrefix(arg, "--refmap")))
			return { kind: "shared" };
		if (writesLocalRefDestination(args)) return { kind: "shared" };
	}
	// `pull` fetches with its own refspecs, so a local destination writes the
	// same refs a fetch would.
	if (subcommand === "pull" && writesLocalRefDestination(args))
		return { kind: "shared" };
	// A push whose repository is this one (`.`, a path) writes local branches
	// just as update-ref does; pushes to remote names keep their handling.
	if (subcommand === "push") {
		// Option arity is not modeled (`--receive-pack <cmd>`, `--repo <r>`), so a
		// local repository spelling anywhere among the operands, or as a
		// `--repo` value, makes the push same-repository; every other operand
		// is then a refspec candidate.
		const operands = args.filter((arg) => !arg.startsWith("-"));
		const repoValues = args.flatMap((arg, index) => {
			if (!isLongOptionPrefix(arg, "--repo")) return [];
			return arg.includes("=")
				? [arg.slice(arg.indexOf("=") + 1)]
				: [args[index + 1] ?? ""];
		});
		if (
			[...operands, ...repoValues].some(isLocalRepositorySpelling) &&
			operands
				.filter((operand) => !isLocalRepositorySpelling(operand))
				.some((refspec) => isLocalRefDestination(refspec, true))
		)
			return { kind: "shared" };
	}
	return null;
}

/**
 * Whether the refspecs after the repository operand name a local ref as their
 * destination (remote-tracking refs, tags, and URL-like operands excluded).
 * For push, a refspec with no colon is its own destination.
 */
function writesLocalRefDestination(args) {
	let repository = false;
	for (const arg of args) {
		if (arg.startsWith("-")) continue;
		if (!repository) {
			repository = true;
			continue;
		}
		if (isLocalRefDestination(arg, false)) return true;
	}
	return false;
}

/** Whether one refspec writes a local ref (not remote-tracking, tag or URL). */
function isLocalRefDestination(refspec, bareIsDestination) {
	const colon = refspec.indexOf(":");
	if (colon < 0 && !bareIsDestination) return false;
	const destination = colon < 0 ? refspec : refspec.slice(colon + 1);
	return !(
		!destination ||
		destination.startsWith("//") ||
		destination.startsWith("refs/remotes/") ||
		destination.startsWith("refs/tags/")
	);
}

/**
 * A repository spelled as a path in this filesystem: any word starting with `.`
 * (`.`, `..`, `./x`, `.git`), `/` or `~`, or with `file://`. A remote name cannot
 * start with `.`, so the broad rule costs nothing.
 */
function isLocalRepositorySpelling(value) {
	return /^(?:[./~]|file:\/\/)/.test(value);
}

/**
 * Whether two branch names are the same ref. A case-insensitive filesystem
 * resolves `MAIN` to the loose `refs/heads/main`, so case never separates them.
 */
export function sameBranchName(a, b) {
	return (
		typeof a === "string" &&
		typeof b === "string" &&
		a.toLowerCase() === b.toLowerCase()
	);
}

function namesDefaultBranch(ref, mainBranch) {
	return (
		sameBranchName(ref, mainBranch) ||
		sameBranchName(ref, `refs/heads/${mainBranch}`)
	);
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
		!sameBranchName(currentBranch, mainBranch) &&
		(effect.names.length === 1 ||
			(effect.names.length === 2 && effect.names[0] === currentBranch)) &&
		effect.names.every(
			(name) => !namesDefaultBranch(name, mainBranch) && !/[$`*?]/.test(name),
		)
	)
		return { decision: "allow" };
	const refs = effect.refs ?? [effect.ref];
	if (
		["create-branch", "enter-branch"].includes(effect.kind) &&
		refs.every((ref) => !namesDefaultBranch(ref, mainBranch))
	) {
		if (!refs.some((ref) => /[$`*?]/.test(ref))) return { decision: "allow" };
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
