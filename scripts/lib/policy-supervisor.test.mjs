import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tryRun } from "./run-exec.mjs";

const helper = new URL("./policy-supervisor.mjs", import.meta.url).href;
const payload = JSON.stringify({
	tool_name: "Bash",
	tool_input: { command: "git status" },
});
function supervised(
	body,
	{ input = payload, claude = false, deadlineMs = 1000 } = {},
) {
	const root = mkdtempSync(
		fileURLToPath(
			new URL("../../node_modules/pfdsl-supervisor-", import.meta.url),
		),
	);
	try {
		const entry = join(root, "entry.mjs");
		writeFileSync(
			entry,
			`import { isMainThread } from "node:worker_threads";\nif (isMainThread) { const {supervisePolicy} = await import(${JSON.stringify(helper)}); await supervisePolicy(new URL(import.meta.url), { deadlineMs: ${deadlineMs} }); } else { for await (const _chunk of process.stdin) {} ${body} }\n`,
		);
		return tryRun(process.execPath, [entry], {
			cwd: root,
			input,
			env: { ...process.env, CLAUDE_PROJECT_DIR: claude ? root : "" },
			captureStderr: true,
			timeout: 2500,
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
const output = (decision) =>
	`console.log(JSON.stringify({hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: ${JSON.stringify(decision)}, permissionDecisionReason: "fixture reason"}}));`;

test("supervisor preserves normal silent allow, deny and Claude ask without a second conversion", () => {
	assert.equal(supervised("").status, 0);
	const denied = supervised(output("deny"));
	assert.equal(denied.status, 0);
	assert.equal(
		JSON.parse(denied.out).hookSpecificOutput.permissionDecision,
		"deny",
	);
	const asked = supervised(output("ask"), { claude: true });
	assert.equal(asked.status, 0);
	assert.equal(
		JSON.parse(asked.out).hookSpecificOutput.permissionDecision,
		"ask",
	);
});

test("supervisor denies load failures, synchronous stalls and unsupported responses", () => {
	for (const [body, reason] of [
		["throw new Error('fixture load failure');", /fixture load failure/],
		["for (;;) {}", /deadline exceeded/],
		["console.log('{}');", /unsupported policy response/],
		[output("ask"), /unsupported ask/],
	]) {
		const result = supervised(body, {
			deadlineMs: body === "for (;;) {}" ? 100 : 1000,
		});
		assert.equal(result.status, 2, body);
		const response = JSON.parse(result.out).hookSpecificOutput;
		assert.equal(response.permissionDecision, "deny");
		assert.match(response.permissionDecisionReason, /human terminal/);
		assert.match(response.permissionDecisionReason, reason);
	}
});

test("supervisor validates hook payloads while accepting the native apply_patch shapes", () => {
	for (const input of [
		"{bad",
		JSON.stringify({ tool_name: "Bash", tool_input: {} }),
	])
		assert.equal(supervised("", { input }).status, 2);
	for (const tool_input of [
		"*** Begin Patch\n*** End Patch",
		{ command: "*** Begin Patch\n*** End Patch" },
	])
		assert.equal(
			supervised("", {
				input: JSON.stringify({ tool_name: "apply_patch", tool_input }),
			}).status,
			0,
		);
});
