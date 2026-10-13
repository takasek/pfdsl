import assert from "node:assert/strict";
import test from "node:test";
import { READY, verifyStartup } from "./standalone-startup-smoke.mjs";

const fixture = (source, options = {}) =>
	verifyStartup({
		executable: process.execPath,
		args: ["-e", source],
		timeoutMs: 500,
		settleMs: 80,
		...options,
	});

test("startup smoke requires native readiness and reaps the child", async () => {
	const result = await fixture(
		`console.log("${READY}"); console.log(process.pid); setInterval(()=>{},1000);`,
	);
	const pid = Number(result.stdout.trim().split("\n").at(-1));
	assert.ok(pid > 0);
	assert.throws(() => process.kill(pid, 0), /ESRCH/);
});
test("startup smoke rejects an early failure with captured stderr", async () => {
	await assert.rejects(
		fixture('console.error("exit guard unsupported"); process.exit(3);'),
		/exit guard unsupported/,
	);
});
test("startup smoke rejects missing readiness and cleans up", async () => {
	await assert.rejects(
		fixture("setInterval(()=>{},1000);", { timeoutMs: 100 }),
		/readiness.*timed out/i,
	);
});
test("startup smoke rejects exit just after readiness", async () => {
	await assert.rejects(
		fixture(`console.log("${READY}"); setTimeout(()=>process.exit(0),20);`),
		/exited before startup was confirmed/,
	);
});
test("startup smoke reports a missing executable", async () => {
	await assert.rejects(
		verifyStartup({ executable: "/nonexistent/pfdsl-smoke-executable" }),
		/ENOENT/,
	);
});
