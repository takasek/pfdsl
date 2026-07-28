import { defineConfig, mergeConfig } from "vitest/config";
import { sharedCoverageConfig } from "../../vitest.shared";

export default mergeConfig(
	sharedCoverageConfig,
	defineConfig({
		test: {
			globals: false,
			coverage: {
				thresholds: { statements: 99, branches: 91, functions: 99, lines: 99 },
			},
		},
	}),
);
