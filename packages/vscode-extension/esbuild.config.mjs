import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
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

if (watch) {
	const ctx = await context(options);
	await ctx.watch();
} else {
	await build(options);
}
