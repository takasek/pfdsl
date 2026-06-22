---
name: vscode-ext-debug
description: |
  Use when debugging or verifying the VS Code extension (takasek.pfdsl) in a
  worktree. Covers launch setup, preview verification, and webview console
  filtering — invoke before running make vscode-dev or testing the extension UI.
---

# VS Code 拡張デバッグ（worktree）

## 起動

worktree ルートから `make vscode-dev` を実行する。main repo から実行すると stale な dist をロードするため必ず worktree ルートから。

コミット済み `.vscode/launch.json` があるため F5 で起動できる。`preLaunchTask` が deps+ext を自動リビルドして fresh dist を保証する。

## 検証

`.pfdsl` ファイルを開き **PFDSL: Open Preview to the Side** を使う（Markdown preview とは別コマンド）。

webview console は DevTools で `takasek.pfdsl` フィルタを入れて絞る。

## 前提

新規 worktree では `pnpm install && pnpm -r build` を済ませてから起動する（未ビルドだと拡張がロードされない）。
