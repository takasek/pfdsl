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

// PreToolUse(Bash) hook: intervenes before a command whose target tree is
// implicit in cwd runs while the hook reports the main checkout of a
// repository with linked worktrees (#840). See
// scripts/lib/verification-tree-guard.mjs for the detection logic (which
// commands qualify and why) and the harness-specific decision.
//
// Reads the hook payload on stdin. Prints an ask decision for Claude Code or a
// deny decision for Codex only when the cwd resolves to the main checkout, at
// least one linked worktree exists elsewhere in the repo, and the command
// contains a cwd-implicit segment; stays silent otherwise. Codex cannot handle
// PreToolUse ask and would fail open, so deny points to approved explicit-target
// recovery paths (#1013, #1392). Changing only execution workdir cannot recover
// an unchanged payload.cwd. Normal decisions exit 0.
// Uncaught policy loading or execution errors block with exit 2.
//
// Usage (wired in .claude/settings.json): node scripts/verification-tree-guard.mjs

try {
	const { readStdinText } = await import("./lib/hook-io.mjs");
	const { resolveGitRoots, tryGit } = await import("./lib/run-exec.mjs");
	const { createGuardProbe } = await import("./lib/guard-probe.mjs");
	const probeGit = createGuardProbe({ exec: tryGit });
	const { runVerificationTreeGuard, supportsPermissionAsk } = await import(
		"./lib/verification-tree-guard.mjs"
	);

	/**
	 * @param {string} cwd
	 * @returns {{worktreeRoot: string, mainRoot: string, hasLinkedWorktrees: boolean} | null}
	 */
	function resolveRoots(cwd) {
		const roots = resolveGitRoots(cwd, { exec: probeGit });
		if (!roots) return null;

		// A porcelain `worktree list` prints one "worktree <path>" line per
		// worktree, the main checkout included — more than one such line means at
		// least one linked worktree exists besides it. A failure here (e.g. an
		// old git without the subcommand) is read as "none", the safe direction:
		// this guard must not ask on a repo it cannot inspect.
		const list = probeGit(["worktree", "list", "--porcelain"], { cwd });
		const hasLinkedWorktrees = list.ok
			? list.out.split("\n").filter((line) => line.startsWith("worktree "))
					.length > 1
			: false;

		return {
			...roots,
			hasLinkedWorktrees,
		};
	}

	const { shouldOutput, output } = await runVerificationTreeGuard(
		await readStdinText(),
		{
			resolveRoots,
			supportsAsk: supportsPermissionAsk(),
		},
	);
	if (shouldOutput) {
		console.log(JSON.stringify(output));
	}
	process.exit(0);
} catch (error) {
	const reason =
		"Cannot execute the verification-tree policy; repair policy loading before retrying.";
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
