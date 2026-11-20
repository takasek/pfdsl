import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
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
		setup = "",
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
${setup}
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

const runWatchdogMs = 30_000;
const timeoutTest = { timeout: 3 * runWatchdogMs + 5_000 };

async function runUntilTimeout(t, assertion, { failGroupStop = false } = {}) {
	const sockets = new Set();
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	});
	const done = new AbortController();
	const signal = AbortSignal.any([t.signal, done.signal]);
	try {
		server.listen(0, "127.0.0.1");
		await once(server, "listening", { signal });
		const { cwd, config } = fixture(t, {
			assertion,
			setup: `
import { spawn } from 'node:child_process';
import { once } from 'node:events';
function waitForTimeout(lateWrite) {
  const worker = spawn(process.execPath, ['timeout-worker.mjs', lateWrite], {
    stdio: 'ignore',
  });
  return once(worker, 'exit').then(([code, signal]) => {
    assert.equal(code, 0, signal);
  });
}
`,
		});
		// Start the writer as a regular descendant in the runner's process
		// group. It can survive a leader-only kill independently of node:test.
		writeFileSync(
			join(cwd, "timeout-worker.mjs"),
			`
import { writeFileSync } from 'node:fs';
import { connect } from 'node:net';
const socket = connect(${server.address().port}, '127.0.0.1');
socket.once('data', () => {
  writeFileSync('value.txt', process.argv[2]);
  socket.end();
});
`,
		);
		config.timeoutMs = runWatchdogMs;
		const schedule = globalThis.setTimeout;
		let expire;
		// Keep a real watchdog for stalled runs. Trigger it once the fixture
		// connects so ordinary Node startup does not determine the test stage.
		const timer = t.mock.method(
			globalThis,
			"setTimeout",
			(callback, ms, ...args) => {
				if (ms === config.timeoutMs) expire = () => callback(...args);
				return schedule(callback, ms, ...args);
			},
		);
		const connected = once(server, "connection", { signal });
		const run = checkMutation(config, { cwd });
		try {
			const [worker] = await Promise.race([
				connected,
				run.then((result) => assert.fail(JSON.stringify(result))),
			]);
			assert.ok(expire, "The worker connected without an execution watchdog");
			const closed = once(worker, "close", { signal });
			let bytesAtGroupStop;
			const originalKill = process.kill;
			const kill = t.mock.method(process, "kill", (pid, signal) => {
				if (pid < 0 && signal === "SIGKILL") {
					bytesAtGroupStop = readFileSync(join(cwd, "value.txt"));
					if (failGroupStop)
						throw Object.assign(new Error("Injected group-stop failure"), {
							code: "EPERM",
						});
				}
				return originalKill.call(process, pid, signal);
			});
			try {
				expire();
			} finally {
				kill.mock.restore();
			}
			const [result] = await Promise.all([
				run.then((result) => {
					// The failed stop must retain the backup before the writer changes
					// the target. Otherwise the independent-edit check could mask it.
					if (failGroupStop) worker.end("write");
					return result;
				}),
				closed,
			]);
			return { result, cwd, bytesAtGroupStop };
		} finally {
			timer.mock.restore();
		}
	} finally {
		done.abort();
		server.close();
		for (const socket of sockets) socket.destroy();
	}
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

test(
	"a timed out mutated test restores the file and reports an error",
	timeoutTest,
	async (t) => {
		const { result, cwd } = await runUntilTimeout(
			t,
			"if (value === 'bad') return waitForTimeout('late mutation write')",
		);
		const detail = JSON.stringify(result);
		assert.equal(result.status, "error", detail);
		assert.equal(result.baseline?.success, true, detail);
		assert.equal(result.mutated?.error, "Test execution timed out", detail);
		assert.equal(result.restored?.success, true, detail);
		assert.equal(readFileSync(join(cwd, "value.txt"), "utf8"), "good\r\n");
	},
);

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

test(
	"timeout stops workers before restoring the original file",
	timeoutTest,
	async (t) => {
		const { result, cwd, bytesAtGroupStop } = await runUntilTimeout(
			t,
			`if (value === 'bad') {
  waitForTimeout('late worker write');
  assert.fail('mutation');
}`,
		);
		const detail = JSON.stringify(result);
		assert.equal(result.status, "error", detail);
		assert.equal(result.mutated?.error, "Test execution timed out", detail);
		assert.equal(result.restored?.success, true, detail);
		assert.deepEqual(bytesAtGroupStop, Buffer.from("bad\r\n"), detail);
		assert.equal(readFileSync(join(cwd, "value.txt"), "utf8"), "good\r\n");
	},
);

test(
	"a failed group stop during restored verification retains recovery bytes",
	timeoutTest,
	async (t) => {
		const { result, cwd, bytesAtGroupStop } = await runUntilTimeout(
			t,
			`if (value === 'bad') { writeFileSync('marker', 'mutated'); assert.fail('mutation'); }
assert.equal(value, 'good');
if (existsSync('marker')) return waitForTimeout('late restored-worker write');`,
			{ failGroupStop: true },
		);
		const detail = JSON.stringify(result);
		assert.equal(result.status, "error", detail);
		assert.equal(result.baseline?.success, true, detail);
		assert.equal(result.mutated?.error, undefined, detail);
		assert.equal(result.mutated?.exitCode, 1, detail);
		assert.equal(result.restored?.error, "Injected group-stop failure", detail);
		assert.equal(result.restored?.unsafeToRestore, true, detail);
		assert.equal(
			result.reason,
			"Restored test workers may still be running; original bytes retained in backup",
			detail,
		);
		assert.deepEqual(bytesAtGroupStop, Buffer.from("good\r\n"), detail);
		assert.equal(
			readFileSync(join(cwd, "value.txt"), "utf8"),
			"late restored-worker write",
		);
		assert.ok(result.backup, detail);
		assert.equal(readFileSync(result.backup, "utf8"), "good\r\n");
	},
);
