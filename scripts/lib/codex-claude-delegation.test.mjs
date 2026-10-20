import assert from "node:assert/strict";
import { test } from "node:test";
import { observeCodexClaudeDelegation } from "./codex-claude-delegation.mjs";

const start = "Tue Oct 20 02:50:36 2026";
function fixture() {
	const rows = new Map([
		[10, "10 20 Tue Oct 20 02:50:40 2026 /Applications/CodexCLI.app/codex"],
		[20, "20 30 Tue Oct 20 02:50:40 2026 /bin/zsh"],
		[30, `30 40 ${start} /Applications/Claude Code/claude`],
	]);
	const seen = [];
	return {
		rows,
		seen,
		options: {
			environment: { CLAUDECODE: "1", CODEX_THREAD_ID: "inherited" },
			parentPid: 10,
			probeProcess: (command, args, options) => {
				assert.equal(command, "ps");
				assert.equal(options.env.LC_ALL, "C");
				assert.equal(options.env.TZ, "UTC");
				assert.equal(options.timeout, 500);
				const pid = Number(args.at(-1));
				seen.push(pid);
				return { ok: rows.has(pid), out: rows.get(pid) ?? "" };
			},
		},
	};
}

test("observes exactly Codex -> shell -> Claude with PID and start", () => {
	const f = fixture();
	assert.deepEqual(observeCodexClaudeDelegation(f.options), {
		owner: { pid: 30, start },
	});
	assert.deepEqual(f.seen, [10, 20, 30]);
});

test("ordinary Codex and actual Claude hooks skip delegation probes", () => {
	const f = fixture();
	for (const environment of [
		{},
		{ CLAUDECODE: "0" },
		{ CLAUDECODE: "1", CLAUDE_PROJECT_DIR: "/repo" },
	])
		assert.equal(
			observeCodexClaudeDelegation({ ...f.options, environment }),
			null,
		);
	assert.deepEqual(f.seen, []);
});

test("broken fixed connections never search further or become a parent", () => {
	for (const [pid, value] of [
		[10, "10 20 Tue Oct 20 02:50:40 2026 /bin/node"],
		[20, "20 30 Tue Oct 20 02:50:40 2026 /bin/python"],
		[30, `30 40 ${start} /bin/zsh`],
		[30, `31 40 ${start} /Applications/claude`],
		[30, "malformed"],
		[30, null],
	]) {
		const f = fixture();
		if (value === null) f.rows.delete(pid);
		else f.rows.set(pid, value);
		assert.deepEqual(observeCodexClaudeDelegation(f.options), { owner: null });
		assert.ok(f.seen.length <= 3);
		assert.ok(!f.seen.includes(40));
	}
});

test("parent exit and PID reuse are freshly observed on every operation", () => {
	const f = fixture();
	assert.equal(observeCodexClaudeDelegation(f.options).owner.start, start);
	f.rows.set(30, "30 40 Tue Oct 20 03:50:36 2026 /Applications/claude");
	assert.equal(
		observeCodexClaudeDelegation(f.options).owner.start,
		"Tue Oct 20 03:50:36 2026",
	);
	f.rows.delete(30);
	assert.deepEqual(observeCodexClaudeDelegation(f.options), { owner: null });
});
