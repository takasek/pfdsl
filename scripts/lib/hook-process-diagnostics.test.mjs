import assert from "node:assert/strict";
import { test } from "node:test";
import { observeHookProcessChain } from "./hook-process-diagnostics.mjs";

test("hook diagnostics stop at three parent observations and do not request argv", () => {
	const seen = [];
	const rows = observeHookProcessChain({
		parentPid: 637,
		environment: { TZ: "Asia/Tokyo" },
		probeProcess: (file, args, options) => {
			assert.equal(file, "ps");
			assert.equal(args[1], "pid=,ppid=,lstart=,comm=");
			assert.equal(options.env.TZ, "UTC");
			assert.equal(options.env.LC_ALL, "C");
			assert.equal(options.timeout, 200);
			const pid = Number(args.at(-1));
			seen.push(pid);
			return {
				ok: true,
				out: `${pid} ${pid - 1} Thu Oct 22 19:41:41 2026 /bin/sh\n`,
			};
		},
	});
	assert.deepEqual(seen, [637, 636, 635]);
	assert.equal(rows.length, 3);
	assert.equal(rows[0].ppid, 636);
});

test("unavailable, malformed and mismatched process evidence is explicit and bounded", () => {
	for (const probeProcess of [
		() => {
			throw new Error("not installed");
		},
		() => ({ ok: false, out: "" }),
		() => ({ ok: true, out: "junk" }),
		() => ({ ok: true, out: "90 1 Thu Oct 22 19:41:41 2026 claude" }),
	]) {
		assert.deepEqual(
			observeHookProcessChain({ parentPid: 637, probeProcess }),
			[{ pid: 637, status: "unavailable" }],
		);
	}
	assert.deepEqual(
		observeHookProcessChain({
			parentPid: 637,
			probeProcess: () => ({
				ok: true,
				out: "637 637 Thu Oct 22 19:41:41 2026 sh",
			}),
		}).map(({ pid }) => pid),
		[637],
	);
});
