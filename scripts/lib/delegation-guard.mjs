// Blocks outward-facing Bash commands (push, PR/issue mutation) when they
// come from a delegated subagent rather than from the caller (#554).
//
// buildPermissionOutput/parseHookPayload are shared with the other guard hooks
// via lib/hook-io.mjs (#650) rather than redefined here.
// Why a hook and not permissions/frontmatter:
//   - agent frontmatter `tools:` is tool-granularity, so any agent holding
//     Bash can still reach `git push` and `gh`
//   - .claude/settings.json `permissions.deny` is project-wide, so it would
//     also disarm the main thread and issue-worker (whose job is to open PRs)
// Only a PreToolUse hook can scope the rule to the caller, because only the
// hook payload distinguishes them: a subagent's payload carries `agent_type`
// and `agent_id`, the main thread's does not (verified, #554). session_id,
// transcript_path and prompt_id are shared by parent and child and cannot be
// used for this.
//
// Out of scope: an agent determined to route around this (raw `curl` against
// the API, a script that shells out) is not stopped here. The backstop is the
// caller re-checking `git log origin/<branch>..HEAD` and the PR list when the
// delegation returns.

import { flagValues, parseGhCommand } from "./gh-command.mjs";
import { buildPermissionOutput, parseHookPayload } from "./hook-io.mjs";

/** Agents permitted to perform outward-facing actions. Publishing is their job. */
export const DEFAULT_ALLOWED_AGENTS = ["issue-worker"];

/** gh verbs that only read. Everything else is treated as mutating. */
const READ_ONLY_GH_VERBS = new Set(["view", "list", "status", "checks", "diff", "download", "log"]);

/** git subcommands that publish to a remote. */
const OUTWARD_GIT_SUBCOMMANDS = new Set(["push"]);

/** git global flags that take a separate value, so the value is not the subcommand. */
const GIT_GLOBAL_FLAGS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);

// Split on shell separators that start a new command, ignoring separators
// inside quotes. Quote tracking is what keeps `echo "git push"` from being
// read as a push.
//
// Exported so other command-inspecting guards (main-commit-guard.mjs) reuse
// this parsing instead of re-implementing quote/segment handling.
export function splitSegments(command) {
	const segments = [];
	let current = "";
	let quote = null;
	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (quote) {
			if (ch === "\\" && quote === '"') {
				current += ch + (command[i + 1] ?? "");
				i++;
				continue;
			}
			if (ch === quote) quote = null;
			current += ch;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			current += ch;
			continue;
		}
		const two = command.slice(i, i + 2);
		if (two === "&&" || two === "||") {
			segments.push(current);
			current = "";
			i++;
			continue;
		}
		if (ch === ";" || ch === "|" || ch === "&" || ch === "\n") {
			segments.push(current);
			current = "";
			continue;
		}
		if (ch === "(" || ch === ")") {
			segments.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	segments.push(current);
	return segments;
}

// Tokens are only inspected when unquoted, so a quoted argument can never be
// mistaken for a subcommand.
export function tokenize(segment) {
	const tokens = [];
	let current = "";
	let quote = null;
	let quoted = false;
	const flush = () => {
		if (current !== "" || quoted) tokens.push({ value: current, quoted });
		current = "";
		quoted = false;
	};
	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i];
		if (quote) {
			if (ch === quote) {
				quote = null;
				continue;
			}
			current += ch;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			quoted = true;
			continue;
		}
		if (/\s/.test(ch)) {
			flush();
			continue;
		}
		current += ch;
	}
	flush();
	return tokens;
}

// `FOO=bar cmd` and `sudo cmd` still run cmd.
export function stripLeadingNoise(tokens) {
	let i = 0;
	while (i < tokens.length) {
		const value = tokens[i].value;
		if (!tokens[i].quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) {
			i++;
			continue;
		}
		if (value === "sudo" || value === "command" || value === "nohup" || value === "time" || value === "env") {
			i++;
			continue;
		}
		break;
	}
	return tokens.slice(i);
}

export function gitSubcommand(tokens) {
	for (let i = 1; i < tokens.length; i++) {
		const { value, quoted } = tokens[i];
		if (quoted) return null;
		if (GIT_GLOBAL_FLAGS_WITH_VALUE.has(value)) {
			i++;
			continue;
		}
		if (value.startsWith("-")) continue;
		return value;
	}
	return null;
}

function ghApiMethod(args) {
	const [method] = flagValues(args, ["-X", "--method"]);
	return method ?? null;
}

/**
 * Return a short label for the outward-facing command found in `command`, or
 * null when nothing in it publishes anything.
 * @param {string} command
 * @returns {string|null}
 */
export function findOutwardCommand(command) {
	if (typeof command !== "string" || command.trim() === "") return null;

	for (const segment of splitSegments(command)) {
		const tokens = stripLeadingNoise(tokenize(segment));
		if (tokens.length === 0) continue;
		const head = tokens[0];
		if (head.quoted) continue;

		if (head.value === "git") {
			const sub = gitSubcommand(tokens);
			if (sub && OUTWARD_GIT_SUBCOMMANDS.has(sub)) return `git ${sub}`;
			continue;
		}

		if (head.value === "gh") {
			// The group is not necessarily tokens[1] — a global flag can come
			// first, and reading the flag as the group made this guard fail open
			// on `gh -R owner/repo pr create` (review finding, #650).
			const parsed = parseGhCommand(tokens);
			if (!parsed) continue;
			if (parsed.group === "api") {
				const method = ghApiMethod(parsed.args);
				// No explicit method means GET, which only reads.
				if (method && method.toUpperCase() !== "GET") return `gh api ${method.toUpperCase()}`;
				continue;
			}
			// An unrecognised or absent verb is treated as mutating: guessing
			// in the permissive direction is what this guard exists to prevent.
			if (parsed.verb === null) return `gh ${parsed.group}`;
			if (!READ_ONLY_GH_VERBS.has(parsed.verb)) return `gh ${parsed.group} ${parsed.verb}`;
			continue;
		}
	}
	return null;
}

/**
 * Decide whether a PreToolUse Bash invocation may proceed.
 * @param {object} payload PreToolUse hook payload
 * @param {{allowedAgents?: string[]}} [options]
 * @returns {{decision: "allow"} | {decision: "deny", reason: string, matched: string}}
 */
export function evaluateDelegationGuard(payload, { allowedAgents = DEFAULT_ALLOWED_AGENTS } = {}) {
	if (payload?.tool_name !== "Bash") return { decision: "allow" };

	const agentType = payload?.agent_type;
	// No agent_type means the caller itself, which owns review and publishing.
	if (!agentType) return { decision: "allow" };
	if (allowedAgents.includes(agentType)) return { decision: "allow" };

	const matched = findOutwardCommand(payload?.tool_input?.command);
	if (!matched) return { decision: "allow" };

	return {
		decision: "deny",
		matched,
		reason:
			`Blocked '${matched}': the '${agentType}' subagent must not perform outward-facing actions. ` +
			"Publishing is the caller's to do. Finish the work as commits on the current branch, then report back " +
			"to your caller and let it review, push and open the pull request. Do not look for another route.",
	};
}

/**
 * Orchestrates the hook's stdin payload into a print-or-not decision.
 * Malformed JSON must silently allow (no output), matching the top-level
 * script's `process.exit(0)` on a parse failure — a crash in this guard must
 * not wedge every Bash call (#645).
 * @param {string} inputText - raw stdin payload
 * @returns {{shouldOutput: boolean, output?: object}}
 */
export function runDelegationGuard(inputText) {
	const payload = parseHookPayload(inputText);
	if (!payload) return { shouldOutput: false };

	const result = evaluateDelegationGuard(payload);
	if (result.decision === "deny") {
		return { shouldOutput: true, output: buildPermissionOutput(result) };
	}
	return { shouldOutput: false };
}
