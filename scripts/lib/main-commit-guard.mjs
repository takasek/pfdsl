// Blocks or asks about git commands that change the working tree or index when
// the target is main (#650, widened in #777) or another worktree in the same
// repository (#784). CLAUDE.md and the pfd-ops binding require each session to keep
// its work inside its own worktree so gate-check and review see one coherent
// change set.
//
// Commits were the whole of it until a worktree session's shell cwd reverted
// to the main checkout and staged two files there (#777). The commit itself
// was blocked, but the staged files stayed in an index every session shares,
// where the next commit made in the main checkout — by a human, too — picks
// them up. Stopping the commit alone leaves the route into that index open.
//
// currentBranch is passed in rather than read here, since a PreToolUse hook
// payload does not carry it — the hook wrapper resolves it once via `git
// branch --show-current`. Local push paths are inspected at the resolved cwd.
//
// A second, independent deny axis (#1232) catches commands that skip this
// repo's pre-commit checks — `--no-verify`/`-n` and a `core.hooksPath`
// override via `-c`, `--config-env`, or `git config` — regardless of branch
// or worktree. A commit that skipped the checks is the harm itself, with no
// later point at which this hook could still catch it, so it denies on
// every branch and worktree except a foreign target, which stays out of
// scope like every other rule here. Any mutating `git config` invocation
// scoped to `--global`/`--system`/`--file` is denied independently of the
// setting name: these settings may affect this repository too.

import { basename } from "node:path";
import {
	GIT_GLOBAL_FLAGS_WITH_VALUE,
	gitSubcommand,
	gitSubcommandIndex,
	parseLeadingShellPrefix,
	shellParseDecision,
} from "./delegation-guard.mjs";
import { resolvePhysicalPath } from "./file-operation-policy.mjs";
import { buildPermissionOutput, parseHookPayload } from "./hook-io.mjs";
import {
	classifyCodexGitRoutine,
	classifySharedGitEffect,
	evaluateSharedGitEffect,
	isConfigOverrideEffect,
	isReadOnlyGitConfig,
	sameBranchName,
} from "./shared-git-effects.mjs";
import { readShell } from "./shell-commands.mjs";

// The decision splits by target before it splits by subcommand. Against a
// sibling whose native ownership was not confirmed by the entrypoint it is
// ask (#1201, ADR-0046). A reported root alone cannot separate the session's
// worktree from another session's. Codex converts ask to deny.
// On the default branch the subcommand decides.
//
// Which subcommands land in which decision follows one rule (#777): deny the
// ones that create new state on the branch, because "do it in a worktree
// instead" is an equivalent substitute and fits in the deny message; ask for
// the ones that destroy or restore existing state, because the payload cannot
// tell an accidental `git reset` from the main-tree recovery CLAUDE.md
// prescribes, and denying those would block the repair as well as the damage.

/** git subcommands denied outright on the default branch. */
const DENIED_SUBCOMMANDS = new Set([
	"commit",
	"add",
	"rm",
	"mv",
	"apply",
	"am",
]);

/** git subcommands routed to the human on the default branch. */
const ASKED_SUBCOMMANDS = new Set([
	"reset",
	"restore",
	"checkout",
	"switch",
	"stash",
	"clean",
	"merge",
	"rebase",
	"cherry-pick",
	"revert",
]);

/**
 * `git stash` forms that only read. CLAUDE.md sends a session that lost an edit
 * to `git stash list` first, so the diagnosis must not need a prompt.
 */
const READ_ONLY_STASH_VERBS = new Set(["list", "show"]);

/**
 * `git apply` flags that report instead of writing. A deny cannot be overridden
 * by the human it prints to, so a subcommand's read-only forms have to stay
 * out of the denied set rather than rely on the prompt.
 */
const READ_ONLY_APPLY_FLAGS = new Set([
	"--check",
	"--stat",
	"--numstat",
	"--summary",
]);

// Bypass detection (#1232): see the file header for why this denies
// independently of branch and worktree. Inside classifySegment, this check
// runs first, ahead of the DENIED_SUBCOMMANDS/ASKED_SUBCOMMANDS lookup, and
// its result short-circuits the branch/worktree-scoped decision in
// evaluateGuardedCommand. That short-circuit has one exception — a foreign
// target is out of scope and allowed, same as every other rule here — and
// that exception has one exception of its own: a `git config` bypass that
// writes outside the target repo stays in scope and denies even against a
// foreign target (see evaluateGuardedCommand).

/** git subcommands that accept `--no-verify` (git 2.54; #1232). */
const NO_VERIFY_SUBCOMMANDS = new Set([
	"commit",
	"merge",
	"push",
	"rebase",
	"am",
	"pull",
]);

/** git subcommands whose `-n` means `--no-verify` rather than dry-run/no-stat. */
const SHORT_NO_VERIFY_SUBCOMMANDS = new Set(["commit", "am"]);

/**
 * Short-option characters that consume an argument for a given subcommand.
 * `mandatory` chars take the rest of the token, or the next token if the rest
 * is empty. `optional` chars take an argument only if attached, but either
 * way stop this token's char-by-char scan since the remaining characters
 * cannot be told apart from an attached argument.
 */
const SHORT_OPTION_ARG_CHARS = {
	commit: {
		mandatory: new Set(["m", "F", "c", "C", "t", "U"]),
		optional: new Set(["u", "S"]),
	},
	am: { mandatory: new Set(["C", "p"]), optional: new Set(["S"]) },
};

/**
 * `commit`'s long options that take a mandatory separate value (git 2.54;
 * exact names only, no abbreviation). Their value has to be skipped before
 * hasShortNoVerifyFlag scans for `-n`, or a value that happens to look like a
 * short option — `--message -n` — reads as one (#1232). Harmless for `am`:
 * none of these names are among its own options.
 */
const COMMIT_LONG_VALUE_OPTIONS = new Set([
	"--message",
	"--file",
	"--author",
	"--date",
	"--template",
	"--reuse-message",
	"--reedit-message",
	"--fixup",
	"--squash",
	"--trailer",
	"--cleanup",
	"--pathspec-from-file",
]);

/** Whether token value `value` is `--no-verify` or a unique abbreviation of it. */
function isNoVerifyToken(value) {
	return value.length >= "--no-veri".length && "--no-verify".startsWith(value);
}

/** Whether token value `value` is `--verify` or a unique abbreviation of it. */
function isVerifyToken(value) {
	return value.length >= "--veri".length && "--verify".startsWith(value);
}

/** Last-wins scan for `--no-verify`/abbreviation, cancelled by a later `--verify`/abbreviation. */
function hasNoVerifyLongFlag(tokens) {
	let bypass = false;
	for (const token of tokens) {
		if (isVerifyToken(token.value)) bypass = false;
		else if (isNoVerifyToken(token.value)) bypass = true;
	}
	return bypass;
}

/** Whether a `key` or `key=value` token names `core.hooksPath`, case-insensitively. */
function isHooksPathAssignment(raw) {
	if (typeof raw !== "string") return false;
	const equals = raw.indexOf("=");
	const key = equals === -1 ? raw : raw.slice(0, equals);
	return key.toLowerCase() === "core.hookspath";
}

/**
 * The `key=value` (or `key=ENV`) operands of every `-c` and
 * `--config-env[=]` in tokens `1..subAt`, a whole `git ...` segment's
 * global-option span ahead of its subcommand at `subAt`. The one walk over
 * Git's global options, so a value-taking flag's value is never read as an
 * option.
 */
function globalConfigAssignments(tokens, subAt) {
	const assignments = [];
	for (let i = 1; i < subAt; i++) {
		const value = tokens[i].value;
		if (value === "-c" || value === "--config-env") {
			assignments.push(tokens[i + 1]?.value ?? "");
			i++;
			continue;
		}
		if (value.startsWith("--config-env=")) {
			assignments.push(value.slice("--config-env=".length));
			continue;
		}
		if (GIT_GLOBAL_FLAGS_WITH_VALUE.has(value)) {
			i++;
		}
	}
	return assignments;
}

/** Whether a global `-c`/`--config-env` sets `core.hooksPath`, any value. */
function hasHooksPathGlobalOverride(tokens, subAt) {
	return globalConfigAssignments(tokens, subAt).some(isHooksPathAssignment);
}

/** Whether a `-n`/clustered short option means `--no-verify` for `sub`. */
function hasShortNoVerifyFlag(tokens, sub) {
	const table = SHORT_OPTION_ARG_CHARS[sub];
	if (!table) return false;
	for (let i = 0; i < tokens.length; i++) {
		const value = tokens[i].value;
		if (value === "--") break;
		if (COMMIT_LONG_VALUE_OPTIONS.has(value)) {
			i++; // its value is a separate token, not a short option to scan
			continue;
		}
		if (value.startsWith("--") || !value.startsWith("-") || value.length < 2)
			continue;
		const chars = value.slice(1);
		for (let j = 0; j < chars.length; j++) {
			const c = chars[j];
			if (c === "n") return true;
			if (table.mandatory.has(c)) {
				if (j === chars.length - 1) i++; // consumes the next token too
				break;
			}
			if (table.optional.has(c)) break;
		}
	}
	return false;
}

// `git config` no longer tracks flag positions to find the key by hand
// (#1232): four rounds running, a scheme built on recognizing known flags
// one at a time missed the flag it did not yet know — first --type's value
// read as the key, then abbreviated flags going unrecognized, then an
// abbreviated *attached* form (`--fil=<path>`) and a marker token consumed
// as a *different* flag's own value (`--comment --list core.hooksPath /x`,
// where --comment's value is the literal string "--list"), then a short
// prefix that resolves to a different option depending on which mode it is
// scoped to (`--g` is `--global` under `set`, since `set` has no `--get*`
// options to be ambiguous with, even though the same prefix is ambiguous
// against the full option vocabulary). This parses `git config`'s argv the
// way git's own parse-options does instead: a per-mode option table with
// arity, unique-prefix abbreviation resolution scoped to that mode's own
// table, and the same "stop recognizing options at the first positional"
// rule git itself uses for this command (verified against the installed
// git 2.54: `git config core.hooksPath --show-origin` sets the literal
// value `--show-origin`, and `git config core.hooksPath /x --local` never
// touches `--local` scope — both confirm nothing past the first positional
// is read as an option again, even inside `set`, e.g. `git config set
// core.hooksPath --type=path` sets the literal value `--type=path` too).
//
// Options this repo's hook never needs to distinguish (display/filter flags
// like --all, --regexp, -z, --show-origin, ...) are deliberately absent from
// the tables below: an unrecognized long option, or an unrecognized
// character in a short-option cluster, defaults to arity 0 (skip only
// itself), which is safe here because every option that affects whether
// core.hooksPath gets written, or where, is named below for every mode
// where it can appear — an unnamed one can only ever end up as an inert,
// skipped-over token, never mistaken for the key or its value.

/**
 * `git config` long-option arities this parser tracks, taken from `git
 * config -h` / `git config set -h` / `git config get -h` / `git config
 * unset -h` / `git config list -h` and the git-config(1) DEPRECATED MODES
 * table, on the installed git 2.54. Shared by every mode except `set`,
 * which has its own narrower table below — precise per-mode tables for the
 * remaining modes (`get`/`unset`/`list`/`edit`/`rename-section`/
 * `remove-section`) are not worth the added cost: none of them ever writes
 * a new value to core.hooksPath regardless of which further options
 * follow (see CONFIG_READ_ONLY_VERBS), so this shared table's precision
 * for *them* cannot change this classifier's answer either way.
 */
const CONFIG_OPTION_ARITY = new Map([
	// scope (boolean)
	["--global", 0],
	["--system", 0],
	["--local", 0],
	["--worktree", 0],
	// file location (value)
	["--file", 1],
	["--blob", 1],
	// misc value-taking
	["--type", 1],
	["--comment", 1],
	["--default", 1],
	["--value", 1],
	["--url", 1],
	// read/unset/list/edit/rename/remove actions (boolean)
	["--get", 0],
	["--get-all", 0],
	["--get-regexp", 0],
	["--get-urlmatch", 0],
	["--get-color", 0],
	["--get-colorbool", 0],
	["--unset", 0],
	["--unset-all", 0],
	["--rename-section", 0],
	["--remove-section", 0],
	["--list", 0],
	["--edit", 0],
	// write-modifier actions (boolean, still a write)
	["--add", 0],
	["--replace-all", 0],
]);
const CONFIG_OPTION_NAMES = [...CONFIG_OPTION_ARITY.keys()];

/**
 * `git config set`'s own option names (from `git config set -h`): no
 * `--get*`/`--unset*`/`--list`/`--edit`/`--rename-section`/
 * `--remove-section`/`--add`/`--default`/`--url` — `set` accepts none of
 * them. This is why `--g` resolves to `--global` under `set` (no `--get*`
 * to be ambiguous with there) and `--l` resolves to `--local` (no
 * `--list`), even though both prefixes are ambiguous against the full
 * table above.
 */
const CONFIG_SET_OPTION_NAMES = [
	"--global",
	"--system",
	"--local",
	"--worktree",
	"--file",
	"--blob",
	"--type",
	"--value",
	"--comment",
];

/** Long options that only read or unset — never write a new value. */
const CONFIG_READ_MARKER_NAMES = new Set([
	"--get",
	"--get-all",
	"--get-regexp",
	"--get-urlmatch",
	"--get-color",
	"--get-colorbool",
	"--unset",
	"--unset-all",
	"--rename-section",
	"--remove-section",
	"--list",
	"--edit",
]);

/** Long options that write outside whatever repository the command targets. `--local`/`--worktree` write inside it and are excluded. */
const CONFIG_OUTSIDE_TARGET_NAMES = new Set(["--global", "--system", "--file"]);

/** git-2.46+ `git config` verbs, recognized only as the very first token. */
const CONFIG_VERB_WORDS = new Set([
	"get",
	"set",
	"unset",
	"list",
	"edit",
	"rename-section",
	"remove-section",
]);
/** Verbs among those that never write a new value to core.hooksPath. */
const CONFIG_READ_ONLY_VERBS = new Set([
	"get",
	"unset",
	"list",
	"edit",
	"rename-section",
	"remove-section",
]);

/**
 * Resolves `namePart` (a `--`-long option name, no attached value) to the one
 * candidate it exactly matches or is a unique prefix of within `candidates`
 * — `git config set`'s own table (CONFIG_SET_OPTION_NAMES) when
 * `mode === "set"`, the shared table (CONFIG_OPTION_NAMES) otherwise —
 * mirroring git's own per-subcommand option-abbreviation resolution.
 * Returns null if it matches none; when it matches more than one,
 * deterministically returns the alphabetically first rather than trying to
 * reproduce git's ambiguity error. This still cannot disagree with git in a
 * way that matters: `candidates` is always a subset of what git itself
 * offers in that mode (trimmed only of options irrelevant to this
 * classifier), so a prefix ambiguous here is at least as ambiguous — and so
 * also rejected — against git's own full table for that mode (confirmed
 * against the installed git 2.54: `git config --unse core.hooksPath` exits
 * 129, "ambiguous option"; this parser does not need to agree with git on a
 * command git rejects).
 */
function resolveConfigOptionName(namePart, mode) {
	const candidates =
		mode === "set" ? CONFIG_SET_OPTION_NAMES : CONFIG_OPTION_NAMES;
	if (candidates.includes(namePart)) return namePart;
	const matches = candidates.filter((name) => name.startsWith(namePart));
	return matches.length === 0 ? null : matches.sort()[0];
}

/**
 * One `--`/`-x` token's role during `git config`'s option-scanning phase, in
 * `mode` ("set" or "legacy" — see resolveConfigOptionName): how many
 * further tokens it consumes as its own value (0 when attached via `=` or a
 * short option's suffix), whether it is a read/unset marker, and its
 * canonical outside-target name if it is a scope/file flag that writes
 * outside whatever repository the command targets (`-f` reports as
 * `--file`, so message wording can tell "certainly outside"
 * `--global`/`--system` apart from "maybe outside" `--file`/`-f`, which
 * this parser never inspects the path of).
 */
function resolveConfigOption(raw, mode) {
	if (raw.startsWith("--")) {
		const equals = raw.indexOf("=");
		const namePart = equals === -1 ? raw : raw.slice(0, equals);
		const name = resolveConfigOptionName(namePart, mode);
		if (!name)
			return {
				consumesNext: false,
				isReadMarker: false,
				outsideTargetName: null,
			};
		return {
			consumesNext: CONFIG_OPTION_ARITY.get(name) === 1 && equals === -1,
			isReadMarker: CONFIG_READ_MARKER_NAMES.has(name),
			outsideTargetName: CONFIG_OUTSIDE_TARGET_NAMES.has(name) ? name : null,
		};
	}
	// Short-option cluster: walk each character the way git's own
	// parse-options does. `f`/`t` take the rest of the token as their value
	// if any is attached, or otherwise the next token, and that stops the
	// scan of this token (there is nothing left to walk past a value); `l`/
	// `e` are read markers with no value, so the scan continues past them;
	// `z` and any other character default to arity 0 and are skipped.
	const chars = raw.slice(1);
	let isReadMarker = false;
	for (let j = 0; j < chars.length; j++) {
		const c = chars[j];
		if (c === "f" || c === "t") {
			return {
				consumesNext: j === chars.length - 1,
				isReadMarker,
				outsideTargetName: c === "f" ? "--file" : null,
			};
		}
		if (c === "l" || c === "e") isReadMarker = true;
	}
	return { consumesNext: false, isReadMarker, outsideTargetName: null };
}

/**
 * Parses `tokens` (the args to `git config`) the way git's own parse-options
 * does for this command: recognizes options left to right only until the
 * first non-option token (or a literal `--`), at which point option
 * scanning stops for good and every remaining token — dashes and all — is a
 * literal positional. `set`/`get`/`unset`/`list`/`edit`/`rename-section`/
 * `remove-section` are recognized as a leading verb only in that same
 * very-first-token position, and select which option table the rest of the
 * scan resolves abbreviations against.
 */
function parseConfigArgs(tokens) {
	let i = 0;
	let verb = null;
	if (tokens[0] && CONFIG_VERB_WORDS.has(tokens[0].value)) {
		verb = tokens[0].value;
		i = 1;
	}
	const mode = verb === "set" ? "set" : "legacy";
	let sawOutsideTarget = false;
	let outsideTargetFlag = null;
	let outsideTargetName = null;
	let sawReadMarker = false;
	while (i < tokens.length) {
		const raw = tokens[i].value;
		if (raw === "--") {
			i++;
			break;
		}
		if (raw === "-" || !raw.startsWith("-")) break;
		const {
			consumesNext,
			isReadMarker,
			outsideTargetName: matchedName,
		} = resolveConfigOption(raw, mode);
		if (isReadMarker) sawReadMarker = true;
		if (matchedName) {
			sawOutsideTarget = true;
			outsideTargetFlag ??= raw;
			outsideTargetName ??= matchedName;
		}
		i++;
		if (consumesNext) i++;
	}
	return {
		verb,
		sawOutsideTarget,
		outsideTargetFlag,
		outsideTargetName,
		sawReadMarker,
		positionals: tokens.slice(i),
	};
}

/**
 * Whether `tokens` (the args to `git config`) persistently set
 * `core.hooksPath` (#1232), and whether that write lands outside the target
 * repo — and, if so, the flag (as the command spelled it) and its canonical
 * name, for naming in the deny message. `set`/`--add`/`--replace-all` (or
 * bare legacy 2-positional form) all write the second positional as the new
 * value; a read-only verb or a read/unset marker anywhere in the
 * option-scanning phase means it never does, regardless of what follows.
 */
function classifyConfigWrite(tokens) {
	const parsed = parseConfigArgs(tokens);
	const outside = {
		outsideTarget: parsed.sawOutsideTarget,
		outsideTargetFlag: parsed.outsideTargetFlag,
		outsideTargetName: parsed.outsideTargetName,
	};
	if (parsed.verb && CONFIG_READ_ONLY_VERBS.has(parsed.verb))
		return { bypass: false, ...outside };
	if (parsed.sawReadMarker) return { bypass: false, ...outside };
	const key = parsed.positionals[0];
	const hasValue = parsed.positionals.length > 1;
	const isHooksPath = key?.value.toLowerCase() === "core.hookspath";
	return { bypass: Boolean(isHooksPath && hasValue), ...outside };
}

/**
 * The bypass form `tokens` (a whole `git ...` segment) uses, or null. Only
 * fires once a subcommand is present — an override with no subcommand behind
 * it runs nothing a hook would ever see. `-c core.hooksPath`/`--config-env`
 * apply to any subcommand, not just a mutating one.
 */
function classifyBypass(tokens) {
	const subAt = gitSubcommandIndex(tokens);
	if (subAt === null) return null;
	const sub = tokens[subAt].value;
	if (hasHooksPathGlobalOverride(tokens, subAt))
		return { subcommand: sub, flag: "core.hooksPath" };
	const rest = tokens.slice(subAt + 1);
	if (NO_VERIFY_SUBCOMMANDS.has(sub) && hasNoVerifyLongFlag(rest))
		return { subcommand: sub, flag: "--no-verify" };
	if (SHORT_NO_VERIFY_SUBCOMMANDS.has(sub) && hasShortNoVerifyFlag(rest, sub))
		return { subcommand: sub, flag: "-n" };
	if (sub === "config") {
		const { bypass, outsideTarget, outsideTargetFlag, outsideTargetName } =
			classifyConfigWrite(rest);
		if (bypass)
			return {
				subcommand: sub,
				flag: "core.hooksPath",
				outsideTarget,
				outsideTargetFlag,
				outsideTargetName,
			};
	}
	return null;
}

/**
 * Whether the global options ahead of the subcommand at `subAt` carry a
 * command-line config override (`-c`, `--config-env`), whatever its key:
 * `include.path` can load arbitrary settings.
 */
function hasGlobalConfigOverride(tokens, subAt) {
	return globalConfigAssignments(tokens, subAt).length > 0;
}

/** @typedef {{subcommand: string, decision: "deny" | "ask", bypass?: boolean, flag?: string, outsideTarget?: boolean, outsideTargetFlag?: string, outsideTargetName?: string, effect?: {kind: string, ref?: string, refs?: string[], names?: string[], unresolved?: boolean}, configOverride?: boolean}} GuardedGit */

/**
 * The guarded git subcommand one already-tokenized segment runs, or null.
 * A config override (`-c`, `--config-env`, or `configOverride` for a visible
 * `GIT_CONFIG_*` assignment before the command) on anything but a read marks
 * the result `configOverride`, which evaluation turns into a shared effect.
 * @param {{value: string, quoted: boolean}[]} tokens
 * @returns {GuardedGit | null}
 */
function classifySegment(tokens, { configOverride = false, cwd } = {}) {
	const found = classifyGuardedSegment(tokens, { cwd });
	if (found?.bypass) return found;
	if (tokens.length === 0 || basename(tokens[0].value) !== "git") return found;
	const sub = gitSubcommand(tokens);
	const subAt = gitSubcommandIndex(tokens);
	if (!sub || subAt === null) return found;
	if (!configOverride && !hasGlobalConfigOverride(tokens, subAt)) return found;
	const args = tokens.slice(subAt + 1).map((token) => token.value);
	if (!isConfigOverrideEffect(sub, args)) return found;
	return found
		? { ...found, configOverride: true }
		: { subcommand: sub, decision: "ask", configOverride: true };
}

function classifyGuardedSegment(tokens, { cwd } = {}) {
	if (tokens.length === 0) return null;
	const head = tokens[0];
	if (basename(head.value) !== "git") {
		const subcommand = classifyCodexGitRoutine(
			tokens.map((token) => token.value),
		)?.gitSubcommand;
		return subcommand ? { subcommand, decision: "deny" } : null;
	}

	const bypass = classifyBypass(tokens);
	if (bypass) {
		const args = tokens.slice(gitSubcommandIndex(tokens) + 1);
		const scope =
			bypass.subcommand === "config" &&
			!isReadOnlyGitConfig(args.map((token) => token.value))
				? classifyConfigWrite(args)
				: bypass;
		return {
			subcommand: bypass.subcommand,
			decision: "deny",
			bypass: true,
			flag: bypass.flag,
			outsideTarget: scope.outsideTarget === true,
			outsideTargetFlag: scope.outsideTargetFlag,
			outsideTargetName: scope.outsideTargetName,
		};
	}

	const sub = gitSubcommand(tokens);
	if (!sub) return null;
	const argTokens = tokens.slice(gitSubcommandIndex(tokens) + 1);
	const effect = classifySharedGitEffect(
		sub,
		argTokens.map((token) => token.value),
		{ cwd, argTokens },
	);
	if (effect) {
		const guarded = { subcommand: sub, decision: "ask", effect };
		if (sub !== "config") return guarded;
		const { outsideTarget, outsideTargetFlag, outsideTargetName } =
			classifyConfigWrite(tokens.slice(gitSubcommandIndex(tokens) + 1));
		return outsideTarget
			? {
					...guarded,
					decision: "deny",
					outsideTarget,
					outsideTargetFlag,
					outsideTargetName,
				}
			: guarded;
	}
	if (DENIED_SUBCOMMANDS.has(sub)) {
		if (
			sub === "apply" &&
			tokens.some((t) => READ_ONLY_APPLY_FLAGS.has(t.value))
		)
			return null;
		return { subcommand: sub, decision: "deny" };
	}
	if (!ASKED_SUBCOMMANDS.has(sub)) return null;
	// The verb sits to `stash` exactly as a subcommand sits to `git`, so the
	// same reader finds it — including its refusal to read a quoted token,
	// which leaves `git stash "list"` classified as the bare push it may be.
	if (sub === "stash") {
		const at = tokens.findIndex((t) => t.value === "stash");
		if (READ_ONLY_STASH_VERBS.has(gitSubcommand(tokens.slice(at)) ?? ""))
			return null;
	}
	return { subcommand: sub, decision: "ask" };
}

/**
 * The guarded git subcommand `command` runs, or null if it runs none.
 *
 * A compound line is classified by its strictest match: `git checkout x && git
 * add y` is a deny, since letting the ask through would put the add on the
 * default branch behind a prompt that names the checkout.
 * @param {string} command
 * @returns {GuardedGit | null}
 */
export function classifyGitCommand(command, hookCwd = process.cwd()) {
	if (typeof command !== "string" || command.trim() === "") return null;
	const failure = shellParseDecision(command);
	if (failure) return { ...failure, subcommand: "shell syntax" };

	/** @type {GuardedGit | null} */
	let asked = null;
	for (const { cwd: _cwd, ...found } of analyzeCommand(command, hookCwd)
		.targets) {
		if (found?.decision === "deny") return found;
		if (found) asked ??= found;
	}
	return asked;
}

/** A path this layer can resolve without running a shell. */
function staticPath(token) {
	if (!token) return null;
	return token.dynamic ? null : token.value;
}

function physicalCwd(target, cwd) {
	try {
		return resolvePhysicalPath(target, cwd);
	} catch {
		return null;
	}
}

/** Resolve every pre-subcommand `git -C` in the order Git applies them. */
function resolveGitCwd(tokens, shellCwd) {
	const subcommandAt = gitSubcommandIndex(tokens);
	if (subcommandAt === null) return shellCwd;

	let cwd = shellCwd;
	for (let i = 1; i < subcommandAt; i++) {
		const token = tokens[i];
		if (
			token.value === "--git-dir" ||
			token.value === "--work-tree" ||
			token.value.startsWith("--git-dir=") ||
			token.value.startsWith("--work-tree=")
		)
			return null;
		if (token.value !== "-C" && !token.value.startsWith("-C")) {
			if (GIT_GLOBAL_FLAGS_WITH_VALUE.has(token.value)) i++;
			continue;
		}
		const target =
			token.value === "-C"
				? staticPath(tokens[++i])
				: staticPath({ ...token, value: token.value.slice(2) });
		if (target === null) cwd = null;
		else if (target === "") continue;
		else if (target.startsWith("/") || cwd !== null)
			cwd = physicalCwd(target, cwd);
	}
	return cwd;
}

function resolveEnvCwd(tokens, shellCwd) {
	let cwd = shellCwd;
	const prefix = parseLeadingShellPrefix(tokens);
	if (prefix.unresolved || prefix.gitTargetOverride) return null;
	for (const env of prefix.envs) {
		if (env.chdir !== undefined) {
			const target = staticPath(env.chdir);
			if (target === null) cwd = null;
			else if (target.startsWith("/") || cwd !== null)
				cwd = physicalCwd(target, cwd);
		}
	}
	return cwd;
}

function resolveCodexRoutineCwd(tokens) {
	const routine = classifyCodexGitRoutine(tokens.map((token) => token.value));
	const target = routine ? staticPath(tokens[routine.targetAt]) : null;
	return target === null ? null : physicalCwd(target);
}

function guardedSuffix(tokens, options) {
	for (let i = 0; i < tokens.length; i++) {
		const guarded = classifySegment(tokens.slice(i), options);
		if (guarded) return guarded;
	}
	return null;
}

// Do not emulate shell state. A cwd-changing command anywhere in the input
// makes implicit/relative targets unknown; environment setters make all Git
// mutation targets unknown. Absolute per-command targets can recover only cwd.
function analyzeCommand(
	command,
	hookCwd,
	{ ambientGitTargetOverride = false } = {},
) {
	const shell = readShell(command);
	if (shell.error)
		return {
			targets: [
				{
					decision: "deny",
					subcommand: "shell syntax",
					reason: shell.error,
					cwd: null,
				},
			],
			finalCwd: null,
		};
	const commands = shell.commands.map(({ tokens }) => {
		const prefix = parseLeadingShellPrefix(tokens);
		const argv = tokens.slice(prefix.end);
		const stateTokens =
			argv[0]?.value === "builtin"
				? argv.slice(argv[1]?.value === "--" ? 2 : 1)
				: argv;
		return { raw: tokens, prefix, tokens: argv, stateTokens };
	});
	const changesCwd = commands.some(({ stateTokens }) =>
		["cd", "pushd", "popd"].includes(stateTokens[0]?.value),
	);
	const changesEnvironment = commands.some(({ raw, stateTokens: tokens }) => {
		const head = tokens[0]?.value;
		const setter = [
			"export",
			"readonly",
			"typeset",
			"declare",
			"local",
			"unset",
		].includes(head);
		const protectedOperand = tokens.some(
			({ value, dynamic }) =>
				dynamic ||
				/^(?:GIT_[A-Za-z0-9_]*|CDPATH)(?:\+?=|$)/.test(value) ||
				/^[+-][^+-]*n/.test(value),
		);
		return (
			(setter && protectedOperand) ||
			["read", "source", ".", "eval"].includes(head) ||
			(head === "printf" &&
				tokens.some(({ value }) => value.startsWith("-v"))) ||
			(raw.length > 0 &&
				raw.every(({ value }) => /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(value)) &&
				raw.some(({ value }) =>
					/^(?:GIT_[A-Za-z0-9_]*|CDPATH)\+?=/.test(value),
				))
		);
	});
	const targets = [];
	for (const { raw, prefix, tokens } of commands) {
		const configOverride = prefix.gitConfigOverride || changesEnvironment;
		const baseCwd = changesCwd ? null : hookCwd;
		const envCwd = resolveEnvCwd(raw, baseCwd);
		const cwd =
			ambientGitTargetOverride ||
			changesEnvironment ||
			prefix.unresolved ||
			prefix.gitTargetOverride
				? null
				: basename(tokens[0]?.value ?? "") === "git"
					? resolveGitCwd(tokens, envCwd)
					: resolveCodexRoutineCwd(tokens);
		const guarded =
			classifySegment(tokens, { configOverride, cwd }) ??
			(prefix.unresolved
				? guardedSuffix(tokens, { configOverride, cwd: null })
				: null);
		if (guarded) targets.push({ ...guarded, cwd });
	}
	return {
		targets,
		finalCwd: changesCwd || changesEnvironment ? null : hookCwd,
	};
}

/** Every guarded Git segment with the cwd in which Git will run it. */
export function resolveGuardedGitCommands(command, hookCwd, options) {
	return analyzeCommand(command, hookCwd, options).targets;
}

/**
 * The directory the first guarded Git command runs in, retained for callers
 * that inspect one command. The hook itself evaluates every resolved target.
 */
export function resolveCommandCwd(command, hookCwd, options) {
	const analysis = analyzeCommand(command, hookCwd, options);
	return analysis.targets.length ? analysis.targets[0].cwd : analysis.finalCwd;
}

/**
 * How a command's target checkout relates to the session's own one.
 *
 * Four states, not two: a boolean collapsed "the session's own worktree" and
 * "a repository this guard has no business in" onto the same `false`, which
 * left an unrelated repo's `main` — the default branch `git init` hands every
 * throwaway sandbox — guarded on the strength of the branch name alone (#1221).
 * `unknown` stays separate from `foreign` because failing to resolve a root is
 * not evidence of being out of scope. The case it actually protects is a
 * session whose own root will not resolve — no `CLAUDE_PROJECT_DIR` and no
 * payload cwd — against a target that resolves fine and reports the default
 * branch: mapping that to a pass-through would hand such a session an
 * unguarded main checkout. It is not the git-is-broken case, where the target
 * has no readable branch either and `currentBranch === undefined` already
 * allows further down.
 * @param {{worktreeRoot: string, commonDir: string} | null} sessionRoots
 * @param {{worktreeRoot: string, commonDir: string} | null} targetRoots
 * @returns {"own" | "sibling" | "foreign" | "unknown"}
 */
export function classifyTargetRepository(sessionRoots, targetRoots) {
	if (!sessionRoots || !targetRoots) return "unknown";
	if (sessionRoots.commonDir !== targetRoots.commonDir) return "foreign";
	return sessionRoots.worktreeRoot === targetRoots.worktreeRoot
		? "own"
		: "sibling";
}

/**
 * Decide whether a PreToolUse Bash invocation may proceed.
 * @param {object} payload PreToolUse hook payload
 * @param {{currentBranch: string | undefined, mainBranch?: string, targetRelation?: "own" | "sibling" | "foreign" | "unknown"}} context
 * @returns {{decision: "allow"} | {decision: "deny" | "ask", reason: string}}
 */
export function evaluateMainCommitGuard(
	payload,
	{
		currentBranch,
		mainBranch = "main",
		targetRelation = "own",
		supportsAsk = true,
	} = {},
) {
	if (payload?.tool_name !== "Bash") return { decision: "allow" };
	const failure = shellParseDecision(payload?.tool_input?.command, {
		supportsAsk,
	});
	if (failure) return failure;
	const guarded = classifyGitCommand(
		payload?.tool_input?.command,
		payload?.cwd ?? process.cwd(),
	);
	if (!guarded) return { decision: "allow" };
	return evaluateGuardedCommand(guarded, {
		currentBranch,
		mainBranch,
		targetRelation,
	});
}

// A config override on a non-read call is a shared effect, but it must not
// soften what the call is already guarded for (a deny on the default branch),
// so it only replaces an allow.
function evaluateGuardedCommand(guarded, context = {}) {
	const result = evaluateGuardedCore(guarded, context);
	if (
		!guarded.configOverride ||
		result.decision !== "allow" ||
		context.targetRelation === "foreign"
	)
		return result;
	return evaluateSharedGitEffect(
		{ kind: "shared" },
		context.mainBranch ?? "main",
	);
}

function evaluateGuardedCore(
	guarded,
	{ currentBranch, mainBranch = "main", targetRelation = "own" } = {},
) {
	if (
		guarded.outsideTarget &&
		(!guarded.bypass || targetRelation === "foreign")
	) {
		const certainty =
			guarded.outsideTargetName === "--file"
				? "may write Git configuration outside the target repo (this parser does not check where the path points)"
				: "writes Git configuration outside the target repo";
		return {
			decision: "deny",
			reason:
				`Blocked 'git ${guarded.subcommand}' for using '${guarded.outsideTargetFlag}': this ${certainty}, where it can affect this repo's (or another repo's) git hooks. ` +
				(targetRelation === "foreign"
					? "Write to the target's own local config instead (drop the scope/file flag, or use --local/--worktree). "
					: "") +
				"If writing outside the target is genuinely needed, run the command in your own terminal instead.",
		};
	}
	// Out of scope entirely: this guard speaks for one repository's ecosystem,
	// and another repository's branch names carry none of its meaning (#1221).
	// Outside-target config writes were handled before this exemption (#1232).
	if (targetRelation === "foreign") return { decision: "allow" };

	// See the file header for why a bypass denies independently of branch and
	// worktree. This still sits after the foreign check above, which stays in
	// scope for a bypass that writes outside the target (immediately above).
	if (guarded.bypass) {
		// Own-target hooksPath writes still deny without the scope flag, so
		// their recovery message must ask to remove the bypass itself.
		const hookName =
			guarded.subcommand === "commit" ? "pre-commit" : "git hooks";
		return {
			decision: "deny",
			reason:
				`Blocked 'git ${guarded.subcommand}' for using '${guarded.flag}': this skips ${hookName}, which is where this repo's checks run. ` +
				"Re-run the command without it. If a hook itself is broken, fix it in the working tree — the shim execs " +
				"the working tree's scripts/pre-commit — and a normal run will pick up the fix. If a bypass is genuinely " +
				"needed (e.g. to debug a hook), run the command in your own terminal instead.",
		};
	}
	if (guarded.effect) {
		const effectResult = evaluateSharedGitEffect(
			guarded.effect,
			mainBranch,
			currentBranch,
			targetRelation,
		);
		if (
			effectResult.decision !== "allow" ||
			!["enter-branch", "create-branch"].includes(guarded.effect.kind)
		)
			return effectResult;
	}
	if (guarded.subcommand === "stash")
		return evaluateSharedGitEffect({ kind: "shared" }, mainBranch);

	// `unknown` rides with `own`, which is where it already sat before the
	// relation had a name — the branch-name rule still applies, and reaching a
	// deny through it requires the target's branch to be readable.
	const crossesWorktree = targetRelation === "sibling";
	const targetsDefaultBranch = sameBranchName(currentBranch, mainBranch);
	if (!targetsDefaultBranch && !crossesWorktree) return { decision: "allow" };

	const command = `git ${guarded.subcommand}`;
	// A cross-worktree target is asked about rather than denied, whatever the
	// subcommand when the entrypoint cannot confirm native ownership. The
	// harness may keep reporting the initial root after entering a worktree
	// (#1201); cwd alone does not establish ownership. Claude can ask the human
	// to check. Codex, where ask is unsupported, still falls closed to deny in
	// runMainCommitGuard.
	if (
		guarded.decision === "deny" &&
		!(crossesWorktree && !targetsDefaultBranch)
	) {
		return {
			decision: "deny",
			reason:
				`Blocked '${command}' on '${mainBranch}': this repo's ecosystem requires develop → PR → merge_pr, ` +
				"and the main checkout's index is shared by processes and sessions targeting that checkout, so anything staged here rides along on " +
				"the next commit made there. Create or switch to a feature branch first (e.g. via the worktree " +
				"skill), then run it there.",
		};
	}
	return {
		decision: "ask",
		reason:
			crossesWorktree && !targetsDefaultBranch
				? `'${command}' targets a worktree other than the one this session reports as its root, and the hook could not confirm this session as its native owner. This can discard another session's uncommitted edits. Confirm ownership before proceeding; working in that directory alone does not establish ownership.`
				: `'${command}' on '${mainBranch}' would change the main checkout's working tree, which every session ` +
					"shares — it can discard another session's uncommitted edits. It is also how CLAUDE.md says to repair " +
					"a tree that was written to by mistake, and this hook cannot tell the two apart. Confirm only if this " +
					"is the repair.",
	};
}

function evaluateUnresolvedCwd(guarded) {
	const command = `git ${guarded.subcommand}`;
	// Naming the bypass flag too means a single retry — dropping both the
	// unresolvable path and the flag — fixes the command instead of only
	// fixing the cwd and leaving the bypass to be caught (and retried again)
	// on the next attempt (#1232).
	const bypassNote = guarded.bypass
		? ` It also uses '${guarded.flag}', which skips this repo's git hooks — drop that too.`
		: "";
	return {
		decision: "ask",
		reason:
			`Cannot determine the target of '${command}' without interpreting shell state or expansion. Review the whole command before approving. ` +
			`Use git -C with an absolute literal path, or run Git in a separate invocation with harness workdir. Run Git separately from shell environment setters.${bypassNote}`,
	};
}

/**
 * Orchestrates the hook's stdin payload into a print-or-not decision, the way
 * runDelegationGuard does (#645).
 *
 * `resolveBranches` is injected and called only once the command is known to be
 * a guarded one. That is what keeps the `git` subprocess off every other Bash
 * call without duplicating the eligibility rule in the wrapper — the earlier
 * version repeated the tool_name/classify check there and carried a comment
 * asking the next reader to keep the two copies in sync by hand.
 * @param {string} inputText raw stdin payload
 * @param {{resolveBranches: (payload: object, targetCwd: string) => {currentBranch?: string, mainBranch?: string, targetRelation?: "own" | "sibling" | "foreign" | "unknown"}}} io
 * @returns {{shouldOutput: boolean, output?: object}}
 */
export function runMainCommitGuard(
	inputText,
	{ resolveBranches, supportsAsk = true, ambientGitTargetOverride = false },
) {
	const payload = parseHookPayload(inputText);
	if (!payload) return { shouldOutput: false };
	if (payload?.tool_name !== "Bash") return { shouldOutput: false };
	const failure = shellParseDecision(payload?.tool_input?.command, {
		supportsAsk,
	});
	if (failure)
		return { shouldOutput: true, output: buildPermissionOutput(failure) };
	const payloadCwd = payload?.cwd;
	const hookCwd =
		typeof payloadCwd === "string" && payloadCwd.trim() !== ""
			? payloadCwd
			: process.cwd();
	const targets = resolveGuardedGitCommands(
		payload?.tool_input?.command,
		hookCwd,
		{ ambientGitTargetOverride },
	);
	if (targets.length === 0) return { shouldOutput: false };
	const unresolved = targets.find((target) => target.cwd === null);
	if (unresolved)
		return {
			shouldOutput: true,
			output: buildPermissionOutput({
				...evaluateUnresolvedCwd(unresolved),
				decision: supportsAsk ? "ask" : "deny",
			}),
		};

	let asked = null;
	for (const target of targets) {
		const result = evaluateGuardedCommand(
			target,
			resolveBranches(payload, target.cwd),
		);
		if (result.decision === "deny") {
			return { shouldOutput: true, output: buildPermissionOutput(result) };
		}
		if (result.decision === "ask") {
			asked ??= supportsAsk
				? result
				: {
						decision: "deny",
						reason: `${result.reason} Codex PreToolUse's ask decision is unsupported, so this command is denied instead of failing open.`,
					};
		}
	}
	return asked === null
		? { shouldOutput: false }
		: { shouldOutput: true, output: buildPermissionOutput(asked) };
}
