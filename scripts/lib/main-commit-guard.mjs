// Blocks or asks about git commands that change the working tree or index when
// the target is main (#650, widened in #777) or another worktree in the same
// repository (#784). CLAUDE.md and work-cycle.md require each session to keep
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

import { basename, resolve } from "node:path";
import {
	gitSubcommand,
	gitSubcommandIndex,
	parseLeadingShellPrefix,
	persistsCdPathOverride,
	persistsGitTargetOverride,
	splitSegments,
	stripLeadingNoise,
	tokenize,
} from "./delegation-guard.mjs";
import { buildPermissionOutput, parseHookPayload } from "./hook-io.mjs";

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

const CODEX_ROUTINE_MUTATIONS = new Map([
	["stage-all", "add"],
	["commit", "commit"],
	["branch-rename", "branch"],
]);

function codexRoutineSubcommand(tokens) {
	if (basename(tokens[0]?.value ?? "") !== "codex-git-routine.mjs") return null;
	return CODEX_ROUTINE_MUTATIONS.get(tokens[1]?.value) ?? null;
}

/**
 * The guarded git subcommand one already-tokenized segment runs, or null.
 * @param {{value: string, quoted: boolean}[]} tokens
 * @returns {{subcommand: string, decision: "deny" | "ask"} | null}
 */
function classifySegment(tokens) {
	if (tokens.length === 0) return null;
	const head = tokens[0];
	if (basename(head.value) !== "git") {
		const subcommand = codexRoutineSubcommand(tokens);
		return subcommand === null ? null : { subcommand, decision: "deny" };
	}

	const sub = gitSubcommand(tokens);
	if (!sub) return null;
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
 * @returns {{subcommand: string, decision: "deny" | "ask"} | null}
 */
export function classifyGitCommand(command) {
	if (typeof command !== "string" || command.trim() === "") return null;

	/** @type {{subcommand: string, decision: "deny" | "ask"} | null} */
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
	const target = staticPath(tokens[2]);
	return target === null ? null : resolve(target);
}

function guardedSuffix(tokens) {
	for (let i = 0; i < tokens.length; i++) {
		const guarded = classifySegment(tokens.slice(i));
		if (guarded) return guarded;
	}
	return null;
}

/**
 * Track the shell cwd and retain each guarded Git segment with its own target.
 * A PreToolUse hook fires before the shell does, so `payload.cwd` does not yet
 * reflect `cd` or `git -C` inside the command (#751). Keeping every target is
 * also necessary because one Bash invocation can move between worktrees
 * before running another guarded Git command (#784).
 */
function analyzeCommand(command, hookCwd, { ambientCdPath = false } = {}) {
	if (typeof command !== "string") return { targets: [], finalCwd: hookCwd };

	/** Where the shell stands, or null once a `cd` moved it somewhere unknown. */
	let cwd = hookCwd;
	let gitTargetOverride = false;
	let cdPathOverride = ambientCdPath;
	const targets = [];

	for (const segment of splitSegments(command)) {
		const rawTokens = tokenize(segment);
		gitTargetOverride ||= persistsGitTargetOverride(rawTokens);
		cdPathOverride ||= persistsCdPathOverride(rawTokens);
		const prefix = parseLeadingShellPrefix(rawTokens);
		const envCwd = resolveEnvCwd(rawTokens, cwd);
		const tokens = rawTokens.slice(prefix.end);
		if (tokens.length === 0) continue;
		const head = basename(tokens[0].value);

		if (
			(head === "builtin" &&
				["cd", "pushd", "popd"].includes(tokens[1]?.value)) ||
			head === "pushd" ||
			head === "popd"
		) {
			cwd = null;
			continue;
		}

		if (head === "cd") {
			const target = cdPath(tokens);
			if (target === null) cwd = null;
			// An absolute target restores a trail lost to an unresolvable earlier cd.
			else if (target.startsWith("/")) cwd = resolve(target);
			else if (cdPathOverride || prefix.cdPathOverride) cwd = null;
			else if (cwd !== null) cwd = resolve(cwd, target);
			continue;
		}

		const guarded =
			classifySegment(tokens) ??
			(prefix.unresolved ? guardedSuffix(tokens) : null);
		if (!guarded) continue;
		targets.push({
			...guarded,
			cwd:
				prefix.unresolved || gitTargetOverride
					? null
					: head === "git"
						? resolveGitCwd(tokens, envCwd)
						: resolveCodexRoutineCwd(tokens),
		});
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
 * Whether a command targets another worktree of the session's own repository.
 * @param {{worktreeRoot: string, commonDir: string} | null} sessionRoots
 * @param {{worktreeRoot: string, commonDir: string} | null} targetRoots
 */
export function crossesWorktree(sessionRoots, targetRoots) {
	if (!sessionRoots || !targetRoots) return false;
	return (
		sessionRoots.commonDir === targetRoots.commonDir &&
		sessionRoots.worktreeRoot !== targetRoots.worktreeRoot
	);
}

/**
 * Decide whether a PreToolUse Bash invocation may proceed.
 * @param {object} payload PreToolUse hook payload
 * @param {{currentBranch: string | undefined, mainBranch?: string, crossesWorktree?: boolean}} context
 * @returns {{decision: "allow"} | {decision: "deny" | "ask", reason: string}}
 */
export function evaluateMainCommitGuard(
	payload,
	{ currentBranch, mainBranch = "main", crossesWorktree = false } = {},
) {
	if (payload?.tool_name !== "Bash") return { decision: "allow" };
	const guarded = classifyGitCommand(payload?.tool_input?.command);
	if (!guarded) return { decision: "allow" };
	return evaluateGuardedCommand(guarded, {
		currentBranch,
		mainBranch,
		crossesWorktree,
	});
}

function evaluateGuardedCommand(
	guarded,
	{ currentBranch, mainBranch = "main", crossesWorktree = false } = {},
) {
	const targetsDefaultBranch = currentBranch === mainBranch;
	if (!targetsDefaultBranch && !crossesWorktree) return { decision: "allow" };

	const command = `git ${guarded.subcommand}`;
	if (guarded.decision === "deny") {
		return {
			decision: "deny",
			reason:
				crossesWorktree && !targetsDefaultBranch
					? `Blocked '${command}' in a sibling worktree: this requires starting or reopening a session whose project root is that worktree before running it there.`
					: `Blocked '${command}' on '${mainBranch}': this repo's ecosystem requires develop → PR → merge_pr, ` +
						"and the main checkout's index is shared by processes and sessions targeting that checkout, so anything staged here rides along on " +
						"the next commit made there. Create or switch to a feature branch first (e.g. via the worktree " +
						"skill), then run it there.",
		};
	}
	return {
		decision: "ask",
		reason:
			crossesWorktree && !targetsDefaultBranch
				? `'${command}' would change a sibling worktree, which can discard another session's uncommitted edits. Confirm only if this session intentionally owns that target worktree.`
				: `'${command}' on '${mainBranch}' would change the main checkout's working tree, which every session ` +
					"shares — it can discard another session's uncommitted edits. It is also how CLAUDE.md says to repair " +
					"a tree that was written to by mistake, and this hook cannot tell the two apart. Confirm only if this " +
					"is the repair.",
	};
}

function evaluateUnresolvedCwd(guarded) {
	const command = `git ${guarded.subcommand}`;
	return {
		decision: guarded.decision,
		reason:
			`Blocked '${command}': its effective cwd cannot be resolved without shell expansion. ` +
			"Use a literal path or harness workdir.",
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
 * @param {{resolveBranches: (payload: object, targetCwd: string) => {currentBranch?: string, mainBranch?: string, crossesWorktree?: boolean}}} io
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
		{ ambientCdPath },
	);
	if (targets.length === 0) return { shouldOutput: false };

	let asked = null;
	for (const target of targets) {
		const result =
			target.cwd === null || ambientGitTargetOverride
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
