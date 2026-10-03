#!/usr/bin/env node
// PreToolUse(Edit|Write) hook: denies a direct edit of the generated root
// instructions documents CLAUDE.md / AGENTS.md (#1160). See
// scripts/lib/generated-root-instructions-guard.mjs for the detection logic
// and why this resolves the worktree root via git rather than a path
// convention.
//
// Reads the hook payload on stdin. Prints a deny decision only when the
// target is a generated instruction in the addressed checkout; stays silent
// otherwise. Codex apply_patch and Claude Edit/Write share the target adapter.
//
// Usage (wired in .claude/settings.json): node scripts/generated-root-instructions-guard.mjs

import { evaluateGeneratedRootInstructionsGuard } from "./lib/generated-root-instructions-guard.mjs";
import {
	buildPermissionOutput,
	parseHookPayload,
	readStdinText,
} from "./lib/hook-io.mjs";

const payload = parseHookPayload(await readStdinText());
if (!payload) process.exit(0);

const result = evaluateGeneratedRootInstructionsGuard(payload);
if (result.decision === "deny") {
	console.log(JSON.stringify(buildPermissionOutput(result)));
}
process.exit(0);
