import { defineConfig, mergeConfig } from "vitest/config";
import {
	sharedCoverageConfig,
	sharedCoverageExclude,
} from "../../vitest.shared";

export default mergeConfig(
	sharedCoverageConfig,
	defineConfig({
		test: {
			include: ["src/**/*.test.ts"],
			coverage: {
				// vscode API 直結層 — API 呼び出しのみでロジックを持たず、実行環境
				// (vscode extension host) 依存のため unit test で到達できない。
				// テスト可能なロジックは対応する *-logic.ts へ分離済み。
				exclude: [
					...sharedCoverageExclude,
					"**/codelens.ts",
					"**/connector.ts",
					"**/def-insertion.ts",
					"**/diagnostics.ts",
					"**/diff.ts",
					"**/document-link.ts",
					"**/export.ts",
					"**/extension.ts",
					"**/format.ts",
					"**/hover.ts",
					"**/jump.ts",
					"**/preview.ts",
					"**/sort-meta.ts",
					"**/utils.ts",
					"**/webview.ts",
				],
				thresholds: { statements: 98, branches: 86, functions: 92, lines: 98 },
			},
		},
	}),
);
