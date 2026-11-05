// Grammar comes exclusively from mvdan/sh. This adapter exposes executable
// commands; it never executes or expands the submitted shell.

import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./run-exec.mjs";
import { shellParserPath } from "./shell-parser-tool.mjs";

const SHELL_PARSER_TIMEOUT_MS = 3000;

const root = fileURLToPath(new URL("../../", import.meta.url));

/** Literal executable spelling on the supported POSIX command path. */
export function executableName(value) {
	return basename(value);
}

export function readShell(
	command,
	{ parserPath = shellParserPath(root) } = {},
) {
	if (typeof command !== "string" || command.trim() === "")
		return { commands: [] };
	let result;
	try {
		const ast = JSON.parse(
			run(parserPath, ["--to-json", "--language-dialect=zsh"], {
				input: command,
				captureStderr: true,
				timeout: SHELL_PARSER_TIMEOUT_MS,
			}),
		);
		if (
			ast?.Type !== "File" ||
			(ast.Stmts !== undefined && !Array.isArray(ast.Stmts))
		)
			throw new SyntaxError("Invalid shell parser AST root");
		result = adaptShell(ast, command);
		expandLiteralScripts(result, parserPath);
	} catch (error) {
		const unavailable = error.code === "ENOENT";
		const timedOut = error.code === "ETIMEDOUT";
		const parserFailure =
			Boolean(error.code) ||
			error instanceof SyntaxError ||
			error instanceof TypeError ||
			(Number.isInteger(error.status) && error.status !== 1);
		const diagnostic = String(error.stderr || error.message)
			.trim()
			.slice(0, 300);
		result = {
			parserFailure,
			...(error.commands ? { commands: error.commands } : {}),
			failure: unavailable
				? "parser-missing"
				: timedOut
					? "parser-timeout"
					: parserFailure
						? "parser"
						: "syntax",
			error: unavailable
				? "The pinned shell parser is missing. Run make setup in this checkout and retry."
				: timedOut
					? "Shell parsing was temporarily delayed. Retry the same command."
					: parserFailure
						? `Cannot run the pinned shell parser: ${diagnostic}. Repair the parser before retrying.`
						: `Cannot parse or inspect this shell command: ${diagnostic}. Rewrite it using ordinary simple commands, if/for/while, or explicit paths.`,
		};
	}
	return result;
}

function expandLiteralScripts(result, parserPath) {
	const expanded = [];
	for (const node of result.commands) {
		expanded.push(node);
		const tokens = node.tokens.slice(node.executableIndex);
		const name = executableName(tokens[0]?.value ?? "");
		let scriptIndex = name === "eval" ? (tokens[1]?.value === "--" ? 2 : 1) : 0;
		if (["bash", "sh", "zsh"].includes(name)) {
			let commandStringMode = false;
			for (let i = 1; i < tokens.length; i++) {
				const flag = tokens[i];
				if (flag.value === "--") {
					if (commandStringMode) scriptIndex = i + 1;
					break;
				}
				if (flag.dynamic || !/^[+-]/.test(flag.value)) {
					if (commandStringMode) scriptIndex = i;
					break;
				}
				if (/^-[A-Za-z]*c[A-Za-z]*$/.test(flag.value)) {
					commandStringMode = true;
				}
				if (
					["-o", "+o", "-O", "+O", "--rcfile", "--init-file"].includes(
						flag.value,
					)
				)
					i++;
			}
			if (commandStringMode && !scriptIndex) {
				expanded.push({ ...node, unresolvedExecution: true });
				continue;
			}
		}
		if (!scriptIndex) continue;
		const scriptTokens =
			name === "eval"
				? tokens.slice(scriptIndex)
				: tokens.slice(scriptIndex, scriptIndex + 1);
		if (!scriptTokens.length || scriptTokens.some(({ dynamic }) => dynamic)) {
			expanded.push({ ...node, unresolvedExecution: true });
			continue;
		}
		const inner = readShell(scriptTokens.map(({ value }) => value).join(" "), {
			parserPath,
		});
		expanded.push(...(inner.commands ?? []));
		if (inner.error) {
			result.error = inner.error;
			result.failure = inner.failure;
			expanded.push({ ...node, unresolvedExecution: true });
		}
	}
	result.commands = expanded;
}

export function adaptShell(ast, source) {
	const bytes = Buffer.from(source);
	const text = (node) =>
		bytes.subarray(node.Pos.Offset, node.End.Offset).toString();
	const commands = [];
	const fail = (type) => {
		const error = new Error(`Unsupported shell construct ${type}.`);
		error.commands = commands;
		throw error;
	};

	function word(node) {
		let quoted = false;
		let dynamic = false;
		let multipleWords = false;
		let quote;
		function part(p, inDouble = false) {
			switch (p.Type) {
				case "Lit":
					if (
						!inDouble &&
						/[~*?[\]{}]/.test(p.Value.replace(/\\[\s\S]/g, ""))
					) {
						dynamic = true;
						multipleWords ||= /[*?[]|\{[^}]*[,.][^}]*\}/.test(
							p.Value.replace(/\\[\s\S]/g, ""),
						);
					}
					return p.Value.replace(
						inDouble ? /\\([\\$`"\n])/g : /\\([\s\S])/g,
						(_, ch) => (ch === "\n" ? "" : ch),
					);
				case "SglQuoted":
					quoted = true;
					quote = "'";
					if (p.Dollar) {
						dynamic = true;
						return text(p);
					}
					return p.Value;
				case "DblQuoted":
					quoted = true;
					quote = '"';
					if (p.Dollar) {
						dynamic = true;
						return text(p);
					}
					return (p.Parts ?? []).map((p) => part(p, true)).join("");
				case "ParamExp":
					dynamic = true;
					multipleWords ||=
						!inDouble ||
						Boolean(p.Index || p.Excl || p.Names) ||
						p.Param?.Value === "@";
					for (const nested of p.Exp?.Word?.Parts ?? []) part(nested, inDouble);
					return text(p);
				default:
					dynamic = true;
					multipleWords ||=
						!inDouble && !["ArithmExp", "ProcSubst"].includes(p.Type);
					return text(p);
			}
		}
		const value = (node.Parts ?? []).map((p) => part(p)).join("");
		const token = { value, quoted };
		if (node.Parts?.length === 1 && quoted) token.quote = quote;
		if (dynamic) token.dynamic = true;
		if (multipleWords) token.multipleWords = true;
		return token;
	}

	function assign(node) {
		if (node.Naked)
			return node.Value
				? word(node.Value)
				: { value: node.Name.Value, quoted: false };
		if (node.Array || node.Index)
			return {
				value: `${node.Name.Value}=${text(node)}`,
				quoted: false,
				dynamic: true,
			};
		const value = node.Value ? word(node.Value) : { value: "", quoted: false };
		// Assignment values are not argv words and do not undergo word splitting.
		delete value.multipleWords;
		return {
			...value,
			value: `${node.Name.Value}${node.Append ? "+=" : "="}${value.value}`,
		};
	}

	// Only substitutions contain executable statements inside words. Patterns,
	// quoted heredoc text and ordinary literal arguments never become commands.
	function substitutions(node) {
		if (!node || typeof node !== "object") return;
		if (["CmdSubst", "ProcSubst"].includes(node.Type)) {
			(node.Stmts ?? []).forEach(statement);
			return;
		}
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) value.forEach(substitutions);
			else substitutions(value);
		}
	}

	function hasNode(node, type) {
		if (!node || typeof node !== "object") return false;
		return (
			node.Type === type ||
			Object.values(node).some((value) =>
				Array.isArray(value)
					? value.some((node) => hasNode(node, type))
					: hasNode(value, type),
			)
		);
	}

	function leaf(node, tokens) {
		let prefix = tokens.findIndex(
			(token) =>
				!["noglob", "nocorrect"].includes(token.value) &&
				!/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(token.value),
		);
		while (["command", "builtin"].includes(tokens[prefix]?.value)) {
			prefix++;
			if (["-p", "--"].includes(tokens[prefix]?.value)) prefix++;
		}
		let unresolvedExecution = false;
		// Ordinary executable prefixes only; no shell state, clusters or argv
		// oracle. Unknown prefix options are unresolved, not guessed programs.
		while (
			["env", "sudo", "time", "nohup"].includes(
				executableName(tokens[prefix]?.value ?? ""),
			)
		) {
			const wrapper = executableName(tokens[prefix++].value);
			const values =
				wrapper === "env"
					? ["-C", "--chdir", "-u", "--unset", "-P"]
					: wrapper === "sudo"
						? ["-u", "--user", "-g", "--group", "-p", "--prompt"]
						: wrapper === "time"
							? ["-o", "--output", "-f", "--format"]
							: [];
			const booleans =
				wrapper === "env"
					? ["-i", "--ignore-environment", "-0", "--null", "-v", "--debug"]
					: wrapper === "sudo"
						? ["-n", "--non-interactive", "-E", "--preserve-env"]
						: wrapper === "time"
							? ["-a", "--append", "-p", "--portability"]
							: [];
			while (prefix < tokens.length) {
				const value = tokens[prefix].value;
				if (wrapper === "env" && /^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) {
					prefix++;
					continue;
				}
				if (value === "--") {
					prefix++;
					break;
				}
				const flag = value.split("=", 1)[0];
				if (values.includes(flag)) {
					prefix += value.includes("=") ? 1 : 2;
					if (prefix > tokens.length) unresolvedExecution = true;
					continue;
				}
				if (booleans.includes(value)) {
					prefix++;
					continue;
				}
				if (value.startsWith("-")) unresolvedExecution = true;
				break;
			}
			if (unresolvedExecution) break;
		}
		if (["repeat", "always", "coproc", "-"].includes(tokens[prefix]?.value))
			fail(tokens[prefix].value);
		const command = {
			tokens,
			executableIndex: prefix,
			unresolvedExecution,
			command: text(node),
			offset: node.Pos.Offset,
		};
		commands.push(command);
	}

	function statement(stmt) {
		const cmd = stmt.Cmd;
		substitutions(stmt.Redirs);
		if (!cmd) return;
		for (const redir of stmt.Redirs ?? []) {
			if (!redir.Hdoc) continue;
			const head = cmd.Args?.[0] ? word(cmd.Args[0]).value : "";
			// A shell can execute a heredoc as a program. Its body belongs to another
			// language invocation, so require an explicit script rather than guess.
			const args = (cmd.Args ?? []).map(word).map(({ value }) => value);
			let gitSubcommand = 1;
			if (head === "git")
				while (args[gitSubcommand]?.startsWith("-")) {
					if (["-C", "-c", "--config-env"].includes(args[gitSubcommand]))
						gitSubcommand++;
					gitSubcommand++;
				}
			const stdinValue = (flags) =>
				args.some(
					(arg, i) =>
						(flags.includes(arg) && args[i + 1] === "-") ||
						flags.some((flag) => arg === `${flag}=-`),
				);
			const reader =
				["cat", "tee"].includes(head) ||
				(head === "git" &&
					["commit", "tag"].includes(args[gitSubcommand]) &&
					stdinValue(["-F", "--file"])) ||
				(head === "gh" &&
					["pr", "issue", "api"].includes(args[1]) &&
					stdinValue(["-F", "--body-file", "--input"]));
			if (
				!reader ||
				hasNode(cmd, "ProcSubst") ||
				hasNode(stmt.Redirs, "ProcSubst")
			)
				fail("executable or unknown heredoc; use a script file");
		}
		switch (cmd.Type) {
			case "CallExpr":
				substitutions(cmd.Assigns);
				substitutions(cmd.Args);
				leaf(cmd, [
					...(cmd.Assigns ?? []).map(assign),
					...(cmd.Args ?? []).map(word),
				]);
				break;
			case "DeclClause":
				substitutions(cmd.Args);
				leaf(cmd, [
					{ value: cmd.Variant.Value, quoted: false },
					...(cmd.Args ?? []).map(assign),
				]);
				break;
			case "BinaryCmd": {
				const right = cmd.Y.Cmd?.Args?.[0];
				if (
					["|", "|&"].includes(cmd.Op) &&
					JSON.stringify(cmd).includes('"Hdoc"') &&
					(!right || !["cat", "tee", "git", "gh"].includes(word(right).value))
				)
					fail("heredoc pipeline into an unknown program; use a script file");
				statement(cmd.X);
				statement(cmd.Y);
				break;
			}
			case "Block":
			case "Subshell":
				(cmd.Stmts ?? []).forEach(statement);
				break;
			case "IfClause":
				(cmd.Cond ?? []).forEach(statement);
				(cmd.Then ?? []).forEach(statement);
				if (cmd.Else) statement({ Cmd: { ...cmd.Else, Type: "IfClause" } });
				break;
			case "WhileClause":
				(cmd.Cond ?? []).forEach(statement);
				(cmd.Do ?? []).forEach(statement);
				break;
			case "ForClause":
				substitutions(cmd.Loop);
				(cmd.Do ?? []).forEach(statement);
				break;
			case "CaseClause":
				substitutions(cmd.Word);
				for (const item of cmd.Items ?? []) {
					substitutions(item.Patterns);
					(item.Stmts ?? []).forEach(statement);
				}
				break;
			case "FuncDecl":
				statement(cmd.Body);
				break;
			case "TimeClause":
				if (
					cmd.Stmt.Cmd?.Type === "CallExpr" &&
					cmd.Stmt.Cmd.Args?.[0] &&
					word(cmd.Stmt.Cmd.Args[0]).value.startsWith("-")
				) {
					leaf(cmd, [
						{ value: "time", quoted: false },
						...cmd.Stmt.Cmd.Args.map(word),
					]);
					substitutions(cmd.Stmt);
				} else statement(cmd.Stmt);
				break;
			case "CoprocClause":
				statement(cmd.Stmt);
				break;
			case "TestClause":
			case "ArithmCmd":
				substitutions(cmd);
				break;
			default:
				fail(cmd.Type);
		}
	}

	(ast.Stmts ?? []).forEach(statement);
	return { commands };
}
