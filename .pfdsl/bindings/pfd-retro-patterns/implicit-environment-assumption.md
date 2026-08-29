---
tags: [context:external-dependency]
---

- **実行環境の暗黙前提 trap**: リポの運用スクリプトや CI が外部 CLI・配布バイナリ・ホスト機能の存在や権限を暗黙の前提にしていると、別のセッション種別や OS では処理本体へ到達する前に止まる。開発ホストでの成功は、CI runner の実行条件を検証しない。
  問いの形: 「この処理が前提にしている外部実行物とホスト機能は、全ての起動元セッション種別・対象 OS で利用でき、必要な権限と起動モードを満たすか」。
  具体例: `scripts/cycle-status.mjs` / `scripts/gate-check.mjs`（内部の `audit-issues-flow.mjs`）が `gh` に `execSync`/`execFileSync` で依存しており、`gh` 不在の Claude Code Remote セッションで `audit-issues-flow.mjs` が `spawnSync gh ENOENT` でクラッシュし、gate-check の残り項目の出力ごと失われた（#482 セッション、#489 で追跡）。
  具体例: VS Code webview smoke test は macOS の実 VS Code で通過したが、Ubuntu CI では展開された Electron の `chrome-sandbox` が root 所有・mode 4755 でないため CDP 起動前に `SIGTRAP` で終了した。Linux runner だけ明示的に `--no-sandbox` を渡し、platform 分岐を直接テストして解消した（#891）。
  対策: 外部実行物を導入するときは対象ホストごとの存在・権限・起動モードを列挙し、各ホストで最初の有意味な出力へ到達する smoke test を置く。代替起動モードを使う場合は適用する platform と隔離境界を明示し、その分岐を直接テストする。CLI transport の代替が必要な場合は、該当ステップを GitHub MCP のツール呼び出しで個別に置き換える（`.pfdsl/roadmap.md`「自動生成 PR」節。恒久対策は #489）。
