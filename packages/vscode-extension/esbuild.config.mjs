import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const extensionOptions = {
	entryPoints: ["src/extension.ts"],
	bundle: true,
	outfile: "dist/extension.cjs",
	platform: "node",
	format: "cjs",
	target: "node18",
	sourcemap: true,
	external: ["vscode"],
	logLevel: "info",
};

const webviewOptions = {
	entryPoints: ["src/webview.ts"],
	bundle: true,
	outfile: "dist/webview.js",
	platform: "browser",
	format: "esm",
	target: "es2020",
	sourcemap: true,
	logLevel: "info",
};

if (watch) {
	const [extCtx, wvCtx] = await Promise.all([
		context(extensionOptions),
		context(webviewOptions),
	]);
	await Promise.all([extCtx.watch(), wvCtx.watch()]);
} else {
	await Promise.all([build(extensionOptions), build(webviewOptions)]);
}
