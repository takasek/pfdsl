import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkMutation } from "./mutation-check.mjs";

function fixture(
	t,
	{
		extra = "",
		assertion = "assert.equal(value, 'good')",
		skipped = false,
	} = {},
) {
	const cwd = mkdtempSync(join(tmpdir(), "mutation-check-test-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	writeFileSync(join(cwd, "value.txt"), "good\r\n");
	writeFileSync(
		join(cwd, "contract.test.mjs"),
		`
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { describe, it } from 'node:test';
const value = readFileSync('value.txt', 'utf8').trim();
describe('contract', () => {
  it${skipped ? ".skip" : ""}('detects bad value', () => { ${assertion}; });
  ${extra}
});
`,
	);
	return {
		cwd,
		config: {
			target: "value.txt",
			from: "good",
			to: "bad",
			tests: ["contract.test.mjs"],
			expected: {
				file: "contract.test.mjs",
				name: ["contract", "detects bad value"],
			},
		},
	};
}

async function verify(t, options, change = () => {}) {
	const { cwd, config } = fixture(t, options);
	change(config, cwd);
	const original = readFileSync(join(cwd, "value.txt"));
	const result = await checkMutation(config, { cwd });
	assert.deepEqual(
		readFileSync(join(cwd, "value.txt")),
		original,
		"restores the exact original bytes",
	);
	return { result, cwd, config };
}

test("A: only the named test fails and restoration is green", async (t) => {
	const { result, cwd } = await verify(t, {
		extra: "it('unaffected', () => assert.ok(true));",
	});
	assert.equal(result.status, "detected");
	assert.equal(result.exitCode, 0);
	assert.equal(result.baseline.exitCode, 0);
	assert.equal(result.mutated.exitCode, 1);
	assert.equal(result.restored.exitCode, 0);
	assert.deepEqual(
		result.mutated.failures.map((f) => f.name),
		[["contract", "detects bad value"]],
	);
	assert.equal(existsSync(join(cwd, "value.txt.mutation-check-backup")), false);
});

test("B: an unrelated baseline failure cannot count as mutation detection", async (t) => {
	const { result } = await verify(t, {
		extra: "it('already broken', () => assert.fail('pre-existing'));",
	});
	assert.equal(result.status, "baseline-failed");
	assert.equal(result.exitCode, 2);
	assert.equal(result.mutated, undefined);
});

test("B: the expected test already failing is also a failed baseline", async (t) => {
	const { result } = await verify(t, {
		assertion: "assert.fail('already broken')",
	});
	assert.equal(result.status, "baseline-failed");
});

test("C: a nonexistent expected name does not pass with an otherwise green suite", async (t) => {
	const { result } = await verify(t, {}, (config) => {
		config.expected.name = ["no such test"];
	});
	assert.equal(result.status, "ineffective");
	assert.equal(result.exitCode, 3);
	assert.equal(result.mutated, undefined);
});

test("C: a skipped expected test was not executed", async (t) => {
	assert.equal(
		(await verify(t, { skipped: true })).result.status,
		"ineffective",
	);
});

test("C: unapplied, ambiguous and identity replacements cannot succeed", async (t) => {
	for (const replacement of [
		{ from: "missing" },
		{ from: "o" },
		{ to: "good" },
		{ from: "" },
	]) {
		const { result } = await verify(t, {}, (config) =>
			Object.assign(config, replacement),
		);
		assert.equal(result.status, "ineffective");
		assert.equal(result.exitCode, 3);
	}
});

test("C: an applied mutation unseen by the assertion is ineffective", async (t) => {
	const { result } = await verify(t, {
		assertion: "assert.ok(value.length > 0)",
	});
	assert.equal(result.status, "ineffective");
	assert.equal(result.restored.exitCode, 0);
});

test("C: duplicate full names cannot identify a unique expected test", async (t) => {
	const { result } = await verify(t, {
		extra: "it('detects bad value', () => assert.equal(value, 'good'));",
	});
	assert.equal(result.status, "ineffective");
});

test("an additional failure is an error even when the expected test fails", async (t) => {
	const { result } = await verify(t, {
		extra: "it('collateral failure', () => assert.equal(value, 'good'));",
	});
	assert.equal(result.status, "error");
	assert.equal(result.exitCode, 1);
	assert.equal(result.mutated.failures.length, 2);
	assert.equal(result.restored.exitCode, 0);
});

test("a restored file with a red restored suite is not detection success", async (t) => {
	const { result } = await verify(t, {
		extra: `it('persistent side effect', () => {
if (value === 'bad') writeFileSync('marker', 'mutated');
if (value === 'good') assert.equal(existsSync('marker'), false);
});`,
	});
	assert.equal(result.status, "error");
	assert.equal(result.restored.exitCode, 1);
});

test("a timed out mutated test restores the file and reports an error", async (t) => {
	const { result } = await verify(
		t,
		{ assertion: "if (value === 'bad') { while (true) {} }" },
		(config) => {
			config.timeoutMs = 1000;
		},
	);
	assert.equal(result.status, "error");
	assert.equal(result.restored.exitCode, 0);
});

test("existing recovery data is never overwritten", async (t) => {
	const { result, cwd } = await verify(t, {}, (_, dir) => {
		writeFileSync(join(dir, "value.txt.mutation-check-backup"), "other run");
	});
	assert.equal(result.status, "error");
	assert.equal(
		readFileSync(join(cwd, "value.txt.mutation-check-backup"), "utf8"),
		"other run",
	);
});

test("CLI emits JSON and the same distinct exit code", async (t) => {
	const { cwd, config } = fixture(t);
	config.expected.name = ["missing"];
	writeFileSync(join(cwd, "config.json"), JSON.stringify(config));
	const cli = fileURLToPath(new URL("../mutation-check.mjs", import.meta.url));
	const run = spawnSync(process.execPath, [cli, "--config", "config.json"], {
		cwd,
		encoding: "utf8",
	});
	assert.equal(run.status, 3, run.stderr);
	assert.equal(JSON.parse(run.stdout).status, "ineffective");
});

test("overlapping literal occurrences are ambiguous too", async (t) => {
	const { result } = await verify(t, {}, (config, cwd) => {
		writeFileSync(join(cwd, "value.txt"), "aaa");
		config.from = "aa";
	});
	assert.equal(result.status, "ineffective");
});

test("a todo expected test was not a passing baseline assertion", async (t) => {
	const { result } = await verify(t, {}, (_, cwd) => {
		const file = join(cwd, "contract.test.mjs");
		writeFileSync(
			file,
			readFileSync(file, "utf8").replace("it('detects", "it.todo('detects"),
		);
	});
	assert.equal(result.status, "ineffective");
});

test("another file with the same test hierarchy remains independently checked", async (t) => {
	const { result } = await verify(t, {}, (config, cwd) => {
		writeFileSync(
			join(cwd, "second.test.mjs"),
			readFileSync(join(cwd, "contract.test.mjs")),
		);
		config.tests.push("second.test.mjs");
	});
	assert.equal(result.status, "error");
	assert.equal(result.mutated.failures.length, 2);
});

test("dropping another test under mutation does not satisfy only-the-expected-test", async (t) => {
	const { result } = await verify(t, {
		extra: "if (value === 'good') it('disappearing', () => {});",
	});
	assert.equal(result.status, "error");
	assert.match(result.reason, /identities/);
});

test("an independent target edit is preserved with recovery bytes", async (t) => {
	const { cwd, config } = fixture(t, {
		extra:
			"it('edits file', () => { if (value === 'bad') writeFileSync('value.txt', 'independent edit'); });",
	});
	const result = await checkMutation(config, { cwd });
	assert.equal(result.status, "error");
	assert.equal(
		readFileSync(join(cwd, "value.txt"), "utf8"),
		"independent edit",
	);
	assert.equal(readFileSync(result.backup, "utf8"), "good\r\n");
});

test("replacement dollar sequences are literal text", async (t) => {
	const { result } = await verify(t, {}, (config) => {
		config.to = "$&";
	});
	assert.equal(result.status, "detected");
});

test("a suite with no tests cannot identify an executed expected test", async (t) => {
	const { result } = await verify(t, {}, (_, cwd) => {
		writeFileSync(join(cwd, "contract.test.mjs"), "");
	});
	assert.equal(result.status, "ineffective");
});

test("timeout stops workers before restoring the original file", async (t) => {
	const { cwd, config } = fixture(t, {
		assertion:
			"if (value === 'bad') setTimeout(() => writeFileSync('value.txt', 'late worker write'), 2500); assert.equal(value, 'good')",
	});
	config.timeoutMs = 1000;
	const result = await checkMutation(config, { cwd });
	assert.equal(result.status, "error");
	assert.equal(result.restored?.success, true, JSON.stringify(result));
	await new Promise((resolve) => setTimeout(resolve, 2800));
	assert.equal(readFileSync(join(cwd, "value.txt"), "utf8"), "good\r\n");
});

test("a failed group stop during restored verification retains recovery bytes", async (t) => {
	const { cwd, config } = fixture(t, {
		assertion: `if (value === 'bad') { writeFileSync('marker', 'mutated'); assert.fail('mutation'); }
if (existsSync('marker')) setTimeout(() => writeFileSync('value.txt', 'late restored-worker write'), 2500);`,
	});
	config.timeoutMs = 1000;
	const originalKill = process.kill;
	process.kill = (pid, signal) => {
		if (pid < 0)
			throw Object.assign(new Error("Injected group-stop failure"), {
				code: "EPERM",
			});
		return originalKill.call(process, pid, signal);
	};
	let result;
	try {
		result = await checkMutation(config, { cwd });
	} finally {
		process.kill = originalKill;
	}
	// The intentionally unkillable worker must finish before fixture cleanup.
	await new Promise((resolve) => setTimeout(resolve, 2800));
	assert.equal(result.status, "error");
	assert.equal(result.restored.unsafeToRestore, true);
	assert.equal(readFileSync(result.backup, "utf8"), "good\r\n");
});
