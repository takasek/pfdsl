import { parseArgs } from "node:util";
import { build, context } from "esbuild";

// strict parsing, not includes("--watch"): a typo'd or --watch=true form is
// invisible to includes(), so `pnpm watch` builds once and exits as though it
// were watching (#648).
let watch;
try {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: { watch: { type: "boolean" } },
		strict: true,
		allowPositionals: false,
	});
	watch = values.watch === true;
} catch (err) {
	console.error(`esbuild.config: ${err.message}`);
	process.exit(2);
}

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
