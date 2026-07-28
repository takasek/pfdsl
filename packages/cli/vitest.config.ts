import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import { sharedCoverageConfig } from "../../vitest.shared";

const { version } = JSON.parse(
	readFileSync(resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

export default mergeConfig(
	sharedCoverageConfig,
	defineConfig({
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
		test: {
			include: ["src/**/*.test.ts"],
			testTimeout: 30000,
			coverage: {
				thresholds: { statements: 98, branches: 87, functions: 97, lines: 98 },
			},
		},
	}),
);
