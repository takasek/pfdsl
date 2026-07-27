import { defineConfig } from "vitest/config";

export const sharedCoverageConfig = defineConfig({
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			exclude: ["**/*.test.ts", "**/dist/**", "**/*.config.ts"],
		},
	},
});
