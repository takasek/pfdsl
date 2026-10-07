#!/usr/bin/env node

import { isMainThread, Worker } from "node:worker_threads";

// Keep supervision in the original process: worker threads preserve process.ppid
// for ADR-0046 and cannot block the parent timer with synchronous policy code.
if (isMainThread) {
	let finished = false;
	let worker;
	const fail = (detail) => {
		if (finished) return;
		finished = true;
		const reason = `Cannot execute the policy safely: ${detail}. Repair the hook before retrying.`;
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
	};
	const timer = setTimeout(() => fail("internal deadline exceeded"), 5000);
	try {
		const chunks = [];
		let bytes = 0;
		for await (const chunk of process.stdin) {
			bytes += chunk.length;
			if (bytes > 1024 * 1024) throw new Error("payload exceeds 1 MiB");
			chunks.push(chunk);
		}
		const input = Buffer.concat(chunks).toString("utf8");
		const payload = JSON.parse(input);
		if (
			!payload ||
			Array.isArray(payload) ||
			typeof payload.tool_name !== "string" ||
			!payload.tool_input ||
			Array.isArray(payload.tool_input) ||
			typeof payload.tool_input !== "object" ||
			(["Bash", "apply_patch"].includes(payload.tool_name) &&
				typeof payload.tool_input.command !== "string")
		) {
			throw new Error("invalid hook payload");
		}
		worker = new Worker(new URL(import.meta.url), {
			stdin: true,
			stdout: true,
			stderr: true,
		});
		let out = "",
			diagnostic = "";
		worker.stdout.on("data", (chunk) => {
			out += chunk;
			if (Buffer.byteLength(out) > 64 * 1024)
				fail("policy output exceeds 64 KiB");
		});
		worker.stderr.on("data", (chunk) => {
			diagnostic += chunk;
			if (Buffer.byteLength(diagnostic) > 64 * 1024)
				fail("policy diagnostic exceeds 64 KiB");
		});
		worker.on("error", (error) => fail(error.message));
		worker.on("exit", (code) => {
			if (finished) return;
			try {
				if (code !== 0 && code !== 2) throw new Error(`policy exited ${code}`);
				if (out.trim()) {
					const parsed = JSON.parse(out);
					const response = parsed.hookSpecificOutput;
					if (
						!response ||
						response.hookEventName !== "PreToolUse" ||
						(response.permissionDecision !== undefined &&
							!["allow", "deny", "ask"].includes(
								response.permissionDecision,
							)) ||
						(response.permissionDecision === undefined &&
							typeof response.additionalContext !== "string") ||
						(response.permissionDecision !== undefined &&
							typeof response.permissionDecisionReason !== "string") ||
						(code === 2 && response.permissionDecision !== "deny")
					)
						throw new Error("unsupported policy response");
					if (
						response.permissionDecision === "ask" &&
						!process.env.CLAUDE_PROJECT_DIR?.trim()
					) {
						response.permissionDecision = "deny";
						response.permissionDecisionReason +=
							" Codex cannot prompt for this hook decision; resolve the condition before retrying.";
						out = `${JSON.stringify(parsed)}\n`;
					}
				} else if (code === 2)
					throw new Error("policy failure without a deny response");
				finished = true;
				clearTimeout(timer);
				process.stderr.write(diagnostic);
				process.stdout.write(out);
				process.exit(code);
			} catch (error) {
				fail(error.message);
			}
		});
		worker.stdin.on("error", (error) => fail(error.message));
		worker.stdin.end(input);
		await new Promise(() => {});
	} catch (error) {
		fail(error.message);
	}
}

// PreToolUse(Edit|Write) hook: asks for `make release-status` before a new
// publish process is declared in roadmap.pfdsl (#650). See
// scripts/lib/roadmap-publish-guard.mjs for the detection logic, why this is
// ask rather than deny, and the stdin orchestration.
//
// Normal decisions exit 0. Uncaught policy loading or execution errors block with exit 2.
// Usage (wired in .claude/settings.json): node scripts/roadmap-publish-guard.mjs

try {
	const { readFileSync } = await import("node:fs");
	const { readStdinText, parseHookPayload, buildPermissionOutput } =
		await import("./lib/hook-io.mjs");
	const { normalizeFileOperations } = await import(
		"./lib/file-operation-policy.mjs"
	);
	const { evaluateRoadmapPublishGuard } = await import(
		"./lib/roadmap-publish-guard.mjs"
	);

	/** The file as it stands, or undefined when it cannot be read (new file, no access). */
	function readFile(path) {
		try {
			return readFileSync(path, "utf8");
		} catch {
			return undefined;
		}
	}

	const payload = parseHookPayload(await readStdinText());
	if (!payload) process.exit(0);
	for (const operation of normalizeFileOperations(payload)) {
		const result = await evaluateRoadmapPublishGuard(operation, { readFile });
		if (result.decision === "allow") continue;
		// Codex cannot ask. Preserve the advisory without pretending it prevents
		// this write; release publication itself stays a separate human decision.
		if (!process.env.CLAUDE_PROJECT_DIR?.trim()) {
			console.log(
				JSON.stringify({
					hookSpecificOutput: {
						hookEventName: "PreToolUse",
						additionalContext: result.reason,
					},
				}),
			);
		} else console.log(JSON.stringify(buildPermissionOutput(result)));
		break;
	}
	process.exit(0);
} catch (error) {
	const reason =
		"Cannot execute the roadmap-publish policy; repair policy loading before retrying.";
	console.error(
		`${reason} ${error instanceof Error ? error.message : String(error)}`,
	);
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
