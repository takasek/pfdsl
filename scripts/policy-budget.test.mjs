import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createGuardProbe } from "./lib/guard-probe.mjs";

const root = new URL("./", import.meta.url);
test("an unknown default branch cannot authorize a ref mutation", () => {
	const fixture = mkdtempSync(join(tmpdir(), "pfdsl-default-unknown-"));
	try {
		for (const args of [
			["init", "-q", "-b", "trunk"],
			["switch", "-c", "topic"],
		]) {
			const git = spawnSync("git", ["-C", fixture, ...args], {
				encoding: "utf8",
			});
			assert.equal(git.status, 0, git.stderr);
		}
		const result = spawnSync(
			process.execPath,
			[new URL("main-commit-guard.mjs", root).pathname],
			{
				input: JSON.stringify({
					tool_name: "Bash",
					tool_input: { command: "git switch -Ctrunk HEAD" },
					cwd: fixture,
				}),
				encoding: "utf8",
			},
		);
		assert.equal(result.status, 2, result.stdout + result.stderr);
		assert.equal(
			JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,
			"deny",
		);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
test("a guarded Git target without a resolvable repository is denied", () => {
	const fixture = mkdtempSync(join(tmpdir(), "pfdsl-policy-unknown-"));
	try {
		const result = spawnSync(
			process.execPath,
			[new URL("main-commit-guard.mjs", root).pathname],
			{
				input: JSON.stringify({
					tool_name: "Bash",
					tool_input: { command: `git -C ${fixture} add file` },
					cwd: fixture,
				}),
				encoding: "utf8",
			},
		);
		assert.equal(result.status, 2, result.stdout + result.stderr);
		assert.equal(
			JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,
			"deny",
		);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
for (const [name, body] of [
	[
		"asynchronous rejection",
		"export const runDelegationGuard = async () => { throw new Error('async-policy-failure'); };",
	],
	[
		"invalid response",
		"export const runDelegationGuard = () => ({shouldOutput:true,output:{hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'unknown'}}});",
	],
	[
		"oversized response",
		"export const runDelegationGuard = () => ({shouldOutput:true,output:{data:'x'.repeat(70000)}});",
	],
])
	test(`policy ${name} is denied`, () => {
		const fixture = mkdtempSync(join(tmpdir(), "pfdsl-policy-output-"));
		try {
			mkdirSync(join(fixture, "lib"));
			cpSync(
				new URL("lib/policy-supervisor.mjs", root),
				join(fixture, "lib/policy-supervisor.mjs"),
			);
			cpSync(
				new URL("delegation-guard.mjs", root),
				join(fixture, "delegation-guard.mjs"),
			);
			cpSync(
				new URL("lib/hook-io.mjs", root),
				join(fixture, "lib/hook-io.mjs"),
			);
			writeFileSync(join(fixture, "lib/delegation-guard.mjs"), body);
			const result = spawnSync(
				process.execPath,
				[join(fixture, "delegation-guard.mjs")],
				{
					input: JSON.stringify({
						tool_name: "Bash",
						tool_input: { command: "git status" },
					}),
					encoding: "utf8",
					timeout: 7000,
				},
			);
			assert.equal(result.status, 2, result.stdout + result.stderr);
			assert.equal(
				JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,
				"deny",
			);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

test("Git probes cap each invocation and exhaust one cumulative budget", () => {
	let time = 100;
	const limits = [];
	const probe = createGuardProbe({
		now: () => time,
		budget: 600,
		exec: (_args, opts) => {
			limits.push(opts.timeout);
			time += 400;
			return { ok: true };
		},
	});
	probe([]);
	probe([]);
	assert.deepEqual(limits, [500, 200]);
	assert.throws(() => probe([]), /budget exhausted/);
	assert.throws(
		() => createGuardProbe({ exec: () => ({ ok: false, timedOut: true }) })([]),
		/timed out/,
	);
});
test("policy initialization stall is denied before the host timeout", () => {
	const fixture = mkdtempSync(join(tmpdir(), "pfdsl-policy-stall-"));
	try {
		mkdirSync(join(fixture, "lib"));
		cpSync(
			new URL("lib/policy-supervisor.mjs", root),
			join(fixture, "lib/policy-supervisor.mjs"),
		);
		cpSync(
			new URL("delegation-guard.mjs", root),
			join(fixture, "delegation-guard.mjs"),
		);
		writeFileSync(
			join(fixture, "lib/delegation-guard.mjs"),
			"while (true) {}\n",
		);
		const started = Date.now();
		const result = spawnSync(
			process.execPath,
			[join(fixture, "delegation-guard.mjs")],
			{
				input: JSON.stringify({
					tool_name: "Bash",
					tool_input: { command: "git status" },
				}),
				encoding: "utf8",
				timeout: 7000,
			},
		);
		assert.equal(result.status, 2, result.stderr);
		assert.equal(
			JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,
			"deny",
		);
		assert.ok(Date.now() - started < 6500);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

test("an unfinished stdin stream is denied without waiting for EOF", async () => {
	const child = spawn(
		process.execPath,
		[new URL("delegation-guard.mjs", root).pathname],
		{ stdio: ["pipe", "pipe", "pipe"] },
	);
	let output = "";
	child.stdout.on("data", (chunk) => {
		output += chunk;
	});
	child.stderr.resume();
	child.stdin.on("error", () => {});
	child.stdin.write("{");
	const timer = setTimeout(() => child.kill("SIGKILL"), 7000);
	const code = await new Promise((resolve) => child.on("close", resolve));
	clearTimeout(timer);
	assert.equal(code, 2);
	assert.equal(
		JSON.parse(output).hookSpecificOutput.permissionDecision,
		"deny",
	);
});

for (const input of [
	"bad",
	"{}",
	JSON.stringify({ tool_name: "Bash", tool_input: {} }),
	"x".repeat(1024 * 1024 + 1),
])
	test(`invalid or oversized payload denies (${input.length} bytes)`, () => {
		const result = spawnSync(
			process.execPath,
			[new URL("delegation-guard.mjs", root).pathname],
			{ input, encoding: "utf8" },
		);
		assert.equal(result.status, 2, result.stderr);
		assert.equal(
			JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,
			"deny",
		);
	});
