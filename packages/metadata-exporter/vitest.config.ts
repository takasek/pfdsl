import { resolve } from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import { sharedCoverageConfig } from "../../vitest.shared";

export default mergeConfig(
	sharedCoverageConfig,
	defineConfig({
		resolve: {
			alias: {
				"@pfdsl/core": resolve(__dirname, "../core/src/index.ts"),
			},
		},
		test: {
			include: ["src/**/*.test.ts"],
			coverage: {
				thresholds: {
					statements: 100,
					branches: 97,
					functions: 100,
					lines: 100,
				},
			},
		},
	}),
);
