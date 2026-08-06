---
tags: [context:external-dependency]
---

- **実行環境の暗黙前提 trap**: リポの運用スクリプトが特定の CLI ツール（`gh` 等）の存在を暗黙の前提にしていると、そのツールを持たない実行環境（Claude Code Remote 等、GitHub 操作が MCP server 経由に限定されるセッション）では preflight/gate-check の一部〜全部がエラーで止まる。
  問いの形: 「このスクリプトが前提にしている外部 CLI は、全ての起動元セッション種別で利用可能か」。
  具体例: `scripts/cycle-status.mjs` / `scripts/gate-check.mjs`（内部の `audit-issues-flow.mjs`）が `gh` に `execSync`/`execFileSync` で依存しており、`gh` 不在の Claude Code Remote セッションで `audit-issues-flow.mjs` が `spawnSync gh ENOENT` でクラッシュし、gate-check の残り項目の出力ごと失われた（#482 セッション、#489 で追跡）。
  対策: 該当ステップは GitHub MCP のツール呼び出しで個別に代替できる（`.pfdsl/roadmap.md`「自動生成 PR」節に代替手順を記録）。恒久対策（`gh` 依存の解消・try/catch 化）は #489。
