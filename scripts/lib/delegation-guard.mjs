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
// hook payload distinguishes them: `agent_id` is present "only when the hook
// fires inside a subagent call", which the hooks reference names as the way to
// tell subagent calls from main-thread ones. `agent_type` is not that field —
// it is also present "when the session uses --agent", so a caller started with
// `claude --agent <name>` reads as a subagent and gets its own push blocked
// (#932; the earlier "verified, #554" note had missed that clause). session_id,
// transcript_path and prompt_id are shared by parent and child and cannot be
// used for this.
//
// Out of scope: an agent determined to route around this (raw `curl` against
// the API, a script that shells out) is not stopped here. The backstop is the
// caller re-checking `git log origin/<branch>..HEAD` and the PR list when the
// delegation returns.

import { basename } from "node:path";

import { flagValues, parseGhCommand } from "./gh-command.mjs";
import { buildPermissionOutput, parseHookPayload } from "./hook-io.mjs";

/** Agents permitted to perform outward-facing actions. Publishing is their job. */
export const DEFAULT_ALLOWED_AGENTS = ["issue-worker"];

/** gh verbs that only read. Everything else is treated as mutating. */
const READ_ONLY_GH_VERBS = new Set([
	"view",
	"list",
	"status",
	"checks",
	"diff",
	"download",
	"log",
]);

/** git subcommands that publish to a remote. */
const OUTWARD_GIT_SUBCOMMANDS = new Set(["push"]);

/** git global flags that take a separate value, so the value is not the subcommand. */
const GIT_GLOBAL_FLAGS_WITH_VALUE = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--exec-path",
]);

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
		if (ch === "&" && (command[i - 1] === "<" || command[i - 1] === ">")) {
			current += ch;
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
	let tokenQuote;
	let hasUnquotedText = false;
	const flush = () => {
		if (current !== "" || quoted) {
			const token = { value: current, quoted };
			if (tokenQuote !== undefined && !hasUnquotedText)
				token.quote = tokenQuote;
			tokens.push(token);
		}
		current = "";
		quoted = false;
		tokenQuote = undefined;
		hasUnquotedText = false;
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
			if (tokenQuote === undefined) tokenQuote = ch;
			else if (tokenQuote !== ch) tokenQuote = null;
			continue;
		}
		if (/\s/.test(ch)) {
			flush();
			continue;
		}
		current += ch;
		hasUnquotedText = true;
	}
	flush();
	return tokens;
}

const ENV_FLAGS_WITH_VALUE = new Set([
	"-u",
	"--unset",
	"-C",
	"--chdir",
	"-S",
	"--split-string",
	"-P",
]);

const GIT_TARGET_VARIABLES = new Set([
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_COMMON_DIR",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_NAMESPACE",
]);

function isGitTargetAssignment(value) {
	const equals = value.indexOf("=");
	return equals !== -1 && GIT_TARGET_VARIABLES.has(value.slice(0, equals));
}

export function parseEnvPrefix(tokens, start = 0) {
	if (basename(tokens[start]?.value ?? "") !== "env") return null;
	let i = start + 1;
	let chdir;
	let malformed = false;
	let gitTargetOverride = false;
	while (i < tokens.length) {
		const value = tokens[i].value;
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) {
			gitTargetOverride ||= isGitTargetAssignment(value);
			i++;
			continue;
		}
		if (value === "--")
			return { end: i + 1, chdir, malformed, gitTargetOverride };
		if (value === "-C" || value === "--chdir") {
			if (!tokens[i + 1]) malformed = true;
			else chdir = tokens[i + 1];
			i += 2;
			continue;
		}
		if (value.startsWith("--chdir=")) {
			const target = value.slice("--chdir=".length);
			if (target === "") malformed = true;
			else chdir = { ...tokens[i], value: target };
			i++;
			continue;
		}
		if (value.startsWith("-C") && value.length > 2) {
			chdir = { ...tokens[i], value: value.slice(2) };
			i++;
			continue;
		}
		if (ENV_FLAGS_WITH_VALUE.has(value)) {
			i += 2;
			continue;
		}
		if (
			value === "-i" ||
			value === "--ignore-environment" ||
			value === "-0" ||
			value === "--null" ||
			value === "-v" ||
			value === "--debug" ||
			/^-(?:u|C|S|P).+/.test(value) ||
			/^--(?:unset|chdir|split-string)=/.test(value)
		) {
			i++;
			continue;
		}
		break;
	}
	return { end: i, chdir, malformed, gitTargetOverride };
}

const LEADING_REDIRECTION = /^(?:[0-9]*(?:<<<|<<|<>|<&|>&|>>?|<)|&>>?)/;

function leadingRedirectionLength(tokens, start) {
	const value = tokens[start]?.value ?? "";
	const operator = value.match(LEADING_REDIRECTION)?.[0];
	if (!operator) return 0;
	if (operator.length < value.length) return 1;
	if (tokens[start + 1]) return 2;
	return 0;
}

const SUDO_FLAGS_WITH_VALUE = new Set([
	"-u",
	"--user",
	"-g",
	"--group",
	"-h",
	"--host",
	"-p",
	"--prompt",
	"-C",
	"--close-from",
	"-R",
	"--chroot",
	"-T",
	"--command-timeout",
]);

const TIME_FLAGS_WITH_VALUE = new Set(["-o", "--output", "-f", "--format"]);

function parseSudoPrefix(tokens, start) {
	if (basename(tokens[start]?.value ?? "") !== "sudo") return null;
	let i = start + 1;
	let unresolved = false;
	while (i < tokens.length) {
		const value = tokens[i].value;
		if (value === "--") return { end: i + 1, unresolved };
		if (SUDO_FLAGS_WITH_VALUE.has(value)) {
			if (!tokens[i + 1]) unresolved = true;
			if (value === "-R" || value === "--chroot") unresolved = true;
			i += 2;
			continue;
		}
		if (
			/^--(?:user|group|host|prompt|close-from|command-timeout)=/.test(value)
		) {
			i++;
			continue;
		}
		if (value.startsWith("--chroot=")) {
			unresolved = true;
			i++;
			continue;
		}
		if (/^-(?:u|g|h|p|C|T).+/.test(value)) {
			i++;
			continue;
		}
		if (value.startsWith("-R") && value.length > 2) {
			unresolved = true;
			i++;
			continue;
		}
		if (
			value === "-n" ||
			value === "--non-interactive" ||
			value === "-b" ||
			value === "-E"
		) {
			i++;
			continue;
		}
		if (value.startsWith("-")) {
			unresolved = true;
			i++;
			continue;
		}
		break;
	}
	return { end: i, unresolved };
}

function parseTimePrefix(tokens, start) {
	if (basename(tokens[start]?.value ?? "") !== "time") return null;
	let i = start + 1;
	let unresolved = false;
	while (i < tokens.length) {
		const value = tokens[i].value;
		if (value === "--") return { end: i + 1, unresolved };
		if (TIME_FLAGS_WITH_VALUE.has(value)) {
			if (!tokens[i + 1]) unresolved = true;
			i += 2;
			continue;
		}
		if (/^--(?:output|format)=/.test(value) || /^-(?:o|f).+/.test(value)) {
			i++;
			continue;
		}
		if (
			value === "-a" ||
			value === "--append" ||
			value === "-p" ||
			value === "--portability" ||
			value === "-v" ||
			value === "--verbose"
		) {
			i++;
			continue;
		}
		if (value.startsWith("-")) {
			unresolved = true;
			i++;
			continue;
		}
		break;
	}
	return { end: i, unresolved };
}

function parseCommandPrefix(tokens, start) {
	if (basename(tokens[start]?.value ?? "") !== "command") return null;
	let i = start + 1;
	let query = false;
	let unresolved = false;
	while (i < tokens.length) {
		const value = tokens[i].value;
		if (value === "--") return { end: i + 1, query, unresolved };
		if (/^-[pVv]+$/.test(value)) {
			query ||= /[Vv]/.test(value);
			i++;
			continue;
		}
		if (value.startsWith("-")) {
			unresolved = true;
			i++;
			continue;
		}
		break;
	}
	return { end: i, query, unresolved };
}

export function parseLeadingShellPrefix(tokens) {
	let i = 0;
	let unresolved = false;
	let gitTargetOverride = false;
	const envs = [];
	while (i < tokens.length) {
		const value = tokens[i].value;
		const executable = basename(value);
		const redirection = leadingRedirectionLength(tokens, i);
		if (redirection > 0) {
			i += redirection;
			continue;
		}
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) {
			gitTargetOverride ||= isGitTargetAssignment(value);
			i++;
			continue;
		}
		if (executable === "env") {
			const env = parseEnvPrefix(tokens, i);
			envs.push(env);
			unresolved ||= env.malformed;
			gitTargetOverride ||= env.gitTargetOverride;
			i = env.end;
			continue;
		}
		const command = parseCommandPrefix(tokens, i);
		if (command !== null) {
			unresolved ||= command.unresolved;
			if (command.query)
				return { end: tokens.length, envs, unresolved, gitTargetOverride };
			i = command.end;
			continue;
		}
		const sudo = parseSudoPrefix(tokens, i);
		if (sudo !== null) {
			unresolved ||= sudo.unresolved;
			i = sudo.end;
			continue;
		}
		const time = parseTimePrefix(tokens, i);
		if (time !== null) {
			unresolved ||= time.unresolved;
			i = time.end;
			continue;
		}
		if (executable === "nohup") {
			i++;
			continue;
		}
		break;
	}
	return { end: i, envs, unresolved, gitTargetOverride };
}

// `FOO=bar cmd` and executable command prefixes still run cmd.
export function stripLeadingNoise(tokens) {
	return tokens.slice(parseLeadingShellPrefix(tokens).end);
}

export function gitSubcommandIndex(tokens) {
	for (let i = 1; i < tokens.length; i++) {
		const { value } = tokens[i];
		if (GIT_GLOBAL_FLAGS_WITH_VALUE.has(value)) {
			i++;
			continue;
		}
		if (value.startsWith("-")) continue;
		return i;
	}
	return null;
}

export function gitSubcommand(tokens) {
	const index = gitSubcommandIndex(tokens);
	return index === null ? null : tokens[index].value;
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
		const executable = basename(head.value);

		if (executable === "git") {
			const sub = gitSubcommand(tokens);
			if (sub && OUTWARD_GIT_SUBCOMMANDS.has(sub)) return `git ${sub}`;
			continue;
		}

		if (executable === "gh") {
			// The group is not necessarily tokens[1] — a global flag can come
			// first, and reading the flag as the group made this guard fail open
			// on `gh -R owner/repo pr create` (review finding, #650).
			const parsed = parseGhCommand(tokens);
			if (!parsed) continue;
			if (parsed.group === "api") {
				const method = ghApiMethod(parsed.args);
				// No explicit method means GET, which only reads.
				if (method && method.toUpperCase() !== "GET")
					return `gh api ${method.toUpperCase()}`;
				continue;
			}
			// An unrecognised or absent verb is treated as mutating: guessing
			// in the permissive direction is what this guard exists to prevent.
			if (parsed.verb === null) return `gh ${parsed.group}`;
			if (!READ_ONLY_GH_VERBS.has(parsed.verb))
				return `gh ${parsed.group} ${parsed.verb}`;
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
export function evaluateDelegationGuard(
	payload,
	{ allowedAgents = DEFAULT_ALLOWED_AGENTS } = {},
) {
	if (payload?.tool_name !== "Bash") return { decision: "allow" };

	// No agent_id means the caller itself, which owns review and publishing.
	// See the module header for why agent_id and not agent_type (#932).
	if (!payload?.agent_id) return { decision: "allow" };

	// agent_type names which agent it is; the contract has it present whenever
	// agent_id is, so it needs no absence handling here.
	const agentType = payload?.agent_type;
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
