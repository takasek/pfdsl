import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(
	readFileSync(resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

export default defineConfig({
	define: {
		__PFDSL_VERSION__: JSON.stringify(version),
	},
	resolve: {
		alias: {
			"@pfdsl/core": resolve(__dirname, "../core/src/index.ts"),
			"@pfdsl/graphviz-exporter": resolve(
				__dirname,
				"../graphviz-exporter/src/index.ts",
			),
			"@pfdsl/preview-engine": resolve(
				__dirname,
				"../preview-engine/src/index.ts",
			),
		},
	},
	test: { include: ["src/**/*.test.ts"], testTimeout: 30000 },
});
