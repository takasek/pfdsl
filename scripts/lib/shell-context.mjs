// Resolve a finite operation contract, without predicting shell state clears.
// State setters and compound control flow mixed with protected commands stay
// unresolved. Split those operations into separate tool calls instead.
import { basename } from "node:path";
import {
	gitSubcommandIndex,
	parseLeadingShellPrefix,
	splitCommandFlow,
	stripLeadingNoise,
	tokenize,
} from "./delegation-guard.mjs";
import { GIT_TARGET_ENVIRONMENT_VARIABLES } from "./git-environment.mjs";

export function shellStartCwd(payload, payloadCwdIsExecutionCwd) {
	return payloadCwdIsExecutionCwd &&
		typeof payload?.cwd === "string" &&
		payload.cwd.startsWith("/")
		? payload.cwd
		: null;
}

export function staticPath(token) {
	if (!token) return null;
	if (token.quoted)
		return token.quote === "'" || !/[$`]/.test(token.value)
			? token.value
			: null;
	return /[$~*?`]/.test(token.value) ? null : token.value;
}

export function resolveCwdPath(token, cwd) {
	const target = staticPath(token);
	if (target === null || target === "") return null;
	return target.startsWith("/")
		? target
		: cwd === null
			? null
			: `${cwd}/${target}`;
}

const STATE_COMMANDS = new Set([
	"set",
	"shopt",
	"alias",
	"unalias",
	"trap",
	"enable",
	"disable",
	"hash",
	"unhash",
	"setopt",
	"unsetopt",
	"emulate",
	"export",
	"unset",
	"readonly",
	"declare",
	"typeset",
	"local",
	"source",
	".",
	"eval",
	"read",
]);
const CONTROL_WORDS = new Set([
	"{",
	"}",
	"if",
	"then",
	"else",
	"elif",
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
	"pushd",
	"popd",
	"builtin",
]);
const protectedAssignment = (value) => {
	const name = value.split("=", 1)[0];
	return (
		value.includes("=") &&
		(name === "CDPATH" ||
			GIT_TARGET_ENVIRONMENT_VARIABLES.includes(name) ||
			/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name) ||
			["SHELLOPTS", "BASHOPTS", "POSIXLY_CORRECT"].includes(name))
	);
};

/** State-changing Git operations invalidate later probes in this tool call. */
function changesRepositoryContext(tokens) {
	const command = stripLeadingNoise(tokens);
	if (basename(command[0]?.value ?? "") === "codex-git-routine.mjs")
		return command[1]?.value === "branch-rename";
	if (basename(command[0]?.value ?? "") !== "git") return false;
	const at = gitSubcommandIndex(command);
	if (at === null) return false;
	const subcommand = command[at].value;
	const args = command.slice(at + 1).map((token) => token.value);
	if (
		["switch", "checkout", "update-ref", "init", "clone"].includes(subcommand)
	)
		return true;
	if (subcommand === "branch") {
		if (args.length === 0) return false;
		if (
			args.some((arg) =>
				/^(?:-[mMcCdDf]|--(?:move|copy|delete|force|set-upstream|unset-upstream))/.test(
					arg,
				),
			)
		)
			return true;
		return !args.some((arg) =>
			[
				"--show-current",
				"--list",
				"-l",
				"-a",
				"--all",
				"-r",
				"--remotes",
			].includes(arg),
		);
	}
	if (subcommand === "symbolic-ref")
		return (
			args.some(
				(arg) =>
					arg.startsWith("-") && !["-q", "--quiet", "--short"].includes(arg),
			) || args.filter((arg) => !arg.startsWith("-")).length > 1
		);
	const verb = args.find((arg) => !arg.startsWith("-"));
	if (subcommand === "remote")
		return verb !== undefined && !["show", "get-url"].includes(verb);
	if (subcommand === "worktree") return verb !== "list";
	return false;
}

export function analyzeShellContext(
	command,
	initialCwd,
	{ ambientCdPath = false, ambientGitTargetOverride = false } = {},
) {
	if (typeof command !== "string")
		return { segments: [], finalCwd: initialCwd };
	let cwd = initialCwd;
	let explicitCwd = false;
	let unsupportedState = false;
	let repositoryContextChanged = false;
	let cwdDependsOnAndList = false;
	const segments = [];
	const flow = splitCommandFlow(command);
	for (let index = 0; index < flow.length; index++) {
		const { command: text, separatorBefore } = flow[index];
		if ([";", "\n"].includes(separatorBefore) && cwdDependsOnAndList) {
			cwd = null;
			explicitCwd = false;
			cwdDependsOnAndList = false;
		}
		if (["(", ")", "||", "|", "&"].includes(separatorBefore))
			unsupportedState = true;
		const raw = tokenize(text);
		const prefix = parseLeadingShellPrefix(raw);
		const tokens = raw.slice(prefix.end);
		const head = tokens[0]?.value ?? "";
		const stateCommand =
			STATE_COMMANDS.has(head) ||
			(head === "printf" && tokens.slice(1).some((t) => /^-v/.test(t.value)));
		unsupportedState ||=
			stateCommand ||
			CONTROL_WORDS.has(head) ||
			raw.some((t) => protectedAssignment(t.value));
		if (tokens.length === 0) continue;
		if (head === "cd" && prefix.end === 0) {
			const args = tokens.slice(1);
			if (args[0]?.value === "--") args.shift();
			const target = staticPath(args[0]);
			const onlyPathAndRedirects = args
				.slice(1)
				.every((t) => /^(?:[0-9]*>>?|&>>?)/.test(t.value));
			cwd =
				target &&
				target !== "-" &&
				// Shell cd is logical by default, unlike Git -C / env -C.
				// Require a canonical path rather than predict PWD and shell mode.
				!target.split("/").includes("..") &&
				onlyPathAndRedirects &&
				flow[index + 1]?.separatorBefore === "&&" &&
				!prefix.unresolved
					? target.startsWith("/")
						? target
						: ambientCdPath
							? null
							: resolveCwdPath(args[0], cwd)
					: null;
			explicitCwd = true;
			cwdDependsOnAndList = true;
			continue;
		}
		let effectiveCwd = cwd;
		let explicit = explicitCwd;
		for (const env of prefix.envs) {
			if (env.chdir !== undefined) {
				effectiveCwd = resolveCwdPath(env.chdir, effectiveCwd);
				explicit = true;
			}
		}
		segments.push({
			command: text.trim(),
			tokens,
			cwd: effectiveCwd,
			explicitCwd: explicit,
			unresolved:
				unsupportedState || repositoryContextChanged || prefix.unresolved,
			gitTargetOverride: ambientGitTargetOverride || prefix.gitTargetOverride,
		});
		repositoryContextChanged ||= changesRepositoryContext(tokens);
	}
	return { segments, finalCwd: cwd };
}
