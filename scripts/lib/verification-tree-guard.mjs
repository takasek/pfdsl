// Asks before a command whose target tree is implicit in cwd runs while the
// hook reports the main checkout of a repository with linked worktrees (#840).
//
// A worktree session's Bash cwd can revert to the main checkout between
// calls (see CLAUDE.md "worktree でのファイル操作パス"). When that happens, a
// command that resolves its working tree from cwd — `make`, `pnpm`/`npm`,
// `npx`, or `node` given a relative script path — runs against the main
// checkout's tree instead, which does not contain the worktree branch's
// changes. A pass there reads exactly like a pass of the branch under
// review, because nothing in the command's own output says which tree it ran
// against. The detection axis is therefore not "is this command one of a
// fixed list of verification verbs" but "does this command's target tree
// depend on cwd" — a command that names its tree explicitly (`-C <path>`, an
// absolute script path) is unaffected by drift and is excluded regardless of
// what the command does. worktree-write-guard.mjs closes the equivalent gap
// for Edit/Write; this closes it for commands whose tree is cwd-implicit.
//
// Claude Code asks rather than denies: a deliberate check of the main checkout
// itself (e.g. before a release) is a legitimate reason to run these commands
// there. Codex does not support PreToolUse ask and continues after the hook
// failure, so the same decision is converted to deny there (#1013). The guard
// reads payload.cwd, not tool_input.workdir. A harness workdir change only
// helps if the hook actually observes the linked worktree in payload.cwd;
// Codex can keep reporting the session's starting cwd instead (#1392).
// An advisory is not the alternative: what these commands
// do in the main checkout is write to it, so a note delivered next to the
// result arrives after the tree has already changed (see hook-io.mjs).
//
// The reported cwd is also not reconstructed from shell directory changes:
// a `cd <dir> && make test` is judged on payload.cwd. That misses both ways —
// a main-checkout payload that cds into a worktree is asked about anyway,
// and a worktree payload that cds out of it is not asked at all. Splitting
// calls or setting workdir alone cannot repair a payload that stays unchanged.
// Recovery must follow the local worktree guide and normal approvals: use a
// configured explicit-target wrapper for registered checkouts, or explicit
// targets in approved normal commands for independent repositories outside
// that registration. Explicit syntax avoids cwd drift in this guard only;
// it does not override ownership, main-checkout, or trusted-root checks.

import { shellParseDecision, stripLeadingNoise } from "./delegation-guard.mjs";
import { buildPermissionOutput, parseHookPayload } from "./hook-io.mjs";
import { readShellCommands } from "./shell-commands.mjs";

/** `-C`/`--directory` forms that make `make`'s cwd explicit, so drift cannot
 * affect it. */
const MAKE_CWD_FLAGS = ["-C", "--directory"];

/** `-C`/`--dir`/`--prefix` forms that make a package manager's (`pnpm`/`npm`)
 * cwd explicit. */
const PACKAGE_MANAGER_CWD_FLAGS = ["-C", "--dir", "--prefix"];

/** Script-file extensions treated as a relative-path operand for `node` even
 * without a `/` in the token (e.g. `foo.mjs` run from the target tree's own
 * root). */
const NODE_SCRIPT_EXTENSIONS = [".mjs", ".js", ".cjs", ".ts"];

/** Whether `tokens` contains one of `flagNames`, so cwd is an explicit part
 * of the command and cwd drift cannot affect it. `--flag=<path>` arrives as
 * one token, so the flag name is read up to `=` and compared by equality
 * rather than via `startsWith("--flag=")` — the latter is a string literal
 * handed to `startsWith`, the shape check-cli-conventions.mjs flags (#648)
 * even though this parses another command's arguments, not this script's own
 * argv (the same distinction command-usage-guard.mjs is exempted by name
 * for there).
 */
function hasExplicitCwdFlag(tokens, flagNames) {
	return tokens.some((t) => {
		if (t.quoted) return false;
		const flagName = t.value.split("=", 1)[0];
		return flagNames.includes(flagName);
	});
}

/** Whether `rest` (the tokens after `make`) targets an implicit-cwd tree.
 * Every `make` invocation does — the target chosen does not change which
 * tree the Makefile itself is read from — so this is `true` for any
 * invocation that does not name its cwd explicitly. */
function isVerificationMake(rest) {
	return !hasExplicitCwdFlag(rest, MAKE_CWD_FLAGS);
}

/** Whether `rest` (the tokens after `pnpm`/`npm`) targets an implicit-cwd
 * tree. Every subcommand does — `pnpm`/`npm` resolve `package.json` from cwd
 * regardless of which subcommand runs — so this is `true` for any invocation
 * that does not name its cwd explicitly. */
function isVerificationPackageManager(rest) {
	return !hasExplicitCwdFlag(rest, PACKAGE_MANAGER_CWD_FLAGS);
}

/** `node` flags whose very next token is program source, not a path — `node
 * -e "import '/abs/x.mjs'"` names a tree inside the program text, but that
 * text is not itself a path operand just because it contains `/`. */
const NODE_EVAL_FLAGS = ["-e", "--eval", "-p", "--print"];

/** Whether `token` is a relative-path operand: not a flag (does not start
 * with `-`), not already absolute (does not start with `/`), and looks like
 * a path — either it contains a `/` or it ends in a recognised script
 * extension. */
function isRelativePathOperand(token) {
	const { value } = token;
	if (value.startsWith("-") || value.startsWith("/")) return false;
	return (
		value.includes("/") ||
		NODE_SCRIPT_EXTENSIONS.some((ext) => value.endsWith(ext))
	);
}

/** Whether `token` is an absolute-path operand: starts with `/`. An absolute
 * path names its tree explicitly, so it is unaffected by cwd drift. */
function isAbsolutePathOperand(token) {
	return token.value.startsWith("/");
}

/** The indices in `rest` that are program source rather than a path operand:
 * the token immediately after an eval flag (`-e`/`--eval`/`-p`/`--print`),
 * found by position so a preceding flag like `--input-type=module` does not
 * throw off which token is the program. Position, not `!t.quoted`, is the
 * criterion: a quoted relative path (`node "scripts/x.mjs"`) must still
 * count as an operand, so quotedness cannot be what excludes eval bodies. */
function nodeEvalOperandIndices(rest) {
	const indices = new Set();
	rest.forEach((t, i) => {
		if (!t.quoted && NODE_EVAL_FLAGS.includes(t.value) && i + 1 < rest.length) {
			indices.add(i + 1);
		}
	});
	return indices;
}

/** Whether `rest` (the tokens after `node`) targets an implicit-cwd tree: a
 * relative script-path operand (the interpreter reads the script relative to
 * cwd), or a `--test` invocation that names no absolute-path operand (`node
 * --test` alone still resolves its file glob from cwd). `node -e '...'` and
 * similar have no path operand at all and are excluded either way — the
 * eval flag's own operand is program source, not a path, and is excluded
 * from both checks below by position (nodeEvalOperandIndices), regardless
 * of what `/` characters its text happens to contain.
 *
 * Known miss: an eval body whose own import specifier is relative is
 * cwd-dependent but is not caught here, because that would require parsing
 * the program text rather than the command line — accepted as out of scope.
 * (The example is described rather than written out: check-script-imports
 * reads this file's text and would resolve a literal relative specifier in a
 * comment as a broken import.) */
function isVerificationNode(rest) {
	const evalOperands = nodeEvalOperandIndices(rest);
	const pathCandidates = rest.filter((_, i) => !evalOperands.has(i));
	if (pathCandidates.some(isRelativePathOperand)) return true;
	const hasTest = rest.some((t) => !t.quoted && t.value === "--test");
	if (!hasTest) return false;
	return !pathCandidates.some(isAbsolutePathOperand);
}

/** Whether one already-split segment is a verification command. */
function isVerificationSegment(segment) {
	const tokens = stripLeadingNoise(segment.tokens);
	if (tokens.length === 0) return false;
	const head = tokens[0];
	if (head.dynamic) return false;
	const rest = tokens.slice(1);

	if (head.value === "make") return isVerificationMake(rest);
	if (head.value === "node") return isVerificationNode(rest);
	if (head.value === "pnpm" || head.value === "npm")
		return isVerificationPackageManager(rest);
	// `npx` resolves its package from cwd's node_modules with no flag that
	// names another tree explicitly, so it is always in scope.
	if (head.value === "npx") return true;
	return false;
}

/**
 * The segments of `command` whose target tree is implicit in cwd (`make`,
 * `pnpm`/`npm`, `npx`, or `node` given a relative script path or a `--test`
 * invocation with no absolute-path operand), trimmed. A command with none
 * returns `[]`. `make -C <path>` / `--directory[=]<path>`, `pnpm`/`npm`
 * `-C`/`--dir`/`--prefix[=]<path>`, and `node <absolute path>` are excluded:
 * naming a tree explicitly means drift cannot change which tree they run
 * against.
 * @param {string} command
 * @returns {string[]}
 */
export function findVerificationSegments(command) {
	if (typeof command !== "string" || command.trim() === "") return [];
	return readShellCommands(command)
		.filter((segment) => isVerificationSegment(segment))
		.map((segment) => segment.command.trim());
}

function verificationRiskReason(mainRoot) {
	return (
		`This shell's cwd is the main checkout ('${mainRoot}'), not the linked worktree ` +
		"a session normally runs verification from. That tree does not contain the linked worktree's " +
		"branch changes, so a green result here can be misread as confirmation that those changes pass " +
		"— it looks identical to a genuine run."
	);
}

/**
 * Decide whether a PreToolUse Bash invocation may proceed.
 * @param {object} payload PreToolUse hook payload
 * @param {{worktreeRoot: string, mainRoot: string, hasLinkedWorktrees: boolean} | null} roots
 *   git-derived roots for the session's cwd, or null when they could not be
 *   resolved (cwd missing, not a git repo, `git` failure)
 * @returns {{decision: "allow"} | {decision: "ask", reason: string}}
 */
export function evaluateVerificationTreeGuard(
	payload,
	roots,
	{ supportsAsk = true } = {},
) {
	if (payload?.tool_name !== "Bash") return { decision: "allow" };
	const failure = shellParseDecision(payload?.tool_input?.command, {
		supportsAsk,
	});
	if (failure) return failure;

	const command = payload?.tool_input?.command;
	if (typeof command !== "string") return { decision: "allow" };
	if (findVerificationSegments(command).length === 0)
		return { decision: "allow" };

	if (!roots) return { decision: "allow" };
	// cwd's toplevel and its git-common-dir's parent coincide exactly when cwd
	// is the main checkout itself. Anything else is a linked worktree, which is
	// normal operation, not drift.
	if (roots.worktreeRoot !== roots.mainRoot) return { decision: "allow" };
	// No linked worktree exists anywhere in this repo, so there is no branch's
	// changes for this tree to be missing.
	if (roots.hasLinkedWorktrees === false) return { decision: "allow" };

	return {
		decision: "ask",
		reason:
			`${verificationRiskReason(roots.mainRoot)} If this is an intentional check of the main checkout ` +
			"itself (e.g. a release check), confirm to proceed.",
	};
}

/** Whether the current harness supports a PreToolUse ask decision. */
export function supportsPermissionAsk(environment = process.env) {
	return (
		typeof environment.CLAUDE_PROJECT_DIR === "string" &&
		environment.CLAUDE_PROJECT_DIR.trim() !== ""
	);
}

/**
 * Orchestrate one hook payload while keeping harness adaptation outside the
 * semantic guard decision. Codex cannot represent ask, so convert it to a
 * deny instead of letting the command execute after hook failure. Recovery
 * depends on observable hook inputs and the local approved execution path.
 * @param {string} inputText
 * @param {{resolveRoots: (cwd: string) => {worktreeRoot: string, mainRoot: string, hasLinkedWorktrees: boolean} | null, supportsAsk?: boolean}} io
 * @returns {{shouldOutput: boolean, output?: object}}
 */
export function runVerificationTreeGuard(
	inputText,
	{ resolveRoots, supportsAsk = true },
) {
	const payload = parseHookPayload(inputText);
	if (!payload) return { shouldOutput: false };
	const cwd = payload?.cwd;
	const roots = typeof cwd === "string" ? resolveRoots(cwd) : null;
	const result = evaluateVerificationTreeGuard(payload, roots, { supportsAsk });
	if (result.decision === "allow") return { shouldOutput: false };
	const adapted =
		supportsAsk || result.decision === "deny"
			? result
			: {
					decision: "deny",
					reason:
						`The hook reports the main checkout ('${roots.mainRoot}') as payload.cwd, and cannot prove that this cwd-implicit command targets the linked worktree that owns the changes. ` +
						"Codex PreToolUse's ask decision is unsupported, so this command is denied instead of failing open. " +
						"The guard reads payload.cwd. Changing only tool_input.workdir while payload.cwd is unchanged repeats this denial. " +
						"For registered pfdsl checkouts, follow your local worktree guide and invoke the configured explicit-target wrapper directly (without a node prefix), with an absolute target, the expected branch, and normal approval. " +
						"For independent repositories outside that registration, use normal approved commands with an explicit target (for example, make -C <absolute path> test or node <absolute script path>). " +
						"Set the execution workdir to the same checkout. This guidance does not authorize bypassing ownership, main-checkout, or trusted-root refusals; stop and check the target and permissions if they occur.",
				};
	return { shouldOutput: true, output: buildPermissionOutput(adapted) };
}
