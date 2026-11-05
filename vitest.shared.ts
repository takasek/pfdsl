import { defineConfig } from "vitest/config";

export const sharedCoverageExclude = [
	"**/*.test.ts",
	"**/dist/**",
	"**/*.config.ts",
	"**/*.config.mjs",
];

export const sharedCoverageConfig = defineConfig({
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			exclude: sharedCoverageExclude,
		},
	},
});
