import { spawn } from "node:child_process";
import {
	closeSync,
	openSync,
	readFileSync,
	realpathSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const exitCodes = {
	detected: 0,
	error: 1,
	"baseline-failed": 2,
	ineffective: 3,
};
const reporter = fileURLToPath(
	new URL("./mutation-check-reporter.mjs", import.meta.url),
);
const key = (test) => JSON.stringify([test.file, test.name]);
const active = (test) => !test.skip && !test.todo;

function localFile(path, cwd) {
	if (typeof path !== "string" || !path)
		throw new Error("Expected a file path");
	const file = realpathSync(resolve(cwd, path));
	const rel = relative(cwd, file);
	if (
		rel === ".." ||
		rel.startsWith(`..${sep}`) ||
		isAbsolute(rel) ||
		!statSync(file).isFile()
	) {
		throw new Error(`File must be inside the working directory: ${path}`);
	}
	return file;
}

function normalize(config, cwd) {
	if (process.platform === "win32")
		throw new Error(
			"mutation-check requires POSIX process groups (Linux or macOS)",
		);
	if (!Array.isArray(config.tests) || !config.tests.length)
		throw new Error("tests must list at least one Node test file");
	const tests = config.tests.map((file) => localFile(file, cwd));
	if (new Set(tests).size !== tests.length)
		throw new Error("Duplicate test files");
	const expected = config.expected;
	if (
		!Array.isArray(expected?.name) ||
		!expected.name.length ||
		expected.name.some((name) => typeof name !== "string" || !name)
	) {
		throw new Error(
			"expected.name must be a nonempty array of exact ancestor and test names",
		);
	}
	const file = localFile(expected.file, cwd);
	if (!tests.includes(file)) throw new Error("expected.file must be in tests");
	const timeoutMs = config.timeoutMs ?? 30_000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
		throw new Error("timeoutMs must be a positive integer");
	if (typeof config.from !== "string" || typeof config.to !== "string")
		throw new Error("from and to must be literal strings");
	return {
		...config,
		target: localFile(config.target, cwd),
		tests,
		expected: { file, name: expected.name },
		timeoutMs,
	};
}

async function runTests(config, cwd) {
	const env = { ...process.env };
	// Nested invocation starts a fresh runner, not a worker of ours.
	delete env.NODE_TEST_CONTEXT;
	const child = spawn(
		process.execPath,
		["--test", `--test-reporter=${reporter}`, ...config.tests],
		{
			cwd,
			env,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let stdout = "";
	let stderr = "";
	let runError;
	let unsafeToRestore = false;
	let stopping = false;
	const stop = (message) => {
		if (stopping) return;
		stopping = true;
		runError = new Error(message);
		// Signal the whole group while its leader is still alive. Killing just
		// the leader first can orphan workers that write after restoration.
		try {
			if (child.pid) process.kill(-child.pid, "SIGKILL");
		} catch (error) {
			if (error.code !== "ESRCH") {
				unsafeToRestore = true;
				runError = error;
				child.kill("SIGKILL");
			}
		}
	};
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		if (stdout.length + chunk.length > 16 * 1024 * 1024)
			stop("Test report exceeded 16 MiB");
		else stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr = (stderr + chunk).slice(-8192);
	});
	const result = await new Promise((resolveResult) => {
		const timer = setTimeout(
			() => stop("Test execution timed out"),
			config.timeoutMs,
		);
		child.on("error", (error) => {
			runError = error;
		});
		child.on("close", (exitCode, signal) => {
			clearTimeout(timer);
			resolveResult({ exitCode, signal });
		});
	});
	try {
		if (runError) throw runError;
		if (result.signal || ![0, 1].includes(result.exitCode))
			throw new Error("Test process did not finish normally");
		const report = JSON.parse(stdout);
		if (!report.summary || !Array.isArray(report.tests))
			throw new Error("Incomplete test report");
		result.tests = report.tests.map((test) => ({
			...test,
			file: realpathSync(test.file),
		}));
		result.failures = result.tests.filter(
			(test) =>
				active(test) && !test.passed && test.failureType !== "subtestsFailed",
		);
		result.success =
			result.exitCode === 0 &&
			report.summary.success === true &&
			result.failures.length === 0;
	} catch (error) {
		result.error = error.message;
		result.stderr = stderr;
		if (unsafeToRestore) result.unsafeToRestore = true;
	}
	return result;
}

function inventory(run) {
	return run.tests
		.map((test) => JSON.stringify([key(test), test.kind, test.skip, test.todo]))
		.sort();
}

/**
 * Check one literal mutation in an isolated working directory.
 * Status/exit: detected/0, error/1, baseline-failed/2, ineffective/3.
 * Paths are cwd-relative or absolute within cwd. Recovery bytes stay beside
 * the target until restoration succeeds; another run's backup is never removed.
 */
export async function checkMutation(input, { cwd = process.cwd() } = {}) {
	const evidence = {};
	let status = "error";
	let reason;
	let config;
	let original;
	let mutated;
	let backup;
	let ownedBackup = false;
	let mutationStarted = false;
	const conclude = (state, detail) => {
		status = state;
		reason = detail;
	};
	try {
		cwd = realpathSync(cwd);
		config = normalize(input, cwd);
		original = readFileSync(config.target);
		const source = original.toString("utf8");
		if (!Buffer.from(source).equals(original))
			throw new Error("Target must be UTF-8 text");
		const first = source.indexOf(config.from);
		if (
			!config.from ||
			config.from === config.to ||
			first < 0 ||
			source.indexOf(config.from, first + 1) !== -1
		) {
			return {
				status: "ineffective",
				exitCode: 3,
				reason: "Replacement must change exactly one literal occurrence",
			};
		}
		mutated = Buffer.from(source.replace(config.from, () => config.to));
		backup = `${config.target}.mutation-check-backup`;
		const fd = openSync(backup, "wx", 0o600);
		try {
			writeFileSync(fd, original);
			ownedBackup = true;
		} finally {
			closeSync(fd);
		}
		evidence.baseline = await runTests(config, cwd);
		if (evidence.baseline.error) {
			conclude("error", "Baseline test execution failed");
		} else if (!evidence.baseline.success) {
			conclude("baseline-failed", "The baseline is already failing");
		} else {
			const matches = evidence.baseline.tests.filter(
				(test) => key(test) === key(config.expected),
			);
			if (
				matches.length !== 1 ||
				!active(matches[0]) ||
				matches[0].kind !== "test" ||
				(matches[0].name.length === 1 &&
					resolve(matches[0].name[0]) === matches[0].file)
			) {
				conclude(
					"ineffective",
					"Expected test must identify exactly one executed test",
				);
			} else {
				if (!readFileSync(config.target).equals(original))
					throw new Error("Target changed during baseline execution");
				mutationStarted = true;
				writeFileSync(config.target, mutated);
				if (!readFileSync(config.target).equals(mutated))
					throw new Error("Mutation was not applied");
				evidence.mutated = await runTests(config, cwd);
				const run = evidence.mutated;
				if (run.error) {
					conclude("error", "Mutated test execution failed");
				} else if (
					JSON.stringify(inventory(run)) !==
					JSON.stringify(inventory(evidence.baseline))
				) {
					conclude(
						"error",
						"Executed test identities or skip/todo states changed",
					);
				} else if (run.success) {
					conclude(
						"ineffective",
						"The applied mutation did not fail the expected test",
					);
				} else if (
					run.exitCode === 1 &&
					run.failures.length === 1 &&
					key(run.failures[0]) === key(config.expected) &&
					run.failures[0].failureType === "testCodeFailure"
				) {
					conclude("detected", "Only the expected test failed");
				} else {
					conclude(
						"error",
						"Failure identities do not match the expected test alone",
					);
				}
			}
		}
	} catch (error) {
		conclude("error", error.message);
	}
	if (ownedBackup) {
		try {
			if (Object.values(evidence).some((run) => run.unsafeToRestore))
				throw new Error(
					"Test workers may still be running; original bytes retained in backup",
				);
			const current = readFileSync(config.target);
			if (
				!current.equals(original) &&
				!(mutationStarted && current.equals(mutated))
			) {
				throw new Error(
					"Target changed independently; original bytes retained in backup",
				);
			}
			if (mutationStarted) {
				writeFileSync(config.target, original);
				if (!readFileSync(config.target).equals(original))
					throw new Error("Restored bytes do not match the original");
				evidence.restored = await runTests(config, cwd);
				if (evidence.restored.unsafeToRestore)
					throw new Error(
						"Restored test workers may still be running; original bytes retained in backup",
					);
				if (
					!evidence.restored.success ||
					evidence.restored.error ||
					JSON.stringify(inventory(evidence.restored)) !==
						JSON.stringify(inventory(evidence.baseline))
				) {
					conclude(
						"error",
						"Restored test execution is not the original green baseline",
					);
				}
				if (!readFileSync(config.target).equals(original))
					throw new Error("Target changed during restored test execution");
			}
			unlinkSync(backup);
		} catch (error) {
			conclude("error", error.message);
			evidence.backup = backup;
		}
	}
	return { status, exitCode: exitCodes[status], reason, ...evidence };
}
