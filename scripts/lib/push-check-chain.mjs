import { fileURLToPath } from "node:url";
import { SHELL_PARSER_TIMEOUT_MS } from "./agent-operation-timeouts.mjs";
import { run } from "./run-exec.mjs";
import { adaptShell, executableName } from "./shell-commands.mjs";
import { shellParserPath } from "./shell-parser-tool.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const reason =
	"Push is not gated by every preceding check's success. Rewrite the command so checks and push are connected by && and a failed check prevents push, then retry.";

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
	if (name === "git")
		return operands(args, [
			"-C",
			"-c",
			"--git-dir",
			"--work-tree",
			"--config-env",
			"--namespace",
		])[0] === "push"
			? "push"
			: null;
	if (name === "node") return args.includes("--test") ? "check" : null;
	if (name === "make")
		return operands(args, ["-C", "--directory", "-f", "--file"]).some((arg) =>
			/^(?:test|typecheck|lint|coverage|check.*)$/.test(arg),
		)
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
			if (node.Cmd?.Type === "CallExpr")
				statements.set(node.Cmd.Pos.Offset, node);
			for (const value of Object.values(node)) {
				if (Array.isArray(value)) value.forEach(visit);
				else visit(value);
			}
		}
		visit(ast);
		commands = adaptShell(ast, command).commands;
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
			const gap = bytes.subarray(previous.end, node.offset).toString();
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
