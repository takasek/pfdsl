import { defineConfig, mergeConfig } from "vitest/config";
import { sharedCoverageConfig } from "../../vitest.shared";

export default mergeConfig(
	sharedCoverageConfig,
	defineConfig({
		test: { include: ["src/**/*.test.ts"] },
	}),
);
