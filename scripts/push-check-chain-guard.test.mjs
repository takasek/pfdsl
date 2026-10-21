import assert from "node:assert/strict";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parserRecoveryCommand } from "./lib/agent-operation-table.mjs";
import { run } from "./lib/run-exec.mjs";
import { shellParserPath } from "./lib/shell-parser-tool.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const entry = fileURLToPath(
	new URL("./push-check-chain-guard.mjs", import.meta.url),
);

function invoke(command, tool_name = "Bash") {
	return run(process.execPath, [entry], {
		cwd: root,
		input: JSON.stringify({
			tool_name,
			tool_input: tool_name === "exec_command" ? { cmd: command } : { command },
		}),
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

test("Codex exec_command denies ungated push and allows the corrected chain", () => {
	const output = JSON.parse(
		invoke("make test; git push", "exec_command"),
	).hookSpecificOutput;
	assert.equal(output.permissionDecision, "deny");
	assert.match(output.permissionDecisionReason, /&&/);
	assert.equal(invoke("make test && git push", "exec_command"), "");
	assert.equal(invoke("git push", "exec_command"), "");
});

test("with no parser the actual hook permits only its exact fixed-root repair", () => {
	const fixture = realpathSync(
		mkdtempSync(join(tmpdir(), "pfdsl-1493-hook-recovery-")),
	);
	try {
		mkdirSync(join(fixture, "scripts"));
		cpSync(entry, join(fixture, "scripts/push-check-chain-guard.mjs"));
		cpSync(join(root, "scripts/lib"), join(fixture, "scripts/lib"), {
			recursive: true,
		});
		const repair = parserRecoveryCommand(fixture);
		for (const tool_name of ["Bash", "exec_command"]) {
			const probe = (command) =>
				run(
					process.execPath,
					[join(fixture, "scripts/push-check-chain-guard.mjs")],
					{
						cwd: fixture,
						input: JSON.stringify({
							tool_name,
							tool_input:
								tool_name === "exec_command" ? { cmd: command } : { command },
						}),
					},
				);
			assert.equal(probe(repair), "");
			for (const command of [
				"make setup",
				"git push",
				`${repair}; git push`,
				parserRecoveryCommand(`${fixture}/other`),
			]) {
				const output = JSON.parse(probe(command)).hookSpecificOutput;
				assert.equal(output.permissionDecision, "deny", command);
				assert.ok(
					output.permissionDecisionReason.includes(repair),
					output.permissionDecisionReason,
				);
			}
		}
		const parser = shellParserPath(fixture);
		mkdirSync(join(fixture, "node_modules/.pfdsl-tools"), { recursive: true });
		writeFileSync(parser, "invalid parser", { mode: 0o755 });
		assert.equal(
			run(
				process.execPath,
				[join(fixture, "scripts/push-check-chain-guard.mjs")],
				{
					cwd: fixture,
					input: JSON.stringify({
						tool_name: "Bash",
						tool_input: { command: repair },
					}),
				},
			),
			"",
		);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
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
