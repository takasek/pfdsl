import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "tsup";

const { version } = JSON.parse(
	readFileSync(resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

export default defineConfig({
	entry: ["src/index.ts", "src/cli.ts"],
	format: ["esm"],
	dts: { entry: ["src/index.ts"] },
	noExternal: [/^@pfdsl\//],
	external: ["@hpcc-js/wasm"],
	define: {
		__PFDSL_VERSION__: JSON.stringify(version),
	},
	banner: {
		// noExternal pulls in transitive CJS deps (e.g. yaml, which ships no
		// node ESM build); esbuild's ESM output needs a real require for them.
		js: 'import { createRequire as __pfdslCreateRequire } from "node:module"; const require = __pfdslCreateRequire(import.meta.url);',
	},
});
