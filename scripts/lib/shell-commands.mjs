// Grammar comes exclusively from mvdan/sh. This adapter exposes executable
// commands; it never executes or expands the submitted shell.
import { fileURLToPath } from "node:url";
import { run } from "./run-exec.mjs";
import { shellParserPath } from "./shell-parser-tool.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
let cachedSource;
let cachedResult;

export function readShell(
	command,
	{ parserPath = shellParserPath(root) } = {},
) {
	if (typeof command !== "string" || command.trim() === "")
		return { commands: [] };
	if (parserPath === shellParserPath(root) && command === cachedSource)
		return cachedResult;
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
			error: unavailable
				? "The pinned shell parser is missing. Run make setup in this checkout and retry."
				: parserFailure
					? `Cannot run the pinned shell parser: ${diagnostic}. Repair the parser before retrying.`
					: `Cannot parse or inspect this shell command: ${diagnostic}. Rewrite it using ordinary simple commands, if/for/while, or explicit paths.`,
		};
	}
	if (parserPath === shellParserPath(root)) {
		cachedSource = command;
		cachedResult = result;
	}
	return result;
}

export function shellParseDecision(
	command,
	{ supportsAsk = true, parserPath } = {},
) {
	const { error, parserFailure } = readShell(command, { parserPath });
	return error
		? {
				decision: supportsAsk && !parserFailure ? "ask" : "deny",
				matched: "shell syntax",
				reason: error,
			}
		: null;
}

export function readShellCommands(command) {
	const result = readShell(command);
	return result.commands ?? [];
}

function adaptShell(ast, source) {
	const bytes = Buffer.from(source);
	const text = (node) =>
		bytes.subarray(node.Pos.Offset, node.End.Offset).toString();
	const commands = [];
	const fail = (type) => {
		throw new Error(`Unsupported shell construct ${type}.`);
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
		const prefix = tokens.findIndex(
			(token) =>
				!["noglob", "nocorrect"].includes(token.value) &&
				!/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(token.value),
		);
		if (["repeat", "always", "coproc", "-"].includes(tokens[prefix]?.value))
			fail(tokens[prefix].value);
		if (tokens[prefix]?.dynamic)
			fail("dynamic executable; use a literal command name");
		const command = { tokens, command: text(node) };
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
			const stdinValue = (flags) =>
				args.some(
					(arg, i) =>
						(flags.includes(arg) && args[i + 1] === "-") ||
						flags.some((flag) => arg === `${flag}=-`),
				);
			const reader =
				["cat", "tee"].includes(head) ||
				(head === "git" &&
					["commit", "tag"].includes(args[1]) &&
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
