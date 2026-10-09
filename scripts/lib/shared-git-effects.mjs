// Shared refs and other checkout effects are independent of executor ownership.
// These are command-boundary safeguards, not a general Git transaction monitor.

import { existsSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { tryGit, withoutGitTargetEnvironment } from "./run-exec.mjs";
import { executableName } from "./shell-commands.mjs";

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
	if (executableName(values[0] ?? "").toLowerCase() === CODEX_ROUTINE) at = 0;
	else if (executableName(values[0] ?? "") === "node") {
		// Node options, their values and `--` may precede the script; the first
		// word that is the routine is the script, whatever arity those options have.
		at = values.findIndex(
			(value, index) =>
				index > 0 && executableName(value).toLowerCase() === CODEX_ROUTINE,
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
		if (/^-[lz]+$/.test(arg) && arg.includes("l")) {
			read = true;
			continue;
		}
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
				"--get-color",
				"--get-colorbool",
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
 * Display with `--output` writes a file, including before a later error.
 */
export function isReadOnlyGitReflog(args) {
	return (
		!["expire", "delete", "drop", "write"].includes(args[0]) &&
		!args.some((arg) => arg === "--output" || arg.startsWith("--output="))
	);
}

function remoteVerb(args) {
	for (const arg of args) {
		if (
			/^-v+$/.test(arg) ||
			(!arg.includes("=") &&
				(isLongOptionPrefix(arg, "--verbose") ||
					isLongOptionPrefix(arg, "--no-verbose")))
		)
			continue;
		// An unrecognized option cannot establish a harmless action.
		return arg.startsWith("-") ? null : arg;
	}
	return undefined;
}

const TAG_LIST_FILTERS = [
	"--contains",
	"--no-contains",
	"--points-at",
	"--merged",
	"--no-merged",
];
const TAG_LIST_FLAGS = new Set([
	"--list",
	"--ignore-case",
	"--column",
	"--no-column",
	"--color",
	"--no-color",
	"--omit-empty",
]);

/**
 * Whether `git tag <args>` only lists: no arguments, or list mode (`-l`,
 * `-n`, or a filter such as `--contains`) with only list options and patterns.
 * Other modes are conservatively outside this read table: they include
 * creation/deletion and unmodeled verification such as `git tag -v`.
 */
export function isReadOnlyGitTag(args) {
	if (args.length === 0) return true;
	let list = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg.startsWith("-") || arg === "-") continue;
		const name = arg.split("=", 1)[0];
		const attached = arg.includes("=");
		if (arg === "-l" || name === "--list") list = true;
		else if (/^-n[0-9]*$/.test(arg)) list = true;
		else if (TAG_LIST_FILTERS.includes(name)) {
			list = true;
			if (!attached) i++;
		} else if (name === "--sort" || name === "--format") {
			if (!attached) i++;
		} else if (arg !== "-i" && !TAG_LIST_FLAGS.has(name)) return false;
	}
	return list;
}

/** Whether `git notes <args>` only reads: no verb, `list` or `show`. */
export function isReadOnlyGitNotes(args) {
	return args[0] === undefined || ["list", "show"].includes(args[0]);
}

/**
 * Whether `git remote <args>` only reads: no verb, verbosity options, `show`
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
 * does. With ordinary refspecs, `update`, `prune` and `set-head` touch only
 * `refs/remotes/*`, which is outside the protected set. An unknown action is
 * conservatively shared, rather than proof that no configuration is written.
 */
function writesGitRemoteConfig(args) {
	const action = remoteVerb(args);
	return (
		action !== undefined &&
		!["show", "get-url", "update", "prune", "set-head"].includes(action)
	);
}

// Baseline read subcommands: their ordinary modes print from the object
// database, refs, index or working tree.
// Besides the basic status, diff, log and rev-parse family, the set holds the
// ordinary search and inspection commands a command-line config such as
// `-c color.ui=never` is routinely paired with: grep, blame and annotate
// (history and content search), shortlog and cherry (log summaries), ls-remote
// (lists a remote's refs), diff-tree, diff-index and diff-files (plumbing
// diffs), name-rev, show-branch and range-diff (ref and range inspection),
// whatchanged (a log variant), check-ignore and check-attr (attribute
// queries), count-objects, verify-commit and verify-tag (reports), and version
// and var (print constants). The table allows a child to run them and exempts
// their config overrides. It does not prove every option is free of effects:
// output modes such as log/show --output remain a pre-existing gap.
// Subcommands with both read and
// write modes (branch, remote, config, reflog, stash, tag, notes, worktree) are
// decided per invocation in isReadOnlyGitInvocation instead.
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
	if (subcommand === "tag" && isReadOnlyGitTag(args)) return true;
	if (subcommand === "notes" && isReadOnlyGitNotes(args)) return true;
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

// Arity from git rebase's options: only a parsed option can toggle update-refs.
// Unknown or ambiguous options keep a shared effect rather than letting their
// possible value masquerade as --no-update-refs. Optional values are attached.
const REBASE_VALUE_OPTIONS = [
	"onto",
	"whitespace",
	"empty",
	"exec",
	"strategy",
	"strategy-option",
	"trailer",
];
const REBASE_OPTIONAL_VALUE_OPTIONS = ["gpg-sign", "rebase-merges"];
const REBASE_BOOLEAN_OPTIONS = [
	"keep-base",
	"verify",
	"quiet",
	"verbose",
	"stat",
	"signoff",
	"committer-date-is-author-date",
	"reset-author-date",
	"ignore-date",
	"ignore-whitespace",
	"force-rebase",
	"ff",
	"continue",
	"skip",
	"abort",
	"quit",
	"edit-todo",
	"show-current-patch",
	"apply",
	"merge",
	"interactive",
	"rerere-autoupdate",
	"autosquash",
	"autostash",
	"update-refs",
	"fork-point",
	"root",
	"reschedule-failed-exec",
	"reapply-cherry-picks",
	"keep-empty",
	"allow-empty-message",
];
const REBASE_LONG_OPTIONS = [
	...REBASE_VALUE_OPTIONS.map((name) => ({ name: `--${name}`, value: true })),
	...[
		...REBASE_VALUE_OPTIONS,
		...REBASE_OPTIONAL_VALUE_OPTIONS,
		...REBASE_BOOLEAN_OPTIONS,
	].map((name) => ({ name: `--no-${name}`, value: false })),
	...[...REBASE_OPTIONAL_VALUE_OPTIONS, ...REBASE_BOOLEAN_OPTIONS].map(
		(name) => ({ name: `--${name}`, value: false }),
	),
];

function rebaseUpdatesRefs(args, isDynamic) {
	let updatesRefs = false;
	let unresolved = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--") break;
		const given = arg.split("=", 1)[0];
		const exact = REBASE_LONG_OPTIONS.find((option) => option.name === given);
		// An expansion in an option position may enable updates to other refs.
		// Only a declared static long name may carry an attached dynamic value.
		const attachedValue =
			arg.includes("=") &&
			exact &&
			(exact.value || REBASE_OPTIONAL_VALUE_OPTIONS.includes(given.slice(2)));
		if (isDynamic(arg) && !attachedValue) return true;
		if (arg.startsWith("--")) {
			const matches = exact
				? [exact]
				: REBASE_LONG_OPTIONS.filter((option) =>
						isLongOptionPrefix(arg, option.name),
					);
			if (matches.length !== 1) {
				unresolved = true;
				continue;
			}
			const option = matches[0];
			// Quit can publish a temporary autostash to the shared stash list.
			if (option.name === "--quit") return true;
			if (option.name === "--update-refs") updatesRefs = true;
			else if (option.name === "--no-update-refs") updatesRefs = false;
			if (option.value && !arg.includes("=")) i++;
		} else if (arg.startsWith("-") && arg !== "-") {
			for (let j = 1; j < arg.length; j++) {
				if ("CxsX".includes(arg[j])) {
					if (j === arg.length - 1) i++;
					break;
				}
				if ("rS".includes(arg[j])) break;
				if (!"qvnfmikh".includes(arg[j])) {
					unresolved = true;
					break;
				}
			}
		}
	}
	return updatesRefs || unresolved;
}

// Push options must be consumed before choosing the repository operand. A
// refspec can name an existing file without becoming the push repository.
const PUSH_VALUE_OPTIONS = [
	"repo",
	"receive-pack",
	"exec",
	"push-option",
	"recurse-submodules",
];
const PUSH_OTHER_OPTIONS = [
	"verbose",
	"quiet",
	"all",
	"branches",
	"mirror",
	"delete",
	"tags",
	"dry-run",
	"porcelain",
	"force",
	"force-with-lease",
	"force-if-includes",
	"thin",
	"set-upstream",
	"progress",
	"prune",
	"verify",
	"follow-tags",
	"signed",
	"atomic",
	"ipv4",
	"ipv6",
];
const PUSH_LONG_OPTIONS = [
	...PUSH_VALUE_OPTIONS.map((name) => ({ name: `--${name}`, value: true })),
	...PUSH_OTHER_OPTIONS.map((name) => ({ name: `--${name}`, value: false })),
	...[...PUSH_VALUE_OPTIONS, ...PUSH_OTHER_OPTIONS].map((name) => ({
		name: `--no-${name}`,
		value: false,
	})),
];

function pushRepositoryAndRefspecs(args) {
	const operands = [];
	let repoOption;
	let options = true;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!options || !arg.startsWith("-") || arg === "-") {
			operands.push(arg);
			continue;
		}
		if (arg === "--") {
			options = false;
			continue;
		}
		if (arg.startsWith("--")) {
			const given = arg.split("=", 1)[0];
			const exact = PUSH_LONG_OPTIONS.find((option) => option.name === given);
			const matches = exact
				? [exact]
				: PUSH_LONG_OPTIONS.filter((option) => option.name.startsWith(given));
			if (matches.length !== 1) return null;
			const option = matches[0];
			let value = arg.includes("=")
				? arg.slice(arg.indexOf("=") + 1)
				: undefined;
			if (option.value && value === undefined) value = args[++i];
			if (option.value && value === undefined) return null;
			if (option.name === "--repo") repoOption = value;
			if (option.name === "--no-repo") repoOption = undefined;
			continue;
		}
		for (let at = 1; at < arg.length; at++) {
			if (arg[at] === "o") {
				if (at + 1 === arg.length && args[++i] === undefined) return null;
				break;
			}
			if (!"vqdnfu46".includes(arg[at])) return null;
		}
	}
	return {
		repository: operands[0] ?? repoOption,
		refspecs: operands.slice(1),
		repoOption,
		operands,
	};
}

export function classifySharedGitEffect(
	subcommand,
	args,
	{ cwd, exec = tryGit, argTokens = [] } = {},
) {
	if (hasGitHelpOption(subcommand, args)) return null;
	// Preserve shell provenance only where an argument selects a shared effect.
	// Do not evaluate expansions or reject ordinary message/option/path values.
	const dynamicValues = new Set(
		argTokens.filter((token) => token.dynamic).map((token) => token.value),
	);
	const isDynamic = (value) => dynamicValues.has(value);
	if (subcommand === "reflog") {
		if (isDynamic(args[0]) && !/^--[A-Za-z0-9][A-Za-z0-9-]*=/.test(args[0]))
			return { kind: "shared", unresolved: true };
		return isReadOnlyGitReflog(args) ? null : { kind: "shared" };
	}
	if (subcommand === "remote")
		return writesGitRemoteConfig(args) ? { kind: "shared" } : null;
	// The last actual toggle wins, after consuming required option values.
	if (subcommand === "rebase")
		return rebaseUpdatesRefs(args, isDynamic) ? { kind: "shared" } : null;
	// A written setting (remote.<name>.fetch, core.*, ...) changes what later
	// commands do to shared refs, so a non-read config call is itself shared.
	if (subcommand === "config")
		return isReadOnlyGitConfig(args) ? null : { kind: "shared" };
	if (subcommand === "update-ref")
		return { kind: "shared", unresolved: args.includes("--stdin") };
	if (subcommand === "symbolic-ref") {
		const operands = args.filter((arg) => !arg.startsWith("-"));
		return operands.length > 1 ||
			args.some(
				(arg) => isLongOptionPrefix(arg, "--delete") || /^-[^-]*d/.test(arg),
			)
			? { kind: "shared" }
			: null;
	}
	if (subcommand === "worktree") {
		if (isDynamic(args[0])) return { kind: "shared", unresolved: true };
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
		if (parsed.rename)
			return parsed.operands.some(isDynamic)
				? { kind: "shared", unresolved: true }
				: { kind: "rename-own", names: parsed.operands };
		if (parsed.list) return null;
		if (!parsed.operands.length) return null;
		if (isDynamic(parsed.operands[0]))
			return { kind: "shared", unresolved: true };
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
			if (isDynamic(ref)) return { kind: "shared", unresolved: true };
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
		if (refs.some(isDynamic)) return { kind: "shared", unresolved: true };
		if (refs.length === 1) return { kind: "enter-branch", ref: refs[0] };
		if (refs.length) return { kind: "enter-branch", ref: refs[0], refs };
	}
	// Explicit refmaps can replace a default or another checkout's branch;
	// pull passes them to its fetch before merging or rebasing.
	if (
		["fetch", "pull"].includes(subcommand) &&
		args.some((arg) => isLongOptionPrefix(arg, "--refmap"))
	)
		return { kind: "shared" };
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
		if (writesLocalRefDestination(args, isDynamic, subcommand, isDynamic))
			return { kind: "shared", unresolved: true };
		if (writesLocalRefDestination(args)) return { kind: "shared" };
	}
	// `pull` fetches with its own refspecs, so a local destination writes the
	// same refs a fetch would.
	if (subcommand === "pull") {
		if (writesLocalRefDestination(args, isDynamic, subcommand, isDynamic))
			return { kind: "shared", unresolved: true };
		if (writesLocalRefDestination(args, undefined, subcommand))
			return { kind: "shared" };
	}
	// A push whose repository is this one (`.`, a path) writes local branches
	// just as update-ref does; pushes to remote names keep their handling.
	if (subcommand === "push") {
		if (cwd === null) return { kind: "shared", unresolved: true };
		const parsed = pushRepositoryAndRefspecs(args);
		if (!parsed) return { kind: "shared", unresolved: true };
		if (
			isDynamic(parsed.repository) ||
			isDynamic(parsed.repoOption) ||
			parsed.refspecs.some(isDynamic)
		)
			return { kind: "shared", unresolved: true };
		// Retain the prior conservative --repo boundary even when a positional
		// repository is also supplied. Its value is not a receive-pack argument.
		for (const [repository, refspecs] of [
			[parsed.repository, parsed.refspecs],
			[parsed.repoOption, parsed.operands],
		]) {
			if (
				repository === undefined ||
				!refspecs.some((refspec) => isLocalRefDestination(refspec, true))
			)
				continue;
			const local = isLocalRepositorySpelling(repository, cwd, exec);
			if (local === null) return { kind: "shared", unresolved: true };
			if (local) return { kind: "shared" };
		}
	}
	return null;
}

/**
 * Whether the refspecs after the repository operand name a local ref as their
 * destination (remote-tracking refs, tags, and URL-like operands excluded).
 * For push, a refspec with no colon is its own destination.
 */
// Required fetch/pull option values are not refspecs, even after the repo.
// Optional values use the attached form and do not consume the next word.
const FETCH_VALUE_OPTIONS = new Set([
	"--upload-pack",
	"--depth",
	"--deepen",
	"--shallow-since",
	"--shallow-exclude",
	"--refmap",
	"--server-option",
	"-o",
	"--negotiation-tip",
	"--filter",
]);
const PULL_MERGE_VALUE_OPTIONS = new Set([
	"--cleanup",
	"--strategy",
	"-s",
	"--strategy-option",
	"-X",
]);

function writesLocalRefDestination(
	args,
	writesDestination = (refspec) => isLocalRefDestination(refspec, false),
	subcommand = "fetch",
	isDynamic = () => false,
) {
	const valueOptions = new Set([
		...FETCH_VALUE_OPTIONS,
		...(subcommand === "fetch" ? ["-j", "--jobs"] : PULL_MERGE_VALUE_OPTIONS),
	]);
	let repository = false;
	let options = true;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (options && arg === "--") {
			options = false;
			continue;
		}
		// An expanded word before `--` may be an option, even where the
		// literal spelling looks like a repository or refspec. Static option
		// values remain values and do not select shared effects.
		if (options && isDynamic(arg)) {
			const attachedValue =
				(arg.includes("=") && valueOptions.has(arg.split("=", 1)[0])) ||
				[...valueOptions].some(
					(option) => /^-[^-]$/.test(option) && arg.startsWith(option),
				);
			if (!attachedValue) return true;
		}
		if (options && arg.startsWith("-")) {
			if (valueOptions.has(arg)) i++;
			continue;
		}
		if (!repository) {
			repository = true;
			continue;
		}
		if (writesDestination(arg)) return true;
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

/** Resolve push URL rewriting and repository identity through read-only Git queries. */
function isLocalRepositorySpelling(value, cwd, exec) {
	if (value.includes("\n") || value.includes("\0")) return null;
	if (typeof cwd !== "string") return /^(?:[./~]|file:\/\/)/.test(value);
	if (!existsSync(cwd)) return /^(?:[./~]|file:\/\/)/.test(value);
	const opts = {
		cwd,
		env: withoutGitTargetEnvironment(process.env),
		captureStderr: true,
		timeout: 1000,
	};
	const remotes = exec(["remote"], opts);
	if (!remotes.ok) return null;
	const named = remotes.out.trim().split("\n").includes(value);
	if (!named) {
		// ls-remote --get-url expands insteadOf without connecting. Git has no
		// equivalent raw-operand query for pushInsteadOf; use a configured remote
		// when that policy is present rather than reconstructing Git's rewrite rules.
		const pushRewrite = exec(
			["config", "--get-regexp", "^url\\..*\\.pushinsteadof$"],
			opts,
		);
		if (pushRewrite.ok || pushRewrite.status !== 1) return null;
	}
	const urls = exec(
		named
			? ["remote", "get-url", "--push", "--all", value]
			: ["ls-remote", "--get-url", value],
		opts,
	);
	if (!urls.ok) return null;
	// get-url is line-delimited. Use NUL-separated values for this remote to
	// check that one URL stays one line, including after Git's URL rewriting.
	let expectedUrls = 1;
	if (named) {
		let configured = exec(
			["config", "--null", "--get-all", `remote.${value}.pushurl`],
			opts,
		);
		if (configured.status === 1)
			configured = exec(
				["config", "--null", "--get-all", `remote.${value}.url`],
				opts,
			);
		if (!configured.ok) return null;
		const values = configured.out.split("\0").filter(Boolean);
		if (values.some((url) => url.includes("\n"))) return null;
		expectedUrls = values.length;
	}
	const resolvedUrls = urls.out.replace(/\n$/, "").split("\n");
	if (resolvedUrls.length !== expectedUrls) return null;
	const root = exec(["rev-parse", "--show-toplevel"], opts);
	const common = exec(
		["rev-parse", "--path-format=absolute", "--git-common-dir"],
		opts,
	);
	if (!root.ok || !common.ok) return null;
	const rootPath = root.out.replace(/\n$/, "");
	const commonPath = common.out.replace(/\n$/, "");
	if (rootPath.includes("\n") || commonPath.includes("\n")) return null;
	let sourceCommon;
	try {
		sourceCommon = realpathSync(commonPath);
	} catch {
		return null;
	}
	for (let url of resolvedUrls) {
		if (url.startsWith("file://")) {
			try {
				const parsed = new URL(url);
				if (parsed.hostname && parsed.hostname !== "localhost") return null;
				// Git's local transport does not apply WHATWG fragment removal,
				// whitespace trimming or dot-segment normalization. Inspect only
				// file URLs whose representation survives the standard parser intact.
				if (
					parsed.href !== url ||
					parsed.search ||
					parsed.hash ||
					url.includes("%")
				)
					return null;
				url = parsed.pathname;
			} catch {
				return null;
			}
		} else if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url)) continue;
		else if (
			!isAbsolute(url) &&
			url.includes(":") &&
			!url.slice(0, url.indexOf(":")).includes("/")
		)
			continue;
		if (/[$~*?`]/.test(url)) return null;
		// Local transport removes trailing slashes before opening a gitfile.
		const localUrl = url.replace(/\/+$/, "") || "/";
		const path = isAbsolute(localUrl) ? localUrl : `${rootPath}/${localUrl}`;
		// Git's local transport also searches .git spellings. Keep symlinks and
		// .. intact until Git and the filesystem have resolved each candidate.
		for (const candidate of [
			path,
			`${path}/.git`,
			`${path}.git`,
			`${path}.git/.git`,
		]) {
			if (!existsSync(candidate)) continue;
			const gitDir = exec(["rev-parse", "--resolve-git-dir", candidate], opts);
			if (!gitDir.ok) {
				if (gitDir.timedOut || gitDir.status === null) return null;
				continue;
			}
			const gitDirPath = gitDir.out.replace(/\n$/, "");
			if (gitDirPath.includes("\n")) return null;
			const target = exec(
				[
					"-C",
					gitDirPath,
					"rev-parse",
					"--path-format=absolute",
					"--git-common-dir",
				],
				opts,
			);
			if (!target.ok) {
				if (target.timedOut || target.status === null) return null;
				continue;
			}
			try {
				const targetPath = target.out.replace(/\n$/, "");
				if (targetPath.includes("\n")) return null;
				if (realpathSync(targetPath) === sourceCommon) return true;
			} catch {
				return null;
			}
		}
	}
	return false;
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
