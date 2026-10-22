#!/usr/bin/env node
// One PreToolUse entry for operation scope and responsibility. Bootstrap is
// independent of policy imports so its fixed-root parser repair remains usable.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isMainThread } from "node:worker_threads";

const hookRoot = fileURLToPath(new URL("../", import.meta.url));
const delegatedCodex =
	!process.env.CLAUDE_PROJECT_DIR?.trim() && process.env.CLAUDECODE === "1";

// Only failed scope decisions expose this bounded allowlist. Never dump argv or the environment.
function ownershipDiagnostics(payload, facts, classified, processChain) {
	const bounded = (value) =>
		typeof value === "string" ? value.slice(0, 512) : null;
	const paths = classified.operations
		.map(({ executionPath }) => executionPath)
		.filter(Boolean);
	return JSON.stringify({
		entry: fileURLToPath(import.meta.url),
		hookRoot,
		pid: process.pid,
		ppid: process.ppid,
		processChain,
		processCwd: bounded(process.cwd()),
		payloadCwd: bounded(payload.cwd),
		tool: bounded(payload.tool_name),
		sessionId: bounded(payload.session_id),
		agentId: bounded(payload.agent_id),
		agentType: bounded(payload.agent_type),
		claudeProjectDir: bounded(process.env.CLAUDE_PROJECT_DIR),
		claudeCode: process.env.CLAUDECODE === "1",
		harness: facts.harness,
		gitTargetOverride: facts.gitTargetOverride,
		targets: (facts.worktrees ?? [])
			.filter(({ root }) =>
				paths.some((path) => path === root || path.startsWith(`${root}/`)),
			)
			.slice(0, 4)
			.map((tree) => ({
				root: bounded(tree.root),
				primary: tree.primary === true,
				lock: bounded(tree.nativeLock),
				startMatched: tree.nativeStartMatched ?? null,
				owner: bounded(tree.ownership?.ownerId),
			})),
	});
}
function failed(detail, phase) {
	const diagnostic = String(detail).slice(0, 400);
	let guidance;
	if (phase === "input")
		guidance =
			detail === "bootstrap input deadline exceeded"
				? "Hook input was not received within the time limit. Inspect the caller's input delivery using read-only diagnostics before choosing a recovery."
				: "Hook input could not be read or validated. Inspect the caller's payload and input delivery, then correct the identified input problem.";
	else if (phase === "policy-load") {
		const cause =
			detail === "bootstrap policy loading deadline exceeded"
				? "Policy components did not finish loading within the time limit."
				: "Policy components could not be loaded.";
		guidance = `${cause} Ask a human to investigate the reported module or dependency using read-only diagnostics in a human terminal and decide how to recover; the guarded tools cannot repair it.`;
	} else if (detail === "Git policy probe budget exhausted")
		guidance =
			"Git safety checks did not finish within their time budget. Investigate the cause using read-only diagnostics before choosing a recovery.";
	else
		guidance =
			"The underlying cause is not established. Investigate the reported failure using read-only diagnostics before choosing a recovery.";
	const reason = `Cannot execute the agent operation policy: ${diagnostic}. The operation was denied because safety verification is incomplete. ${guidance}`;
	console.error(reason);
	console.log(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: reason,
			},
		}),
	);
	process.exit(2);
}

if (isMainThread) {
	let phase = "input";
	const timer = setTimeout(
		() =>
			failed(
				phase === "input"
					? "bootstrap input deadline exceeded"
					: "bootstrap policy loading deadline exceeded",
				phase,
			),
		5000,
	);
	try {
		const chunks = [];
		let bytes = 0;
		for await (const chunk of process.stdin) {
			bytes += Buffer.byteLength(chunk);
			if (bytes > 1024 * 1024) throw new Error("payload exceeds 1 MiB");
			chunks.push(Buffer.from(chunk));
		}
		const input = Buffer.concat(chunks).toString("utf8");
		const payload = JSON.parse(input);
		const command = payload?.tool_input?.command ?? payload?.tool_input?.cmd;
		const installer = `${hookRoot.replace(/\/$/, "")}/scripts/setup-shell-parser.mjs`;
		const repair = `node '${installer.replaceAll("'", "'\\''")}'`;
		// This pinned filename is deliberately available without importing any
		// helper. Integration checks that a healthy parser never masks a failed
		// policy load, keeping the bootstrap and installer version in agreement.
		const parser = new URL(
			`../node_modules/.pfdsl-tools/shfmt-v3.14.1${process.platform === "win32" ? ".exe" : ""}`,
			import.meta.url,
		);
		if (
			!delegatedCodex &&
			["Bash", "exec_command"].includes(payload?.tool_name) &&
			command === repair &&
			!existsSync(parser)
		) {
			clearTimeout(timer);
			process.exit(0);
		}
		phase = "policy-load";
		const { supervisePolicy } = await import("./lib/policy-supervisor.mjs");
		clearTimeout(timer);
		phase = "policy-execution";
		await supervisePolicy(new URL(import.meta.url), { inputText: input });
	} catch (error) {
		failed(error instanceof Error ? error.message : error, phase);
	}
} else {
	let phase = "policy-load";
	try {
		const { readStdinText, buildPermissionOutput } = await import(
			"./lib/hook-io.mjs"
		);
		const { evaluateAgentOperationPolicy } = await import(
			"./lib/agent-operation-policy.mjs"
		);
		const { classifyAgentOperations } = await import(
			"./lib/agent-operation-classifier.mjs"
		);
		const { recordUnresolvedDecision } = await import(
			"./lib/agent-operation-unresolved.mjs"
		);
		const { collectAgentOperationEnvironment } = await import(
			"./lib/agent-operation-environment.mjs"
		);
		const { observeHookProcessChain } = await import(
			"./lib/hook-process-diagnostics.mjs"
		);
		const { readShell } = await import("./lib/shell-commands.mjs");
		const { isShellParserInstalled, shellParserPath } = await import(
			"./lib/shell-parser-tool.mjs"
		);
		phase = "input";
		const payload = JSON.parse(await readStdinText());
		phase = "policy-execution";
		const healthy = isShellParserInstalled(hookRoot);
		const command = payload.tool_input?.command ?? payload.tool_input?.cmd;
		const shell =
			healthy && ["Bash", "exec_command"].includes(payload.tool_name)
				? readShell(command)
				: undefined;
		const facts = healthy
			? collectAgentOperationEnvironment(payload, { hookRoot, shell })
			: {
					harness: process.env.CLAUDE_PROJECT_DIR?.trim() ? "claude" : "codex",
					codexDelegation: delegatedCodex ? { owner: null } : null,
					health: "failed",
					failure: existsSync(shellParserPath(hookRoot))
						? "parser"
						: "parser-missing",
					hookRoot,
				};
		const decision = evaluateAgentOperationPolicy(payload, facts);
		const classified = classifyAgentOperations(payload, facts);
		recordUnresolvedDecision(classified, decision, facts);
		if (decision.decision !== "allow") {
			if (
				decision.decision === "deny" &&
				["W", "B", "D"].includes(decision.operationClass) &&
				classified.operations.some(({ target }) =>
					["primary", "other-live", "other-unowned"].includes(target),
				)
			)
				decision.reason += ` Ownership diagnostics: ${ownershipDiagnostics(payload, facts, classified, observeHookProcessChain())}.`;
			if (shell?.error && decision.operationClass === "U")
				decision.reason += ` ${shell.error}`;
			const recovery = {
				rewrite: "same agent rewrite",
				parent: "parent",
				terminal: "human terminal",
			};
			decision.reason += ` Recovery: ${recovery[decision.recovery]}.`;
			console.log(JSON.stringify(buildPermissionOutput(decision)));
		}
		process.exit(0);
	} catch (error) {
		failed(error instanceof Error ? error.message : error, phase);
	}
}
