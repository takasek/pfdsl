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
				include: ["src/**/*.ts"],
				// 宿主 API 直結層 — 実行環境（vscode extension host、または
				// webview の document）に依存し、unit test から import した時点で
				// 成立しないファイル。判断・算術はいずれも対応する *-logic.ts か
				// 共有モジュールへ出し、ここに残るのは API 呼び出しと配線のみ。
				//
				// webview.ts だけは vscode API でなく DOM 直結（読み込み時に
				// acquireVsCodeApi と getElementById を実行する）。pan / zoom /
				// minimap の算術と preview.ts の判定は @pfdsl/editor、
				// ready・差分保留・配送・破棄の状態管理は
				// preview-controller.ts、ディレクトリ展開は expand-directory.ts、
				// connector の入力検証は @pfdsl/editor、codelens の行判定は
				// codelens-logic.ts、export の命名と部分失敗の集約は
				// export-logic.ts にあり、いずれもこのリストの外でテストされている
				// （#611, #634）。
				// preview.ts の controller 接続は src/preview.test.ts が小さな
				// fake host で検査する。実 webview の輸送・DOM 描画の証明ではない。
				//
				// このリストの内容は src/coverage-exclusions.test.ts が固定する。
				// 除外の追加は floor を保ったまま計測対象を減らせるため、無審査で
				// 通らないようにする（#634）。
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
