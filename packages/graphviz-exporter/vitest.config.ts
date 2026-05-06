import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@pfdsl/core": resolve(__dirname, "../core/src/index.ts"),
		},
	},
	test: { include: ["src/**/*.test.ts"] },
});
