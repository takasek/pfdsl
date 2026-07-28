import { resolve } from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import { sharedCoverageConfig } from "../../vitest.shared";

export default mergeConfig(
	sharedCoverageConfig,
	defineConfig({
		resolve: {
			alias: {
				"@pfdsl/core": resolve(__dirname, "../core/src/index.ts"),
				"@pfdsl/graphviz-exporter": resolve(
					__dirname,
					"../graphviz-exporter/src/index.ts",
				),
			},
		},
		test: {
			include: ["src/**/*.test.ts"],
			testTimeout: 30000,
			coverage: {
				thresholds: {
					statements: 100,
					branches: 100,
					functions: 100,
					lines: 100,
				},
			},
		},
	}),
);
