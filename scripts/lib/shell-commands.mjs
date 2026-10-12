// Grammar comes exclusively from mvdan/sh. This adapter exposes executable
// commands; it never executes or expands the submitted shell.

import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./run-exec.mjs";
import { shellParserPath } from "./shell-parser-tool.mjs";

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
				timeout: 1000,
			}),
		);
		if (
			ast?.Type !== "File" ||
			(ast.Stmts !== undefined && !Array.isArray(ast.Stmts))
		)
			throw new SyntaxError("Invalid shell parser AST root");
		result = adaptShell(ast, command);
	} catch (error) {
		const unavailable = error.code === "ENOENT";
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
				: parserFailure
					? "parser"
					: "syntax",
			error: unavailable
				? "The pinned shell parser is missing. Run make setup in this checkout and retry."
				: parserFailure
					? `Cannot run the pinned shell parser: ${diagnostic}. Repair the parser before retrying.`
					: `Cannot parse or inspect this shell command: ${diagnostic}. Rewrite it using ordinary simple commands, if/for/while, or explicit paths.`,
		};
	}
	return result;
}

export function shellParseDecision(command, { parserPath } = {}) {
	const { error, parserFailure } = readShell(command, { parserPath });
	return error
		? {
				decision: "deny",
				matched: "shell syntax",
				reason: error,
				recovery: parserFailure ? "terminal" : "rewrite",
			}
		: null;
}

export function readShellCommands(command) {
	const result = readShell(command);
	return result.commands ?? [];
}

export function adaptShell(ast, source) {
	const bytes = Buffer.from(source);
	const text = (node) =>
		bytes.subarray(node.Pos.Offset, node.End.Offset).toString();
	const commands = [];
	const leadingCd = [];
	const prefixNodes = new Set();
	const flattenAnd = (stmt) =>
		!stmt?.Negated &&
		!stmt?.Background &&
		stmt?.Cmd?.Type === "BinaryCmd" &&
		stmt.Cmd.Op === "&&"
			? [...flattenAnd(stmt.Cmd.X), ...flattenAnd(stmt.Cmd.Y)]
			: [stmt];
	const initial = flattenAnd(ast.Stmts?.[0]);
	for (let i = 0; i < initial.length - 1; i++) {
		const stmt = initial[i];
		const args = stmt?.Cmd?.Type === "CallExpr" ? stmt.Cmd.Args?.map(word) : [];
		if (
			stmt?.Negated ||
			stmt?.Background ||
			stmt?.Redirs?.length ||
			stmt?.Cmd?.Assigns?.length ||
			args?.length !== 2 ||
			args[0]?.value !== "cd" ||
			args[1]?.value.startsWith("-") ||
			args.some(({ dynamic }) => dynamic)
		)
			break;
		leadingCd.push(args[1].value);
		prefixNodes.add(stmt.Cmd.Pos.Offset);
	}
	const fail = (type) => {
		const error = new Error(`Unsupported shell construct ${type}.`);
		// Keep observed commands for composition, but never claim a cwd after
		// an incomplete traversal. The syntax decision remains deny.
		error.commands = commands.map((command) => ({
			...command,
			leadingCd: [],
			unresolvedCwd: true,
		}));
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
		let prefixCwd = false;
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
					prefixCwd ||= wrapper === "env" && ["-C", "--chdir"].includes(flag);
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
			unresolvedCwd: prefixCwd,
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
	const unresolvedCwd = commands.some(
		({ tokens, executableIndex, offset }) =>
			tokens[executableIndex]?.value === "cd" && !prefixNodes.has(offset),
	);
	for (const command of commands) {
		command.isLeadingCd = prefixNodes.has(command.offset);
		const withinPrefixChain =
			ast.Stmts?.[0] &&
			command.offset >= ast.Stmts[0].Pos.Offset &&
			command.offset < ast.Stmts[0].End.Offset;
		command.leadingCd = withinPrefixChain ? [...leadingCd] : [];
		command.unresolvedCwd ||=
			unresolvedCwd || (leadingCd.length > 0 && !withinPrefixChain);
	}
	return { commands };
}
