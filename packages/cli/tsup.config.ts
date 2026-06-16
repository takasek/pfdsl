import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/cli.ts"],
	format: ["esm"],
	dts: { entry: ["src/index.ts"] },
	noExternal: [/^@pfdsl\//],
	external: ["@hpcc-js/wasm"],
	banner: {
		// noExternal pulls in transitive CJS deps (e.g. yaml, which ships no
		// node ESM build); esbuild's ESM output needs a real require for them.
		js: 'import { createRequire as __pfdslCreateRequire } from "node:module"; const require = __pfdslCreateRequire(import.meta.url);',
	},
	onSuccess: async () => {
		const repoRoot = resolve(__dirname, "../..");
		const src = resolve(repoRoot, ".claude/skills/pfd-ops");
		const dest = resolve(__dirname, "dist/skills/pfd-ops");
		if (!existsSync(src)) {
			throw new Error(`pfd-ops skill source not found at ${src}`);
		}
		mkdirSync(dest, { recursive: true });
		cpSync(src, dest, { recursive: true });
	},
});
