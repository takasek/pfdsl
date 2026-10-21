import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { run } from "./lib/run-exec.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const entry = fileURLToPath(
	new URL("./push-check-chain-guard.mjs", import.meta.url),
);

function invoke(command, tool_name = "Bash") {
	return run(process.execPath, [entry], {
		cwd: root,
		input: JSON.stringify({ tool_name, tool_input: { command } }),
	});
}

test("the actual hook denies the incident command and guides a retry", () => {
	const output = JSON.parse(
		invoke(
			'make build x; make test x; echo "test=$?"; make typecheck; git push',
		),
	).hookSpecificOutput;
	assert.equal(output.hookEventName, "PreToolUse");
	assert.equal(output.permissionDecision, "deny");
	assert.match(output.permissionDecisionReason, /&&/);
});

test("the hook stays silent for a corrected chain, standalone push and other tools", () => {
	assert.equal(invoke("make test && make typecheck && git push"), "");
	assert.equal(invoke("git push"), "");
	assert.equal(invoke("make test; git push", "Write"), "");
	assert.equal(
		run(process.execPath, [entry], { cwd: root, input: "invalid" }),
		"",
	);
});

test("both development harnesses wire the hook once, outside the distributed bundles", () => {
	for (const file of [".claude/settings.json", ".codex/hooks.json"]) {
		const settings = JSON.parse(
			readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
		);
		const matching = settings.hooks.PreToolUse.filter((group) =>
			new RegExp(`^(?:${group.matcher})$`).test("Bash"),
		).flatMap((group) => group.hooks);
		assert.equal(
			matching.filter(
				(hook) => hook.command === "node scripts/push-check-chain-guard.mjs",
			).length,
			1,
			file,
		);
	}
	for (const file of [
		"hooks/hooks.json",
		"plugin/pfdsl/hooks/hooks.json",
		"plugin/pfdsl-codex/hooks/hooks.json",
	]) {
		assert.equal(
			readFileSync(new URL(`../${file}`, import.meta.url), "utf8").includes(
				"push-check-chain",
			),
			false,
			file,
		);
	}
});
