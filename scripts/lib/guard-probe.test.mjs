import assert from "node:assert/strict";
import { test } from "node:test";
import { createGuardProbe } from "./guard-probe.mjs";

test("Git observations use the remaining guard budget and fail on exhaustion", () => {
	let time = 1000;
	const seen = [];
	const probe = createGuardProbe({
		now: () => time,
		budget: 600,
		exec: (args, options) => {
			seen.push({ args, options });
			return { ok: true, out: "ok", status: 0 };
		},
	});
	probe(["rev-parse", "--show-toplevel"]);
	assert.equal(seen[0].options.timeout, 500);
	assert.equal(seen[0].options.captureStderr, true);
	time += 550;
	probe(["branch", "--show-current"]);
	assert.equal(seen[1].options.timeout, 50);
	time += 50;
	assert.throws(() => probe(["status"]), /budget/);
	assert.equal(seen.length, 2);
});

test("a timeout or failed executable is distinct from an ordinary Git non-repository result", () => {
	for (const result of [
		{ ok: false, status: null },
		{ ok: false, status: 1, timedOut: true },
	])
		assert.throws(() => createGuardProbe({ exec: () => result })(["status"]));
	const notARepo = { ok: false, status: 128, out: "not a git repository" };
	assert.deepEqual(
		createGuardProbe({ exec: () => notARepo })(["rev-parse"]),
		notARepo,
	);
});
