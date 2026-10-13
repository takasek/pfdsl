import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { isCliEntrypoint } from "./lib/cli-entrypoint.mjs";

export const READY = "PFDSL_NATIVE_STARTUP_READY";

/** Starts the actual native executable; readiness is emitted after native setup and exit-guard installation. */
export async function verifyStartup({
	executable,
	args = [],
	timeoutMs = 15000,
	settleMs = 1500,
}) {
	const child = spawn(executable, args, {
		env: { ...process.env, PFDSL_STARTUP_SMOKE: "1" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "",
		stderr = "",
		timeout,
		settling;
	const closed = new Promise((done) => child.once("close", done));
	try {
		await new Promise((yes, no) => {
			const fail = (reason) => no(new Error(`${reason}\n${stdout}\n${stderr}`));
			child.once("error", (error) =>
				fail(`Native startup failed: ${error.message}`),
			);
			child.once("exit", (code, signal) =>
				fail(
					`Native app exited before startup was confirmed (code ${code}, signal ${signal}).`,
				),
			);
			child.stdout.on("data", (bytes) => {
				stdout += bytes.toString();
				if (!settling && stdout.split(/\r?\n/).includes(READY)) {
					clearTimeout(timeout);
					settling = setTimeout(yes, settleMs);
				}
			});
			child.stderr.on("data", (bytes) => {
				stderr += bytes.toString();
			});
			timeout = setTimeout(
				() => fail("Native readiness timed out."),
				timeoutMs,
			);
		});
		return { stdout, stderr };
	} finally {
		clearTimeout(timeout);
		clearTimeout(settling);
		// The smoke owns this process and has no user documents; do not exercise or bypass Quit confirmation.
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
		await closed;
	}
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	const executable = process.argv[2];
	if (!executable || process.argv.length !== 3)
		throw new Error("Pass the bundled native executable path.");
	const result = await verifyStartup({ executable: resolve(executable) });
	process.stdout.write(result.stdout);
	process.stderr.write(result.stderr);
	console.log(
		"Native startup and exit-guard installation confirmed; GUI/IME and Quit interaction remain unverified.",
	);
}
