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
// branch --show-current` and this stays a pure function.
//
// A second, independent deny axis (#1232) catches commands that skip this
// repo's pre-commit checks — `--no-verify`/`-n` and a `core.hooksPath`
// override via `-c`, `--config-env`, or `git config` — regardless of branch
// or worktree. A commit that skipped the checks is the harm itself, with no
// later point at which this hook could still catch it, so it denies on
// every branch and worktree except a foreign target, which stays out of
// scope like every other rule here — unless the `git config` write itself
// lands outside the target repo (`--global`/`--system`/`--file`), which a
// foreign target does not excuse either.

import { basename, resolve } from "node:path";
import {
	createProtectedShellState,
	GIT_GLOBAL_FLAGS_WITH_VALUE,
	gitSubcommand,
	gitSubcommandIndex,
	hasProtectedCdPathOverride,
	hasProtectedGitTargetOverride,
	parseLeadingShellPrefix,
	splitCommandFlow,
	splitSegments,
	stripLeadingNoise,
	tokenize,
	updateProtectedShellState,
} from "./delegation-guard.mjs";
import { buildPermissionOutput, parseHookPayload } from "./hook-io.mjs";
import {
	classifyCodexGitRoutine,
	classifySharedGitEffect,
	evaluateSharedGitEffect,
} from "./shared-git-effects.mjs";

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
 * Whether tokens `1..subAt` (a whole `git ...` segment's global-option span,
 * ahead of its subcommand at `subAt`) carry a `-c core.hooksPath=<v>` or
 * `--config-env[=]core.hooksPath=<env>` override, any value.
 */
function hasHooksPathGlobalOverride(tokens, subAt) {
	for (let i = 1; i < subAt; i++) {
		const value = tokens[i].value;
		if (value === "-c" || value === "--config-env") {
			if (isHooksPathAssignment(tokens[i + 1]?.value)) return true;
			i++;
			continue;
		}
		if (value.startsWith("--config-env=")) {
			if (isHooksPathAssignment(value.slice("--config-env=".length)))
				return true;
			continue;
		}
		if (GIT_GLOBAL_FLAGS_WITH_VALUE.has(value)) {
			i++;
		}
	}
	return false;
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
 * The guarded git subcommand one already-tokenized segment runs, or null.
 * @param {{value: string, quoted: boolean}[]} tokens
 * @returns {{subcommand: string, decision: "deny" | "ask", bypass?: boolean, flag?: string, outsideTarget?: boolean, outsideTargetFlag?: string, outsideTargetName?: string} | null}
 */
function classifySegment(tokens) {
	if (tokens.length === 0) return null;
	const head = tokens[0];
	if (basename(head.value) !== "git") {
		const subcommand = classifyCodexGitRoutine(
			tokens.map((token) => token.value),
		)?.gitSubcommand;
		return subcommand ? { subcommand, decision: "deny" } : null;
	}

	const bypass = classifyBypass(tokens);
	if (bypass)
		return {
			subcommand: bypass.subcommand,
			decision: "deny",
			bypass: true,
			flag: bypass.flag,
			outsideTarget: bypass.outsideTarget === true,
			outsideTargetFlag: bypass.outsideTargetFlag,
			outsideTargetName: bypass.outsideTargetName,
		};

	const sub = gitSubcommand(tokens);
	if (!sub) return null;
	const effect = classifySharedGitEffect(
		sub,
		tokens.slice(gitSubcommandIndex(tokens) + 1).map((token) => token.value),
	);
	if (effect) return { subcommand: sub, decision: "ask", effect };
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
 * @returns {{subcommand: string, decision: "deny" | "ask", bypass?: boolean, flag?: string, outsideTarget?: boolean, outsideTargetFlag?: string, outsideTargetName?: string} | null}
 */
export function classifyGitCommand(command) {
	if (typeof command !== "string" || command.trim() === "") return null;

	/** @type {{subcommand: string, decision: "deny" | "ask", bypass?: boolean, flag?: string, outsideTarget?: boolean, outsideTargetFlag?: string, outsideTargetName?: string} | null} */
	let asked = null;
	for (const segment of splitSegments(command)) {
		const found = classifySegment(stripLeadingNoise(tokenize(segment)));
		if (found?.decision === "deny") return found;
		if (found) asked ??= found;
	}
	return asked;
}

/** A path this layer can resolve without running a shell. */
function staticPath(token) {
	if (!token) return null;
	if (token.quoted)
		return token.quote === "'" || !/[$`]/.test(token.value)
			? token.value
			: null;
	return /[$~*?`]/.test(token.value) ? null : token.value;
}

/** A literal target from the supported `cd` forms, or null when it is dynamic. */
function cdPath(tokens) {
	let targetAt = 1;
	if (!tokens[targetAt]?.quoted && tokens[targetAt]?.value === "--") targetAt++;
	const target = staticPath(tokens[targetAt]);
	if (target === null) return null;
	return tokens
		.slice(targetAt + 1)
		.every((token) => !token.quoted && /^(?:[0-9]*>>?|&>>?)/.test(token.value))
		? target
		: null;
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
		if (token.value !== "-C") continue;
		const target = staticPath(tokens[i + 1]);
		if (target === null) cwd = null;
		else if (target.startsWith("/")) cwd = resolve(target);
		else if (cwd !== null) cwd = resolve(cwd, target);
		i++;
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
			else if (target.startsWith("/")) cwd = resolve(target);
			else if (cwd !== null) cwd = resolve(cwd, target);
		}
	}
	return cwd;
}

function resolveCodexRoutineCwd(tokens) {
	const routine = classifyCodexGitRoutine(tokens.map((token) => token.value));
	const target = routine ? staticPath(tokens[routine.targetAt]) : null;
	return target === null ? null : resolve(target);
}

function guardedSuffix(tokens) {
	for (let i = 0; i < tokens.length; i++) {
		const guarded = classifySegment(tokens.slice(i));
		if (guarded) return guarded;
	}
	return null;
}

const COMPOUND_TOKENS = new Set([
	"{",
	"}",
	"if",
	"then",
	"elif",
	"else",
	"fi",
	"for",
	"while",
	"until",
	"case",
	"esac",
	"do",
	"done",
	"select",
	"function",
	"coproc",
	"!",
]);

/**
 * Track the shell cwd and retain each guarded Git segment with its own target.
 * A PreToolUse hook fires before the shell does, so `payload.cwd` does not yet
 * reflect `cd` or `git -C` inside the command (#751). Keeping every target is
 * also necessary because one Bash invocation can move between worktrees
 * before running another guarded Git command (#784).
 */
function analyzeCommand(
	command,
	hookCwd,
	{ ambientCdPath = false, ambientGitTargetOverride = false } = {},
) {
	if (typeof command !== "string") return { targets: [], finalCwd: hookCwd };

	/** Where the shell stands, or null once a `cd` moved it somewhere unknown. */
	let cwd = hookCwd;
	const protectedState = createProtectedShellState({
		ambientCdPath,
		ambientGitTargetOverride,
	});
	let unresolvedControlFlow = false;
	let andListAffects = false;
	let previousAffects = false;
	const targets = [];

	for (const { command: segment, separatorBefore } of splitCommandFlow(
		command,
	)) {
		if (separatorBefore === "&&") andListAffects ||= previousAffects;
		else if (separatorBefore === ";" || separatorBefore === "\n") {
			unresolvedControlFlow ||= andListAffects;
			andListAffects = false;
		} else if (["(", ")"].includes(separatorBefore)) {
			unresolvedControlFlow = true;
			andListAffects = false;
		} else if (["||", "|", "&"].includes(separatorBefore)) {
			unresolvedControlFlow ||= previousAffects;
			andListAffects = false;
		}
		const rawTokens = tokenize(segment);
		const prefix = parseLeadingShellPrefix(rawTokens);
		const envCwd = resolveEnvCwd(rawTokens, cwd);
		const tokens = rawTokens.slice(prefix.end);
		const finish = (cwdAffects = false) => {
			const affects =
				cwdAffects || updateProtectedShellState(protectedState, rawTokens);
			if (separatorBefore === "&&") andListAffects ||= affects;
			if (["||", "|", "&"].includes(separatorBefore))
				unresolvedControlFlow ||= affects;
			previousAffects = affects;
		};
		if (tokens.length === 0) {
			finish();
			continue;
		}
		const head = basename(tokens[0].value);
		if (COMPOUND_TOKENS.has(head)) unresolvedControlFlow = true;

		if (
			(head === "builtin" &&
				["cd", "pushd", "popd"].includes(tokens[1]?.value)) ||
			head === "pushd" ||
			head === "popd"
		) {
			cwd = null;
			finish(true);
			continue;
		}

		if (head === "cd") {
			const target = cdPath(tokens);
			if (target === null) cwd = null;
			// An absolute target restores a trail lost to an unresolvable earlier cd.
			else if (target.startsWith("/")) cwd = resolve(target);
			else if (
				hasProtectedCdPathOverride(protectedState) ||
				prefix.cdPathOverride
			)
				cwd = null;
			else if (cwd !== null) cwd = resolve(cwd, target);
			finish(true);
			continue;
		}

		const guarded =
			classifySegment(tokens) ??
			(prefix.unresolved ? guardedSuffix(tokens) : null);
		if (!guarded) {
			finish();
			continue;
		}
		targets.push({
			...guarded,
			cwd:
				unresolvedControlFlow ||
				prefix.unresolved ||
				hasProtectedGitTargetOverride(protectedState) ||
				prefix.gitTargetOverride
					? null
					: head === "git"
						? resolveGitCwd(tokens, envCwd)
						: resolveCodexRoutineCwd(tokens),
		});
		finish();
	}
	return { targets, finalCwd: cwd };
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
	return analysis.targets[0]?.cwd ?? analysis.finalCwd;
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
	{ currentBranch, mainBranch = "main", targetRelation = "own" } = {},
) {
	if (payload?.tool_name !== "Bash") return { decision: "allow" };
	const guarded = classifyGitCommand(payload?.tool_input?.command);
	if (!guarded) return { decision: "allow" };
	return evaluateGuardedCommand(guarded, {
		currentBranch,
		mainBranch,
		targetRelation,
	});
}

function evaluateGuardedCommand(
	guarded,
	{ currentBranch, mainBranch = "main", targetRelation = "own" } = {},
) {
	// Out of scope entirely: this guard speaks for one repository's ecosystem,
	// and another repository's branch names carry none of its meaning (#1221).
	// A `git config` bypass that writes outside the target repo is the one
	// exception (#1232): `--global`/`--system`/`--file` land in a config this
	// repo's checks (or another repo's) still read, so foreign does not buy it
	// the pass-through this rule otherwise grants.
	if (
		targetRelation === "foreign" &&
		!(guarded.bypass && guarded.outsideTarget)
	)
		return { decision: "allow" };

	// See the file header for why a bypass denies independently of branch and
	// worktree. This still sits after the foreign check above, which stays in
	// scope for a bypass that writes outside the target (immediately above).
	if (guarded.bypass) {
		// The outside-target wording is only correct against a foreign target:
		// there, "drop the scope/file flag" is the complete fix (the plain
		// command is allowed against a foreign target, per the check above).
		// Against own/sibling/unknown, the plain command still skips hooks and
		// still denies, so that advice would lead to a second deny instead of
		// fixing anything — the general message below applies there instead.
		if (guarded.outsideTarget && targetRelation === "foreign") {
			const certainty =
				guarded.outsideTargetName === "--file"
					? "may write core.hooksPath outside the target repo (this parser does not check where the path points)"
					: "writes core.hooksPath outside the target repo";
			return {
				decision: "deny",
				reason:
					`Blocked 'git ${guarded.subcommand}' for using '${guarded.outsideTargetFlag}': this ${certainty}, where it can still skip this repo's (or another repo's) git hooks. ` +
					"Write to the target's own local config instead (drop the scope/file flag, or use --local/--worktree). " +
					"If writing outside the target is genuinely needed, run the command in your own terminal instead.",
			};
		}
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
	const targetsDefaultBranch = currentBranch === mainBranch;
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
		decision: guarded.decision,
		reason:
			`Blocked '${command}': its effective cwd cannot be resolved without shell expansion. ` +
			`Use a literal path or harness workdir.${bypassNote}`,
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
	{
		resolveBranches,
		supportsAsk = true,
		ambientGitTargetOverride = false,
		ambientCdPath = false,
	},
) {
	const payload = parseHookPayload(inputText);
	if (!payload) return { shouldOutput: false };
	if (payload?.tool_name !== "Bash") return { shouldOutput: false };
	const payloadCwd = payload?.cwd;
	const hookCwd =
		typeof payloadCwd === "string" && payloadCwd.trim() !== ""
			? payloadCwd
			: process.cwd();
	const targets = resolveGuardedGitCommands(
		payload?.tool_input?.command,
		hookCwd,
		{ ambientCdPath, ambientGitTargetOverride },
	);
	if (targets.length === 0) return { shouldOutput: false };

	let asked = null;
	for (const target of targets) {
		const result =
			target.cwd === null
				? evaluateUnresolvedCwd(target)
				: evaluateGuardedCommand(target, resolveBranches(payload, target.cwd));
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
