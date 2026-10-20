#!/usr/bin/env node
// One PreToolUse entry for operation scope and responsibility. Bootstrap is
// independent of policy imports so its fixed-root parser repair remains usable.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isMainThread } from "node:worker_threads";

const hookRoot = fileURLToPath(new URL("../", import.meta.url));
const delegatedCodex =
	!process.env.CLAUDE_PROJECT_DIR?.trim() && process.env.CLAUDECODE === "1";
function failed(detail) {
	const reason = `Cannot execute the agent operation policy: ${String(detail).slice(0, 400)}. Repair the hook in a human terminal before retrying.`;
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
	const timer = setTimeout(
		() => failed("bootstrap input deadline exceeded"),
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
		const { supervisePolicy } = await import("./lib/policy-supervisor.mjs");
		clearTimeout(timer);
		await supervisePolicy(new URL(import.meta.url), { inputText: input });
	} catch (error) {
		failed(error instanceof Error ? error.message : error);
	}
} else {
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
		const { readShell } = await import("./lib/shell-commands.mjs");
		const { isShellParserInstalled, shellParserPath } = await import(
			"./lib/shell-parser-tool.mjs"
		);
		const payload = JSON.parse(await readStdinText());
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
		recordUnresolvedDecision(
			classifyAgentOperations(payload, facts),
			decision,
			facts,
		);
		if (decision.decision !== "allow") {
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
		failed(error instanceof Error ? error.message : error);
	}
}
