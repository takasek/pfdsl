#!/usr/bin/env node
// Plugin-distributed PostToolUse (Bash) hook (#465): advisory reminder to
// consider pfd-retro when a `git commit` marks a roadmap artifact done, for
// any repo that has adopted the pfdsl plugin. Distributes the repo-local
// pre-commit reminder (scripts/lib/retro-reminder-check.mjs, #463) to
// plugin-adopting repos via hooks/hooks.json instead.
//
// Self-contained on purpose (no imports outside this file): the plugin
// bundle only mirrors hooks/ as a unit (see scripts/gen-plugin.mjs), so an
// import reaching outside this directory would break once mirrored.
//
// Detection reads `git show HEAD` (the commit already happened by the time
// PostToolUse fires) rather than the staged diff `git diff --cached` that
// the pre-commit version reads before the commit exists.
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

const DONE_ADDITION_PATTERN = /^\+(?!\+\+).*status:\s*done/;

export function isGitCommitCommand(command) {
	return typeof command === "string" && command.includes("git commit");
}

export function detectDoneAddition(diffText) {
	return diffText.split("\n").some((line) => DONE_ADDITION_PATTERN.test(line));
}

export function buildHookOutput() {
	return {
		hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext: "note: this commit marks a roadmap artifact done — run pfd-retro if warranted.",
		},
	};
}

// CLI mode: read the PostToolUse JSON payload from stdin, print an advisory
// hookSpecificOutput.additionalContext when the commit added `status: done`
// to .pfdsl/roadmap.pfdsl. Always exits 0 — this never blocks anything.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
	let input = "";
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) {
		input += chunk;
	}

	let payload;
	try {
		payload = JSON.parse(input);
	} catch {
		process.exit(0);
	}

	if (!isGitCommitCommand(payload?.tool_input?.command)) {
		process.exit(0);
	}

	const cwd = payload?.cwd ?? process.cwd();
	if (!existsSync(`${cwd}/.pfdsl/roadmap.pfdsl`)) {
		process.exit(0);
	}

	let diff;
	try {
		diff = execSync("git show HEAD -- .pfdsl/roadmap.pfdsl", { cwd, encoding: "utf8" });
	} catch {
		process.exit(0);
	}

	if (detectDoneAddition(diff)) {
		console.log(JSON.stringify(buildHookOutput()));
	}
	process.exit(0);
}
