import { defineConfig, mergeConfig } from "vitest/config";
import { sharedCoverageConfig } from "../../vitest.shared";

export default mergeConfig(
	sharedCoverageConfig,
	defineConfig({
		test: {
			include: ["src/**/*.test.ts"],
			coverage: {
				include: ["src/**/*.ts"],
				// This DOM integration layer was excluded in the extension; lifecycle tests exercise it separately.
				exclude: ["**/*.test.ts", "src/preview.ts"],
				thresholds: { statements: 98, branches: 86, functions: 92, lines: 98 },
			},
		},
	}),
);
