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

// PreToolUse(Bash) hook: denies or prompts for git commands that change the
// default branch or another worktree owned by the same repository (#650,
// widened beyond `git commit` in #777 and across worktrees in #784). See
// scripts/lib/main-commit-guard.mjs for the detection logic, which subcommand
// gets which decision and why, and the stdin orchestration.
//
// Both branch names come from git rather than being assumed: the current one
// from `git branch --show-current`, the default one from `origin/HEAD`. A repo
// whose default branch is `trunk` or `master` was previously guarded against a
// branch name it does not have. Worktree ownership is anchored to the harness
// session root and compared with the command target's git roots:
// CLAUDE_PROJECT_DIR remains authoritative in Claude Code, while Codex falls
// back to the PreToolUse payload cwd. None of these are read unless the command
// turns out to be guarded — the lib calls resolveBranches only then.
// A resolved sibling can be refined by optional native ownership evidence
// (ADR-0046); this never removes branch or hook-bypass checks.
//
// Normal decisions exit 0. Uncaught policy loading or execution errors block with exit 2.
//
// Usage (wired in .claude/settings.json and .codex/hooks.json): node scripts/main-commit-guard.mjs

try {
	const { readStdinText } = await import("./lib/hook-io.mjs");
	const { classifyTargetRepository, runMainCommitGuard } = await import(
		"./lib/main-commit-guard.mjs"
	);
	const { refineNativeWorktreeRelation } = await import(
		"./lib/native-worktree-owner.mjs"
	);
	const {
		hasGitTargetEnvironment,
		resolveGitRoots,
		tryGit,
		withoutGitTargetEnvironment,
	} = await import("./lib/run-exec.mjs");
	const { createGuardProbe } = await import("./lib/guard-probe.mjs");
	const probeGit = createGuardProbe({ exec: tryGit });

	/**
	 * @param {object} payload PreToolUse hook payload
	 * @param {string} targetCwd resolved cwd of one guarded Git segment
	 * @returns {{currentBranch: string | undefined, mainBranch: string, targetRelation: "own" | "sibling" | "foreign" | "unknown"}}
	 */
	function resolveBranches(payload, targetCwd) {
		// Each guarded segment supplies its own statically resolved target (#751, #784).
		const targetRoots = resolveGitRoots(targetCwd, { exec: probeGit });
		const projectDir = process.env.CLAUDE_PROJECT_DIR;
		const payloadCwd = payload?.cwd;
		const sessionDir =
			typeof projectDir === "string" && projectDir.trim() !== ""
				? projectDir
				: typeof payloadCwd === "string" && payloadCwd.trim() !== ""
					? payloadCwd
					: null;
		const sessionRoots =
			sessionDir === null
				? null
				: resolveGitRoots(sessionDir, { exec: probeGit });
		const identityEnv = withoutGitTargetEnvironment();
		const current = probeGit(["branch", "--show-current"], {
			cwd: targetCwd,
			env: identityEnv,
		});
		const head = probeGit(
			["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
			{
				cwd: targetCwd,
				env: identityEnv,
			},
		);
		if (!targetRoots || !sessionRoots || !current.ok) {
			throw new Error(
				"Cannot establish the repository boundary or current branch for this Git mutation",
			);
		}
		const relation = classifyTargetRepository(sessionRoots, targetRoots);
		if (
			relation !== "foreign" &&
			(!head.ok || !/^origin\/.+/.test(head.out.trim()))
		) {
			throw new Error(
				"Cannot establish the default branch; restore origin/HEAD before retrying this Git mutation",
			);
		}
		// A successful empty current branch denotes a detached HEAD.
		const nativeRelation =
			relation === "own" &&
			!process.env.CLAUDE_PROJECT_DIR?.trim() &&
			targetRoots?.worktreeRoot !== targetRoots?.mainRoot
				? "sibling"
				: relation;
		return {
			currentBranch: current.ok ? current.out.trim() : undefined,
			mainBranch: head.ok ? head.out.trim().replace(/^origin\//, "") : "main",
			targetRelation: refineNativeWorktreeRelation(nativeRelation, {
				targetRoot: targetRoots?.worktreeRoot,
				payload,
				execGit: probeGit,
			}),
		};
	}

	const { shouldOutput, output } = await runMainCommitGuard(
		await readStdinText(),
		{
			resolveBranches,
			ambientGitTargetOverride: hasGitTargetEnvironment(),
			supportsAsk:
				typeof process.env.CLAUDE_PROJECT_DIR === "string" &&
				process.env.CLAUDE_PROJECT_DIR.trim() !== "",
		},
	);
	if (shouldOutput) {
		console.log(JSON.stringify(output));
	}
	process.exit(0);
} catch (error) {
	const reason =
		"Cannot execute the main-commit policy; repair policy loading before retrying.";
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
