import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isCliEntrypoint } from "../lib/cli-entrypoint.mjs";

const expectedHashes = {
	"smoke/run.mjs":
		"188cf1b8035f88c96cea9fe8e179f73f446a57b33fdb2b650ce2f14fda20a278",
	"src/extension.ts":
		"2d8f563c3fb569ca5fbb5241537d0a6cecdef3c3ea3ff114e8bbd05d224d7d7f",
	"src/preview.ts":
		"5dd60bfcd8f43a57b0ad786e569760527f8ab01463fd38be1127ddf751328a07",
	"src/def-insertion.ts":
		"e917f756eb2777572fd69dfd36c482e375deee7ac3b95cda2a62474026bd93fa",
	"src/document-link.ts":
		"a065e98dc8851caa40c8be70a3878aeab5b18fc06cb88fb3d558acac16fbdf2d",
	"src/hover.ts":
		"5ec5ead8089343915a0be11f6750861b299969819cc3d6119ee62ae2e88e37cf",
};

export function replaceOnce(source, before, after) {
	if (source.split(before).length !== 2) {
		throw new Error(
			`Instrumentation anchor must occur exactly once: ${before}`,
		);
	}
	return source.replace(before, after);
}

function diagnosticImport(symbols, modulePath) {
	return `import { ${symbols} } from ${JSON.stringify(modulePath)};\n`;
}

export function instrumentRunner(source) {
	let result = source;
	const start = result.indexOf("export async function closeSourceTab(");
	const end = result.indexOf("\nasync function submitQuickInput", start);
	if (start < 0 || end < 0) throw new Error("Missing closeSourceTab boundary");
	let close = result.slice(start, end);
	close = replaceOnce(
		close,
		"return withWorkbenchOperation(",
		"return closeTrace(page, sourceTab, () => withWorkbenchOperation(",
	);
	close = replaceOnce(
		close,
		".click();",
		'.click();\n\t\t\tawait checkpoint(page, "close-click-returned");',
	);
	close = replaceOnce(close, "\n\t);\n}", "\n\t));\n}");
	result = result.slice(0, start) + close + result.slice(end);
	result = replaceOnce(
		result,
		"page = await waitForWorkbenchPage(browser);",
		"page = await waitForWorkbenchPage(browser);\n\t\tawait installTrace(page);",
	);
	result = replaceOnce(
		result,
		"const cleanupErrors = await cleanupSmokeSession({",
		"await preserveSession({ page, profileDir, fixturePath: undefined, output, vscodeProcess });\n\t\tconst cleanupErrors = await cleanupSmokeSession({",
	);
	result = replaceOnce(
		result,
		"const cleanupErrors = await cleanupSmokeSession(session);",
		"await preserveSession(session);\n\t\t\tconst cleanupErrors = await cleanupSmokeSession(session);",
	);
	return (
		diagnosticImport(
			"installTrace, closeTrace, checkpoint, preserveSession",
			"./trace-workbench.mjs",
		) + result
	);
}

export function prepare(root) {
	const extensionRoot = join(root, "packages/vscode-extension");
	// Check every input before writing any of them. This diagnostic is tied to one source revision.
	const sources = Object.entries(expectedHashes).map(([path, expected]) => {
		const source = readFileSync(join(extensionRoot, path), "utf8");
		if (createHash("sha256").update(source).digest("hex") !== expected) {
			throw new Error(`Unexpected baseline hash: ${path}`);
		}
		return [path, source];
	});
	const outputs = sources.map(([path, source]) => {
		if (path === "smoke/run.mjs") return [path, instrumentRunner(source)];
		if (path === "src/extension.ts") {
			return [
				path,
				diagnosticImport("registerTrace", "./trace.js") +
					replaceOnce(
						source,
						"export function activate(context: vscode.ExtensionContext): void {",
						"export function activate(context: vscode.ExtensionContext): void {\n\tregisterTrace(context);",
					),
			];
		}
		let ordinal = 0;
		return [
			path,
			diagnosticImport("traceShowTextDocument", "./trace.js") +
				source.replaceAll(
					"vscode.window.showTextDocument(",
					() => `traceShowTextDocument("${path}:${++ordinal}", `,
				),
		];
	});
	for (const [path, source] of outputs)
		writeFileSync(join(extensionRoot, path), source);
	copyFileSync(
		new URL("trace.ts", import.meta.url),
		join(extensionRoot, "src/trace.ts"),
	);
	copyFileSync(
		new URL("trace-workbench.mjs", import.meta.url),
		join(extensionRoot, "smoke/trace-workbench.mjs"),
	);
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	const { positionals } = parseArgs({ allowPositionals: true, strict: true });
	if (positionals.length !== 1)
		throw new Error("Usage: prepare.mjs <fixed-source-root>");
	prepare(positionals[0]);
}
