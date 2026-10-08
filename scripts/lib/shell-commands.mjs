// Grammar comes exclusively from mvdan/sh. This adapter exposes executable
// commands and their scopes; it never executes or expands the submitted shell.
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
		return { flow: { kind: "sequence", children: [] }, commands: [] };
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
		result = adaptShell(ast, command);
	} catch (error) {
		const unavailable = error.code === "ENOENT";
		result = {
			error: unavailable
				? "The pinned shell parser is missing. Run make setup in this checkout and retry."
				: `Cannot parse or inspect this shell command: ${String(
						error.stderr || error.message,
					)
						.trim()
						.slice(
							0,
							300,
						)} Rewrite it using ordinary simple commands, if/for/while, or explicit paths. Unsupported syntax is not allowed through.`,
		};
	}
	if (parserPath === shellParserPath(root)) {
		cachedSource = command;
		cachedResult = result;
	}
	return result;
}

export function shellParseDecision(command) {
	const { error } = readShell(command);
	return error
		? { decision: "deny", matched: "shell syntax", reason: error }
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
	const sequence = (children) => ({ kind: "sequence", children });
	const scope = (kind, children) => ({ kind, children });
	const fail = (type) => {
		throw new Error(`Unsupported shell construct ${type}.`);
	};

	function word(node) {
		let quoted = false;
		let dynamic = false;
		let quote;
		function part(p, inDouble = false) {
			switch (p.Type) {
				case "Lit":
					if (!inDouble && /[~*?[\]{}]/.test(p.Value.replace(/\\[\s\S]/g, "")))
						dynamic = true;
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
				default:
					dynamic = true;
					return text(p);
			}
		}
		const value = (node.Parts ?? []).map((p) => part(p)).join("");
		const token = { value, quoted };
		if (node.Parts?.length === 1 && quoted) token.quote = quote;
		if (dynamic) token.dynamic = true;
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
		return {
			...value,
			value: `${node.Name.Value}${node.Append ? "+=" : "="}${value.value}`,
		};
	}

	// Only substitutions contain executable statements inside words. Patterns,
	// quoted heredoc text and ordinary literal arguments never become commands.
	function substitutions(node) {
		if (!node || typeof node !== "object") return [];
		if (["CmdSubst", "ProcSubst"].includes(node.Type))
			return [scope("isolated", (node.Stmts ?? []).map(statement))];
		return Object.values(node).flatMap((value) =>
			Array.isArray(value)
				? value.flatMap(substitutions)
				: substitutions(value),
		);
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
				!/^[A-Za-z_][A-Za-z0-9_]*=/.test(token.value),
		);
		if (["repeat", "always", "coproc", "-"].includes(tokens[prefix]?.value))
			fail(tokens[prefix].value);
		if (tokens[prefix]?.dynamic)
			fail("dynamic executable; use a literal command name");
		const command = { kind: "command", tokens, command: text(node) };
		commands.push(command);
		return command;
	}

	function statement(stmt) {
		const cmd = stmt.Cmd;
		if (!cmd) return sequence(substitutions(stmt.Redirs));
		const children = substitutions(stmt.Redirs);
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
		let flow;
		switch (cmd.Type) {
			case "CallExpr":
				children.push(
					...substitutions(cmd.Assigns),
					...substitutions(cmd.Args),
				);
				flow = leaf(cmd, [
					...(cmd.Assigns ?? []).map(assign),
					...(cmd.Args ?? []).map(word),
				]);
				break;
			case "DeclClause":
				children.push(...substitutions(cmd.Args));
				flow = leaf(cmd, [
					{ value: cmd.Variant.Value, quoted: false },
					...(cmd.Args ?? []).map(assign),
				]);
				break;
			case "BinaryCmd":
				if (
					["|", "|&"].includes(cmd.Op) &&
					JSON.stringify(cmd).includes('"Hdoc"')
				) {
					const right = cmd.Y.Cmd?.Args?.[0];
					if (
						!right ||
						!["cat", "tee", "git", "gh"].includes(word(right).value)
					)
						fail("heredoc pipeline into an unknown program; use a script file");
				}
				flow = scope(
					cmd.Op === "&&" ? "and" : cmd.Op === "||" ? "uncertain" : "pipeline",
					[statement(cmd.X), statement(cmd.Y)],
				);
				break;
			case "Block":
				flow = scope("uncertain", (cmd.Stmts ?? []).map(statement));
				break;
			case "Subshell":
				flow = scope("isolated", (cmd.Stmts ?? []).map(statement));
				break;
			case "IfClause":
				flow = scope("uncertain", [
					...(cmd.Cond ?? []).map(statement),
					...(cmd.Then ?? []).map(statement),
					...(cmd.Else
						? [statement({ Cmd: { ...cmd.Else, Type: "IfClause" } })]
						: []),
				]);
				break;
			case "WhileClause":
				flow = scope("uncertain", [
					...(cmd.Cond ?? []).map(statement),
					...(cmd.Do ?? []).map(statement),
				]);
				break;
			case "ForClause":
				flow = scope("uncertain", [
					...substitutions(cmd.Loop),
					...(cmd.Do ?? []).map(statement),
				]);
				break;
			case "CaseClause":
				flow = scope("uncertain", [
					...substitutions(cmd.Word),
					...(cmd.Items ?? []).flatMap((item) => [
						...substitutions(item.Patterns),
						...(item.Stmts ?? []).map(statement),
					]),
				]);
				break;
			case "FuncDecl":
				flow = scope("definition", [statement(cmd.Body)]);
				break;
			case "TimeClause":
				if (
					cmd.Stmt.Cmd?.Type === "CallExpr" &&
					cmd.Stmt.Cmd.Args?.[0] &&
					word(cmd.Stmt.Cmd.Args[0]).value.startsWith("-")
				) {
					flow = leaf(cmd, [
						{ value: "time", quoted: false },
						...cmd.Stmt.Cmd.Args.map(word),
					]);
					children.push(...substitutions(cmd.Stmt));
				} else flow = statement(cmd.Stmt);
				break;
			case "CoprocClause":
				flow = scope(cmd.Type === "CoprocClause" ? "isolated" : "sequence", [
					statement(cmd.Stmt),
				]);
				break;
			case "TestClause":
			case "ArithmCmd":
				flow = sequence(substitutions(cmd));
				break;
			default:
				fail(cmd.Type);
		}
		children.push(flow);
		return stmt.Background
			? scope("isolated", children)
			: stmt.Negated
				? scope("uncertain", children)
				: children.length === 1
					? children[0]
					: sequence(children);
	}
	const flow = sequence((ast.Stmts ?? []).map(statement));
	return { flow, commands };
}
