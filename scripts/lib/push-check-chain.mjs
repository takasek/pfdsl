import { fileURLToPath } from "node:url";
import { SHELL_PARSER_TIMEOUT_MS } from "./agent-operation-timeouts.mjs";
import { run } from "./run-exec.mjs";
import { adaptShell, executableName } from "./shell-commands.mjs";
import { shellParserPath } from "./shell-parser-tool.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const reason =
	"This command can run git push without every preceding check succeeding. Checks must gate push through an && chain.";

const GIT_VALUE_OPTIONS = [
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--config-env",
	"--namespace",
];
const GIT_INFORMATION_OPTIONS = new Set([
	"--exec-path",
	"--html-path",
	"--man-path",
	"--info-path",
	"--version",
	"-v",
	"--help",
	"-h",
]);
const NODE_VALUE_OPTIONS = new Set([
	"-r",
	"--require",
	"--import",
	"--loader",
	"--experimental-loader",
	"-e",
	"--eval",
	"-p",
	"--print",
	"-C",
	"--conditions",
	"--test-name-pattern",
	"--test-skip-pattern",
	"--test-reporter",
	"--test-reporter-destination",
	"--test-concurrency",
	"--test-timeout",
]);

function gitSubcommand(args) {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (GIT_INFORMATION_OPTIONS.has(arg)) return null;
		if (GIT_VALUE_OPTIONS.includes(arg)) i++;
		else if (!arg.startsWith("-")) return arg;
	}
	return null;
}

function nodeTestMode(args) {
	let testMode = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		// Node options end at --, stdin, or the script entrypoint. Later argv
		// belongs to that script, not the Node test runner.
		if (arg === "--" || arg === "-" || !arg.startsWith("-")) break;
		if (arg === "--test") testMode = true;
		if (NODE_VALUE_OPTIONS.has(arg)) i++;
	}
	return testMode;
}

// Skip value-taking global options rather than mistaking their values for
// targets or subcommands. No aliases, dynamic argv or script files are expanded.
function operands(args, values) {
	const result = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (["-j", "--jobs"].includes(arg)) {
			if (/^\d+$/.test(args[i + 1] ?? "")) i++;
		} else if (values.includes(arg)) i++;
		else if (!arg.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))
			result.push(arg);
	}
	return result;
}

function kind(node) {
	const tokens = node.tokens.slice(node.executableIndex);
	const name = executableName(tokens[0]?.value ?? "");
	const args = tokens.slice(1).map(({ value }) => value);
	if (name === "git") return gitSubcommand(args) === "push" ? "push" : null;
	if (name === "node") return nodeTestMode(args) ? "check" : null;
	if (name === "make")
		return operands(args, [
			"-C",
			"--directory",
			"-f",
			"--file",
			"--makefile",
			"-I",
			"--include-dir",
			"-o",
			"--old-file",
			"--assume-old",
			"-W",
			"--what-if",
			"--new-file",
			"--assume-new",
		]).some((arg) => /^(?:test|typecheck|lint|coverage|check.*)$/.test(arg))
			? "check"
			: null;
	if (name === "pnpm") {
		const words = operands(args, ["-C", "--dir", "--filter", "-F"]);
		return ["test", "typecheck"].includes(
			words[0] === "run" ? words[1] : words[0],
		)
			? "check"
			: null;
	}
	return null;
}

/**
 * Repo-development syntax guard (#1486, option A). Inspect executable calls
 * and the source gaps between them, never quoted argument text. It deliberately
 * does not certify a tree, remember earlier tool calls, or inspect script files.
 * Compound constructs between a check and push require a plain && rewrite.
 */
export function checkPushChain(command) {
	if (typeof command !== "string" || !command.trim()) return null;
	let commands;
	const statements = new Map();
	const declarations = [];
	try {
		const ast = JSON.parse(
			run(shellParserPath(root), ["--to-json", "--language-dialect=zsh"], {
				input: command,
				captureStderr: true,
				timeout: SHELL_PARSER_TIMEOUT_MS,
			}),
		);
		function visit(node) {
			if (!node || typeof node !== "object") return;
			if (node.Type === "FuncDecl") {
				declarations.push([node.Pos.Offset, node.End.Offset]);
				return;
			}
			if (node.Cmd?.Type === "CallExpr")
				statements.set(node.Cmd.Pos.Offset, node);
			for (const value of Object.values(node)) {
				if (Array.isArray(value)) value.forEach(visit);
				else visit(value);
			}
		}
		visit(ast);
		// The shared operation adapter also lists function bodies for safety
		// classification. Declaring a function does not execute those calls.
		commands = adaptShell(ast, command).commands.filter(
			(node) =>
				!declarations.some(
					([start, end]) => node.offset >= start && node.offset < end,
				),
		);
	} catch {
		// ADR-0047: the operation guard alone denies parser failures and owns
		// fixed-root recovery. This content guard judges only parsed commands.
		return null;
	}
	const bytes = Buffer.from(command);
	let sawCheck = false;
	let broken = false;
	let previous;
	for (const node of commands) {
		const stmt = statements.get(node.offset);
		if (sawCheck && previous) {
			// A statement can start with a redirection before its executable.
			const gap = bytes
				.subarray(previous.end, stmt?.Pos.Offset ?? node.offset)
				.toString();
			const whitespace = String.raw`(?:\s|\\\n|#[^\n]*(?:\n|$))*`;
			broken ||= !new RegExp(`^${whitespace}&&${whitespace}$`).test(gap);
		}
		const type = kind(node);
		if (type === "push" && sawCheck && broken)
			return { decision: "deny", reason };
		sawCheck ||= type === "check";
		if (sawCheck && (stmt?.Negated || stmt?.Background)) broken = true;
		previous = {
			end: Math.max(
				node.offset + Buffer.byteLength(node.command),
				...(stmt?.Redirs ?? []).map((redir) => redir.End.Offset),
			),
		};
	}
	return null;
}
