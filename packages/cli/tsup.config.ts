import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/cli.ts"],
	format: ["esm"],
	dts: { entry: ["src/index.ts"] },
	noExternal: [/^@pfdsl\//],
	external: ["@hpcc-js/wasm"],
});
