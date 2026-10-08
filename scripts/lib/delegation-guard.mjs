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
import {
	findMergeCommand,
	githubToolEffect,
	mergeDecision,
} from "./external-operation-policy.mjs";
import {
	ghCommandSelectorTokens,
	isBuiltinGhCommand,
	parseGhCommand,
} from "./gh-command.mjs";
import { buildPermissionOutput, parseHookPayload } from "./hook-io.mjs";
import {
	classifyCodexGitRoutine,
	isReadOnlyGitInvocation,
} from "./shared-git-effects.mjs";
import {
	readShellCommands,
	shellParseDecision as syntaxDecision,
} from "./shell-commands.mjs";

/** Agents permitted to perform outward-facing actions. Publishing is their job. */
export const DEFAULT_ALLOWED_AGENTS = ["issue-worker"];

/** Built-in read operations; a verb alone cannot establish an extension's effect. */
const READ_ONLY_GH_COMMANDS = {
	pr: ["view", "list", "status", "checks", "diff"],
	issue: ["view", "list", "status"],
	run: ["view", "list", "watch", "download"],
	workflow: ["view", "list"],
	auth: ["status"],
	repo: ["view", "list"],
	release: ["view", "list", "download"],
	gist: ["view", "list"],
	search: ["code", "commits", "issues", "prs", "repos"],
	cache: ["list"],
	secret: ["list"],
	variable: ["get", "list"],
	config: ["get", "list"],
	extension: ["list"],
	label: ["list"],
	org: ["list"],
	project: ["list", "view"],
	codespace: ["list", "view", "logs"],
	"gpg-key": ["list"],
	"ssh-key": ["list"],
	ruleset: ["list", "view", "check"],
};
const BUILTIN_GH_GROUPS = new Set([
	...Object.keys(READ_ONLY_GH_COMMANDS),
	"api",
	"help",
	"browse",
	"alias",
	"attestation",
	"completion",
]);
const GH_BOOLEAN_FLAGS = new Set([
	"--draft",
	"--fill",
	"--fill-first",
	"--fill-verbose",
	"--web",
	"--no-browser",
	"--watch",
	"--exit-status",
	"--verbose",
	"--silent",
	"--paginate",
	"--slurp",
	"--include",
	"--insecure",
	"--confirm",
	"--yes",
	"-y",
]);
const GH_VALUE_FLAGS = new Set([
	"-R",
	"--repo",
	"--hostname",
	"-X",
	"--method",
	"-f",
	"-F",
	"--field",
	"--raw-field",
	"--input",
	"--cache",
	"-H",
	"--header",
	"-q",
	"--jq",
	"--template",
	"-t",
	"--title",
	"-b",
	"--body",
	"--body-file",
	"-B",
	"--base",
	"--head",
	"-a",
	"--assignee",
	"-r",
	"--reviewer",
	"-l",
	"--label",
	"-m",
	"--milestone",
	"-p",
	"--project",
	"--json",
	"--limit",
	"--state",
	"--search",
	"--branch",
	"--name",
]);

const GH_COMMAND_HELP_FLAGS = {
	"label create": {
		value: new Set(["--color", "-c", "--description", "-d"]),
		boolean: new Set(["--force", "-f"]),
	},
	"label edit": {
		value: new Set(["--color", "-c", "--description", "-d", "--name", "-n"]),
		boolean: new Set(),
	},
	"issue edit": {
		value: new Set([
			"--add-assignee",
			"--add-blocked-by",
			"--add-blocking",
			"--add-label",
			"--add-project",
			"--add-sub-issue",
			"--attach",
			"--parent",
			"--remove-assignee",
			"--remove-blocked-by",
			"--remove-blocking",
			"--remove-label",
			"--remove-project",
			"--remove-sub-issue",
			"--type",
		]),
		boolean: new Set([
			"--remove-milestone",
			"--remove-parent",
			"--remove-type",
		]),
	},
	"issue close": {
		value: new Set(["--comment", "-c", "--duplicate-of", "--reason", "-r"]),
		boolean: new Set([]),
	},
	"pr edit": {
		value: new Set([
			"--add-assignee",
			"--add-label",
			"--add-project",
			"--add-reviewer",
			"--attach",
			"--remove-assignee",
			"--remove-label",
			"--remove-project",
			"--remove-reviewer",
		]),
		boolean: new Set(["--remove-milestone"]),
	},
	"release create": {
		value: new Set([
			"--discussion-category",
			"--notes",
			"-n",
			"--notes-file",
			"--notes-start-tag",
			"--target",
		]),
		boolean: new Set([
			"-d",
			"--draft",
			"--fail-on-no-commits",
			"--generate-notes",
			"--latest",
			"--notes-from-tag",
			"-p",
			"--prerelease",
			"--verify-tag",
		]),
	},
	"repo create": {
		value: new Set([
			"--description",
			"-d",
			"--gitignore",
			"-g",
			"--homepage",
			"-h",
			"--license",
			"-l",
			"--remote",
			"-r",
			"--source",
			"-s",
			"--team",
			"-t",
			"--template",
			"-p",
		]),
		boolean: new Set([
			"--add-readme",
			"--clone",
			"-c",
			"--disable-issues",
			"--disable-wiki",
			"--include-all-branches",
			"--internal",
			"--private",
			"--public",
			"--push",
		]),
	},
	"label clone": {
		value: new Set([]),
		boolean: new Set(["--force", "-f"]),
	},
	"pr merge": {
		value: new Set([]),
		boolean: new Set([
			"--auto",
			"--admin",
			"-d",
			"--delete-branch",
			"--disable-auto",
			"-m",
			"--merge",
			"-r",
			"--rebase",
			"-s",
			"--squash",
		]),
	},
};

function hasHelpOption(parsed) {
	if (!BUILTIN_GH_GROUPS.has(parsed.group)) return false;
	// `extension exec` forwards the remaining argv to arbitrary extension code.
	if (parsed.group === "extension" && parsed.verb === "exec") return false;
	const commandFlags = GH_COMMAND_HELP_FLAGS[`${parsed.group} ${parsed.verb}`];
	for (let i = 0; i < parsed.args.length; i++) {
		const arg = parsed.args[i];
		if (arg === "--") break;
		// Only the long form: gh binds -h to value flags on some commands
		// (--homepage on repo create/edit, --hostname on auth logout).
		if (arg === "--help") return true;
		const name = arg.split("=", 1)[0];
		if (commandFlags?.value.has(name)) {
			if (arg === name) i++;
			continue;
		}
		if (commandFlags?.boolean.has(name)) continue;
		if (GH_BOOLEAN_FLAGS.has(name)) continue;
		if (GH_VALUE_FLAGS.has(arg)) {
			i++;
			continue;
		}
		if (arg.startsWith("-") && !GH_VALUE_FLAGS.has(name)) return false;
	}
	return false;
}

/** git subcommands that publish to a remote. */
const OUTWARD_GIT_SUBCOMMANDS = new Set(["push"]);

/**
 * git global flags that take a separate value, so the value is not the
 * subcommand. Exported so main-commit-guard.mjs's hasHooksPathGlobalOverride
 * (#1232) can skip the same flags' values when it scans the pre-subcommand
 * span for a `-c`/`--config-env` `core.hooksPath` override.
 * `--config-env` and `--attr-source` were added once their value tokens
 * turned up misread as the subcommand itself (#1232): `git --attr-source
 * HEAD commit -m x` on main went unclassified because `HEAD` read as the
 * subcommand.
 */
export const GIT_GLOBAL_FLAGS_WITH_VALUE = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--exec-path",
	"--config-env",
	"--attr-source",
]);

// Compatibility helper for consumers that inspect a standalone word list.
// Production guards consume the parser's structured commands directly.
export function tokenize(source) {
	return readShellCommands(source)[0]?.tokens ?? [];
}

export function splitCommandFlow(source) {
	return readShellCommands(source);
}

export function splitSegments(source) {
	return readShellCommands(source).map(({ command }) => command);
}

/** Grammar and executable-prefix checks are shared by every Bash guard. */
export function shellParseDecision(command) {
	const failure = syntaxDecision(command);
	if (failure) return failure;
	const ambiguousWord = (token) =>
		token.multipleWords || (token.dynamic && /^-[^-]/.test(token.value));
	for (const { tokens } of readShellCommands(command)) {
		const { end, unresolved } = parseLeadingShellPrefix(tokens);
		if (unresolved || tokens.slice(0, end).some(ambiguousWord))
			return {
				decision: "deny",
				matched: "shell prefix",
				reason:
					"Cannot inspect this executable prefix. Use supported literal options or run the command separately.",
			};
		const executable = tokens[end];
		const builtinName =
			executable?.value === "builtin"
				? tokens[end + (tokens[end + 1]?.value === "--" ? 2 : 1)]
				: null;
		if (executable?.dynamic || builtinName?.dynamic)
			return {
				decision: "deny",
				matched: "shell executable",
				reason:
					"Cannot inspect a dynamic executable. Rewrite it using a literal command name.",
			};
		const invocation = tokens.slice(end);
		if (invocation.length)
			invocation[0] = {
				...invocation[0],
				value: basename(invocation[0].value),
			};
		if (
			["git", "gh"].includes(invocation[0]?.value) &&
			invocation.some(ambiguousWord)
		)
			return {
				decision: "deny",
				matched: "command words",
				reason:
					"Cannot inspect argument expansion that may change command words. Use separate options with quoted scalar values and literal command selectors.",
			};
		const selectors =
			invocation[0]?.value === "git"
				? [invocation[gitSubcommandIndex(invocation)]]
				: (ghCommandSelectorTokens(invocation) ?? []);
		// API endpoints, methods and GraphQL fields can all encode a merge.
		if (
			selectors.some((token) => token?.dynamic) ||
			(selectors[0]?.value === "api" &&
				invocation.some((token) => token.dynamic))
		)
			return {
				decision: "deny",
				matched: "command selector",
				reason:
					"Cannot inspect a dynamic Git or GitHub command selector or API request. Use literal subcommands and API arguments.",
			};
		if (invocation[0]?.value === "gh" && !isBuiltinGhCommand(invocation))
			return {
				decision: "deny",
				matched: "GitHub command name",
				reason:
					"Cannot inspect a GitHub CLI alias, extension, or unsupported command name. Use an explicit supported built-in gh command.",
			};
	}
	return null;
}

const ENV_FLAGS_WITH_VALUE = new Set(["-u", "--unset", "-C", "--chdir", "-P"]);

const GIT_TARGET_VARIABLES = new Set([
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_COMMON_DIR",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_NAMESPACE",
]);

function protectedAssignment(value) {
	const equals = value.indexOf("=");
	if (equals === -1) return null;
	const name = value.slice(0, equals).replace(/\+$/, "");
	if (name === "CDPATH" || GIT_TARGET_VARIABLES.has(name))
		return { name, value: value.slice(equals + 1) };
	return null;
}

function isGitTargetAssignment(value) {
	const assignment = protectedAssignment(value);
	return (
		assignment !== null &&
		assignment.value !== "" &&
		GIT_TARGET_VARIABLES.has(assignment.name)
	);
}

/** A visible `GIT_CONFIG_*` assignment: it injects settings into the Git call. */
function isGitConfigAssignment(value) {
	return /^GIT_CONFIG[A-Za-z0-9_]*\+?=/.test(value);
}

export function parseEnvPrefix(tokens, start = 0) {
	if (basename(tokens[start]?.value ?? "") !== "env") return null;
	let i = start + 1;
	let chdir;
	let malformed = false;
	let gitTargetOverride = false;
	let gitConfigOverride = false;
	while (i < tokens.length) {
		const value = tokens[i].value;
		if (/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(value)) {
			gitTargetOverride ||= isGitTargetAssignment(value);
			gitConfigOverride ||= isGitConfigAssignment(value);
			i++;
			continue;
		}
		if (value === "--")
			return {
				end: i + 1,
				chdir,
				malformed,
				gitTargetOverride,
				gitConfigOverride,
			};
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
			if (!tokens[i + 1]) malformed = true;
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
			/^-(?:u|C|P).+/.test(value) ||
			/^--(?:unset|chdir)=/.test(value)
		) {
			i++;
			continue;
		}
		// Split-string and unknown options can supply or hide executable words.
		if (value.startsWith("-")) malformed = true;
		break;
	}
	return { end: i, chdir, malformed, gitTargetOverride, gitConfigOverride };
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

function parseExecPrefix(tokens, start) {
	if (tokens[start]?.value !== "exec") return null;
	let i = start + 1;
	let unresolved = false;
	while (i < tokens.length) {
		const value = tokens[i].value;
		if (value === "--") return { end: i + 1, unresolved };
		if (!value.startsWith("-") || value === "-") break;
		for (let j = 1; j < value.length; j++) {
			if (value[j] === "a") {
				if (j === value.length - 1) {
					if (!tokens[i + 1]) unresolved = true;
					i++;
				}
				break;
			}
			if (!"cl".includes(value[j])) unresolved = true;
		}
		i++;
	}
	return { end: i, unresolved };
}

export function parseLeadingShellPrefix(tokens) {
	let i = 0;
	let unresolved = false;
	let gitTargetOverride = false;
	let gitConfigOverride = false;
	const envs = [];
	while (i < tokens.length) {
		const value = tokens[i].value;
		const executable = basename(value);
		if (["noglob", "nocorrect"].includes(value) && !tokens[i].quoted) {
			i++;
			continue;
		}
		const redirection = leadingRedirectionLength(tokens, i);
		if (redirection > 0) {
			i += redirection;
			continue;
		}
		if (/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(value)) {
			gitTargetOverride ||= isGitTargetAssignment(value);
			gitConfigOverride ||= isGitConfigAssignment(value);
			i++;
			continue;
		}
		if (executable === "env") {
			const env = parseEnvPrefix(tokens, i);
			envs.push(env);
			unresolved ||= env.malformed;
			gitTargetOverride ||= env.gitTargetOverride;
			gitConfigOverride ||= env.gitConfigOverride;
			i = env.end;
			continue;
		}
		const command = parseCommandPrefix(tokens, i);
		if (command !== null) {
			unresolved ||= command.unresolved;
			if (command.query)
				return {
					end: tokens.length,
					envs,
					unresolved,
					gitTargetOverride,
					gitConfigOverride,
				};
			i = command.end;
			continue;
		}
		const sudo = parseSudoPrefix(tokens, i);
		if (sudo !== null) {
			unresolved ||= sudo.unresolved;
			i = sudo.end;
			continue;
		}
		if (value === "builtin") {
			const next = i + (tokens[i + 1]?.value === "--" ? 2 : 1);
			if (["builtin", "command", "exec"].includes(tokens[next]?.value)) {
				i = next;
				continue;
			}
		}
		const exec = parseExecPrefix(tokens, i);
		if (exec !== null) {
			unresolved ||= exec.unresolved;
			i = exec.end;
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
			if (tokens[i]?.value === "--") i++;
			else if (tokens[i]?.value.startsWith("-")) unresolved = true;
			continue;
		}
		break;
	}
	return {
		end: i,
		envs,
		unresolved,
		gitTargetOverride,
		gitConfigOverride,
	};
}

// `FOO=bar cmd` and executable command prefixes still run cmd.
export function stripLeadingNoise(tokens) {
	return tokens.slice(parseLeadingShellPrefix(tokens).end);
}

export function gitSubcommandIndex(tokens) {
	for (let i = 1; i < tokens.length; i++) {
		const { value } = tokens[i];
		if (
			[...GIT_GLOBAL_FLAGS_WITH_VALUE].some(
				(flag) =>
					value.startsWith(`${flag}=`) ||
					(!tokens[i].dynamic &&
						["-C", "-c"].includes(flag) &&
						value.startsWith(flag) &&
						value.length > 2),
			)
		)
			continue;
		if (tokens[i].dynamic) return i;
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
	let method = null;
	let input = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--") break;
		const flag = arg.split("=", 1)[0];
		if (["-X", "--method"].includes(flag)) {
			method = arg.includes("=") ? arg.slice(flag.length + 1) : args[++i];
			if (method === undefined) return "UNKNOWN";
			continue;
		}
		if (/^-X.+/.test(arg)) {
			method = arg.slice(2);
			continue;
		}
		input ||=
			["-f", "-F", "--raw-field", "--field", "--input"].includes(flag) ||
			/^-[fF].+/.test(arg);
		if (GH_VALUE_FLAGS.has(arg)) i++;
	}
	return method ?? (input ? "POST" : "GET");
}

/**
 * Return a short label for the outward-facing command found in `command`, or
 * null when nothing in it publishes anything.
 * @param {string} command
 * @returns {string|null}
 */
export function findOutwardCommand(command) {
	if (typeof command !== "string" || command.trim() === "") return null;
	if (shellParseDecision(command)) return "unsupported shell syntax";

	for (const { tokens: raw } of readShellCommands(command)) {
		const tokens = stripLeadingNoise(raw);
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
			if (!parsed) {
				if (
					tokens
						.slice(1)
						.some((token) =>
							["--help", "-h", "--version"].includes(token.value),
						)
				)
					continue;
				return "gh";
			}
			if (hasHelpOption(parsed) || parsed.group === "help") continue;
			if (parsed.group === "browse") continue;
			if (parsed.group === "api") {
				const method = ghApiMethod(parsed.args);
				if (method.toUpperCase() !== "GET")
					return `gh api ${method.toUpperCase()}`;
				continue;
			}
			// An unrecognised or absent verb is treated as mutating: guessing
			// in the permissive direction is what this guard exists to prevent.
			if (parsed.verb === null) return `gh ${parsed.group}`;
			if (!READ_ONLY_GH_COMMANDS[parsed.group]?.includes(parsed.verb))
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
	{ allowedAgents = DEFAULT_ALLOWED_AGENTS, supportsAsk = true } = {},
) {
	if (payload?.tool_name === "Bash") {
		const failure = shellParseDecision(payload?.tool_input?.command);
		if (failure) return failure;
	}
	const effect = githubToolEffect(payload?.tool_name);
	const merge =
		effect === "merge"
			? payload.tool_name
			: payload?.tool_name === "Bash"
				? findMergeCommand(payload?.tool_input?.command, {
						readShellCommands,
						stripLeadingNoise,
					})
				: null;
	if (merge) return mergeDecision(merge, supportsAsk);
	if (effect && effect !== "read") {
		if (
			!supportsAsk ||
			(payload?.agent_id && !allowedAgents.includes(payload.agent_type))
		)
			return {
				decision: "deny",
				matched: payload.tool_name,
				reason:
					"GitHub MCP writes require a verified parent identity. This hook cannot establish that identity on Codex. Have the parent use its reviewed command publication route; do not route around a delegated-write rejection.",
			};
	}
	if (payload?.tool_name !== "Bash") return { decision: "allow" };

	// No agent_id means the caller itself, which owns review and publishing.
	// See the module header for why agent_id and not agent_type (#932).
	if (!payload?.agent_id) return { decision: "allow" };
	if (!supportsAsk) {
		for (const { tokens: raw } of readShellCommands(
			payload?.tool_input?.command,
		)) {
			const tokens = stripLeadingNoise(raw);
			const routine = classifyCodexGitRoutine(
				tokens.map((token) => token.value),
			);
			if (routine) {
				if (routine.childAllowed) continue;
				return {
					decision: "deny",
					matched: `codex-git-routine ${routine.verb ?? "unknown"}`,
					reason:
						"Codex Git metadata operations belong to the parent. Report the needed operation to the parent; continue with file edits and tests only.",
				};
			}
			if (!tokens.length || basename(tokens[0].value) !== "git") continue;
			const sub = gitSubcommand(tokens);
			const args = tokens
				.slice(gitSubcommandIndex(tokens) + 1)
				.map((token) => token.value);
			if (!isReadOnlyGitInvocation(sub, args))
				return {
					decision: "deny",
					matched: `git ${sub ?? "unknown"}`,
					reason:
						"Codex Git metadata operations belong to the parent. Report the needed operation to the parent; continue with file edits and tests only.",
				};
		}
	}

	// agent_type names which agent it is; the contract has it present whenever
	// agent_id is, so it needs no absence handling here.
	const agentType = payload?.agent_type;
	if (supportsAsk && allowedAgents.includes(agentType))
		return { decision: "allow" };

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
export function runDelegationGuard(inputText, options = {}) {
	const payload = parseHookPayload(inputText);
	if (!payload) return { shouldOutput: false };

	const result = evaluateDelegationGuard(payload, options);
	if (result.decision !== "allow") {
		return { shouldOutput: true, output: buildPermissionOutput(result) };
	}
	return { shouldOutput: false };
}
