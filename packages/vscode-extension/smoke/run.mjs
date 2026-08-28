import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { chromium } from "playwright-core";
import { isCliEntrypoint } from "../../../scripts/lib/cli-entrypoint.mjs";
import {
	createRunDirectory,
	findWebviewFrame,
	makeLaunchArgs,
	removeRunDirectory,
} from "./harness.mjs";

const vscodeVersion = "1.132.1";
const cdpTimeoutMs = 30_000;
const outputBySession = new WeakMap();

export function resolveVSCodeExecutablePath(
	vscodeExecutablePath,
	{ exists = existsSync, platform = process.platform } = {},
) {
	if (exists(vscodeExecutablePath)) return vscodeExecutablePath;
	if (platform === "darwin" && basename(vscodeExecutablePath) === "Electron") {
		const codePath = join(dirname(vscodeExecutablePath), "Code");
		if (exists(codePath)) return codePath;
	}
	throw new Error(`VS Code executable not found: ${vscodeExecutablePath}`);
}

function collectOutput(stream) {
	let output = "";
	stream.setEncoding("utf8");
	stream.on("data", (chunk) => {
		output += chunk;
	});
	return () => output;
}

function formatDiagnostic(
	message,
	{ page, processError, vscodeProcess, output },
) {
	const frameUrls = page
		? page
				.frames()
				.map((frame) => frame.url())
				.join(", ")
		: "unavailable";
	const exit = vscodeProcess
		? `code=${vscodeProcess.exitCode}, signal=${vscodeProcess.signalCode}`
		: "not started";
	return [
		message,
		`VS Code version: ${vscodeVersion}`,
		`frame URLs: ${frameUrls}`,
		`VS Code process: ${exit}`,
		`process error: ${processError?.message ?? "none"}`,
		`stdout:\n${output?.stdout() ?? ""}`,
		`stderr:\n${output?.stderr() ?? ""}`,
	].join("\n");
}

export function appendCleanupDiagnostics(primaryError, cleanupErrors) {
	if (cleanupErrors.length === 0) return primaryError;
	const cleanupSummary = cleanupErrors.map((error) => error.message).join("\n");
	return new Error(
		`${primaryError.message}\nCleanup failures:\n${cleanupSummary}`,
		{
			cause: new AggregateError(
				[primaryError, ...cleanupErrors],
				"Smoke test failed and cleanup failed",
			),
		},
	);
}

function delay(milliseconds) {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function waitForWorkbenchPage(
	browser,
	{ delay: wait = delay, timeoutMs = cdpTimeoutMs } = {},
) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const context of browser.contexts()) {
			for (const page of context.pages()) {
				if (page.url().includes("/workbench/workbench.html")) return page;
			}
		}
		await wait(100);
	}
	throw new Error("Timed out waiting for the VS Code workbench page");
}

async function reservePort() {
	const server = createServer();
	await new Promise((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", resolveListen);
	});
	const address = server.address();
	if (typeof address !== "object" || address === null) {
		throw new Error("Unable to reserve a CDP port");
	}
	await new Promise((resolveClose, rejectClose) => {
		server.close((error) => (error ? rejectClose(error) : resolveClose()));
	});
	return address.port;
}

async function connectToVSCode({
	endpoint,
	output,
	processError,
	vscodeProcess,
}) {
	const deadline = Date.now() + cdpTimeoutMs;
	let lastError;
	while (Date.now() < deadline) {
		if (
			processError ||
			vscodeProcess.exitCode !== null ||
			vscodeProcess.signalCode !== null
		) {
			throw new Error(
				formatDiagnostic(
					"VS Code exited before the CDP endpoint became available",
					{
						processError,
						vscodeProcess,
						output,
					},
				),
			);
		}
		try {
			return await chromium.connectOverCDP(endpoint);
		} catch (error) {
			lastError = error;
			await delay(100);
		}
	}
	throw new Error(
		formatDiagnostic(
			`Timed out connecting to ${endpoint}: ${lastError?.message ?? "unknown error"}`,
			{
				processError,
				vscodeProcess,
				output,
			},
		),
	);
}

async function stopVSCode(vscodeProcess) {
	if (
		!vscodeProcess ||
		vscodeProcess.exitCode !== null ||
		vscodeProcess.signalCode !== null
	)
		return;
	const exited = new Promise((resolveExit) =>
		vscodeProcess.once("close", resolveExit),
	);
	vscodeProcess.kill("SIGTERM");
	if (
		await Promise.race([
			exited.then(() => true),
			delay(5_000).then(() => false),
		])
	)
		return;
	vscodeProcess.kill("SIGKILL");
	await exited;
}

export async function cleanupSmokeSession({ browser, runDir, vscodeProcess }) {
	const cleanupErrors = [];
	try {
		await browser?.close();
	} catch (error) {
		cleanupErrors.push(error);
	}
	try {
		await stopVSCode(vscodeProcess);
	} catch (error) {
		cleanupErrors.push(error);
	}
	try {
		await removeRunDirectory(runDir);
	} catch (error) {
		cleanupErrors.push(error);
	}
	return cleanupErrors;
}

export async function assertVisibleCount(locator, expected, label) {
	const count = await locator.count();
	const visibility = await Promise.all(
		Array.from({ length: count }, (_, index) => locator.nth(index).isVisible()),
	);
	const visibleCount = visibility.filter(Boolean).length;
	assert.equal(
		visibleCount,
		expected,
		`${label}: expected ${expected} visible ${expected === 1 ? "element" : "elements"}, observed ${visibleCount}`,
	);
	return visibleCount;
}

export async function launchSmokeSession() {
	const runDir = await createRunDirectory();
	let browser;
	let page;
	let processError;
	let vscodeProcess;
	let output;
	try {
		const repoRoot = resolve(
			dirname(fileURLToPath(import.meta.url)),
			"../../..",
		);
		const port = await reservePort();
		const vscodeExecutablePath = resolveVSCodeExecutablePath(
			await downloadAndUnzipVSCode(vscodeVersion),
		);
		vscodeProcess = spawn(
			vscodeExecutablePath,
			makeLaunchArgs({
				repoRoot,
				profileDir: join(runDir, "profile"),
				extensionsDir: join(runDir, "extensions"),
				port,
				fixturePath: join(repoRoot, "docs/samples/01-simple-chain.pfdsl"),
			}),
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		output = {
			stdout: collectOutput(vscodeProcess.stdout),
			stderr: collectOutput(vscodeProcess.stderr),
		};
		vscodeProcess.once("error", (error) => {
			processError = error;
		});
		browser = await connectToVSCode({
			endpoint: `http://127.0.0.1:${port}`,
			output,
			processError,
			vscodeProcess,
		});
		page = await waitForWorkbenchPage(browser);
		await page.getByLabel("PFDSL: Open Preview to the Side").click();
		const frame = await findWebviewFrame(page);
		const session = { browser, page, frame, vscodeProcess, runDir };
		outputBySession.set(session, output);
		return session;
	} catch (error) {
		const diagnostic = formatDiagnostic(error.message, {
			page,
			processError,
			vscodeProcess,
			output,
		});
		const primaryError = new Error(diagnostic, { cause: error });
		const cleanupErrors = await cleanupSmokeSession({
			browser,
			runDir,
			vscodeProcess,
		});
		throw appendCleanupDiagnostics(primaryError, cleanupErrors);
	}
}

async function main() {
	let session;
	let failure;
	try {
		session = await launchSmokeSession();
		console.log(`VS Code version: ${vscodeVersion}`);
		console.log(`frame URL: ${session.frame.url()}`);
		await assertVisibleCount(session.frame.locator("#root"), 1, "preview root");
		await assertVisibleCount(
			session.frame.locator("#inner svg"),
			1,
			"preview SVG",
		);
		const nodeCount = await assertVisibleCount(
			session.frame.locator("g.node"),
			6,
			"sample nodes",
		);
		console.log(`sample nodes: ${nodeCount}`);
		await assertVisibleCount(session.frame.locator("#minimap"), 1, "minimap");
	} catch (error) {
		if (!session) {
			failure = error;
		} else {
			failure = new Error(
				formatDiagnostic(error.message, {
					page: session.page,
					vscodeProcess: session.vscodeProcess,
					output: outputBySession.get(session),
				}),
				{ cause: error },
			);
		}
	} finally {
		if (session) {
			const cleanupErrors = await cleanupSmokeSession(session);
			if (cleanupErrors.length > 0) {
				failure = appendCleanupDiagnostics(
					failure ?? new Error("Smoke session completed but cleanup failed"),
					cleanupErrors,
				);
			} else {
				console.log(`cleanup confirmed: ${session.runDir}`);
			}
		}
	}
	if (failure) throw failure;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	main().catch((error) => {
		console.error(error.stack ?? error);
		process.exitCode = 1;
	});
}
