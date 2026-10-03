// Guard effective cwd for supported verification commands. An absolute Node
// script path selects the script, not process.cwd(). Codex's payload cwd is
// the session root; Claude's is the shell start. Neither proves ownership.
// Eval source and arbitrary shell/program writes are outside this guard.

import { basename } from "node:path";
import { buildPermissionOutput, parseHookPayload } from "./hook-io.mjs";
import {
	analyzeShellContext,
	resolveCwdPath,
	shellStartCwd,
} from "./shell-context.mjs";

const CWD_FLAGS = {
	make: ["-C", "--directory"],
	pnpm: ["-C", "--dir"],
	npm: ["--prefix"],
};
const NODE_SCRIPT_EXTENSIONS = [".mjs", ".js", ".cjs", ".ts"];
const NODE_EVAL_FLAGS = new Set(["-e", "--eval", "-p", "--print"]);

function isVerificationNode(rest) {
	let hasTest = false;
	for (let i = 0; i < rest.length; i++) {
		const { value } = rest[i];
		if (
			NODE_EVAL_FLAGS.has(value) ||
			/^(?:--eval=|--print=|-[ep].+)/.test(value)
		)
			return false;
		if (value === "--test") hasTest = true;
		// Common value-taking options precede the script. Their operands are
		// neither script paths nor Node flags. Unknown options remain bounded
		// by the existing path-shaped operand detection below.
		if (
			["--require", "-r", "--import", "--loader", "--input-type"].includes(
				value,
			)
		) {
			i++;
			continue;
		}
		if (!value.startsWith("-"))
			return (
				hasTest ||
				value.includes("/") ||
				NODE_SCRIPT_EXTENSIONS.some((ext) => value.endsWith(ext))
			);
	}
	return hasTest;
}

function isVerification(tokens) {
	const head = basename(tokens[0]?.value ?? "");
	if (
		tokens.length === 2 &&
		["--help", "--version", "-h", "-v"].includes(tokens[1].value)
	)
		return false;
	if (head === "node") return isVerificationNode(tokens.slice(1));
	return head === "make" || head === "pnpm" || head === "npm" || head === "npx";
}

function verificationTokens(segment) {
	if (isVerification(segment.tokens)) return segment.tokens;
	if (segment.unresolved) {
		for (let i = 1; i < segment.tokens.length; i++) {
			const suffix = segment.tokens.slice(i);
			if (isVerification(suffix)) return suffix;
		}
	}
	return null;
}

/** Tool cwd flags affect this process, never the next shell segment. */
function verificationTarget(tokens, segment) {
	let cwd = segment.cwd;
	let explicit = segment.explicitCwd;
	const head = basename(tokens[0].value);
	const flags = CWD_FLAGS[head] ?? [];
	let canReadCwdOption = true;
	for (let i = 1; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.value === "--") break;
		// Package manager script arguments are not top-level cwd options.
		if (head !== "make" && !token.value.startsWith("-")) break;
		const equals = token.value.indexOf("=");
		const name = equals < 0 ? token.value : token.value.slice(0, equals);
		let operand;
		if (flags.includes(name)) {
			if (!canReadCwdOption) return { cwd: null, explicit: true };
			operand =
				equals < 0
					? tokens[++i]
					: { ...token, value: token.value.slice(equals + 1) };
		} else if (
			flags.includes("-C") &&
			token.value.startsWith("-C") &&
			token.value.length > 2
		) {
			if (!canReadCwdOption) return { cwd: null, explicit: true };
			operand = { ...token, value: token.value.slice(2) };
		} else {
			// Do not mistake a preceding option's operand for a cwd option.
			// Canonical supported cwd flags come first; use absolute cd when
			// other tool options must precede them. This does not parse tool
			// internals or arguments forwarded to package scripts.
			if (token.value.startsWith("-")) canReadCwdOption = false;
			continue;
		}
		// make applies each chdir successively; package managers resolve their
		// last cwd option from the original process cwd, not the prior flag.
		cwd = resolveCwdPath(operand, head === "make" ? cwd : segment.cwd);
		explicit = true;
	}
	return {
		cwd: segment.unresolved || segment.gitTargetOverride ? null : cwd,
		explicit,
	};
}

/** All supported verification segments, including explicitly targeted ones. */
export function findVerificationSegments(command) {
	return analyzeShellContext(command, null)
		.segments.filter((segment) => verificationTokens(segment) !== null)
		.map((segment) => segment.command);
}

/** Evaluate every process target; an explicit known cwd needs no drift prompt. */
export function evaluateVerificationTreeGuard(
	payload,
	{
		resolveRoots,
		supportsAsk = true,
		payloadCwdIsExecutionCwd = true,
		ambientCdPath = false,
		ambientGitTargetOverride = false,
	},
) {
	if (payload?.tool_name !== "Bash") return { decision: "allow" };
	const analysis = analyzeShellContext(
		payload?.tool_input?.command,
		shellStartCwd(payload, payloadCwdIsExecutionCwd),
		{
			ambientCdPath,
			ambientGitTargetOverride,
		},
	);
	let asked = null;
	for (const segment of analysis.segments) {
		const tokens = verificationTokens(segment);
		if (!tokens) continue;
		const target = verificationTarget(tokens, segment);
		if (target.cwd === null)
			return {
				decision: "deny",
				reason:
					`Cannot prove the effective cwd for '${segment.command}' from this hook payload and command. ` +
					"Use cd /absolute/path && command, or an absolute tool cwd option such as make -C /absolute/path, pnpm --dir /absolute/path, or npm --prefix /absolute/path. " +
					"An absolute Node script path does not set process.cwd().",
			};
		if (target.explicit) continue;
		const roots = resolveRoots(target.cwd);
		if (
			!roots ||
			roots.worktreeRoot !== roots.mainRoot ||
			roots.hasLinkedWorktrees === false
		)
			continue;
		asked ??= {
			decision: "ask",
			reason:
				`This command implicitly uses the main checkout ('${roots.mainRoot}'), while linked worktrees exist. ` +
				"A result here does not verify changes in a linked worktree. Confirm an intentional main-tree check, or name the intended cwd with an absolute cd or tool cwd option.",
		};
	}
	return asked && !supportsAsk
		? {
				decision: "deny",
				reason: `${asked.reason} This harness cannot request permission; specify the intended target explicitly.`,
			}
		: (asked ?? { decision: "allow" });
}

/** Whether the current harness supports a PreToolUse ask decision. */
export function supportsPermissionAsk(environment = process.env) {
	return (
		typeof environment.CLAUDE_PROJECT_DIR === "string" &&
		environment.CLAUDE_PROJECT_DIR.trim() !== ""
	);
}

export function runVerificationTreeGuard(inputText, options) {
	const payload = parseHookPayload(inputText);
	if (!payload) return { shouldOutput: false };
	const result = evaluateVerificationTreeGuard(payload, options);
	return result.decision === "allow"
		? { shouldOutput: false }
		: { shouldOutput: true, output: buildPermissionOutput(result) };
}
