# roadmap.md — issue 管理バインディング（roadmap.pfdsl の companion）

`roadmap.pfdsl` は issue 依存構造のみ管理する。issue の一次情報と同期手段はここに書く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## バックエンド

(採用するバックエンドを記載する。GitHub Issues を使う場合は `<pfd-ops skill root>/references/github-issues-backend.md` を参照。`<pfd-ops skill root>` は plugin 経由なら `${CLAUDE_PLUGIN_ROOT}/skills/pfd-ops`。上のパスが置換されず変数名のまま見えている場合は repo-local `.claude/skills/pfd-ops` を使う。)

## このリポのインスタンス値

- 一次情報: (issue 管理先の URL)
- 同期監査スクリプト: (採用する場合は `scripts/audit-issues-flow.mjs` のパス)
- 監査対象: (このファイルが対応する `.pfdsl` のパス)

## 運用対象の計画 PFD

ワークサイクルの選択ステップが列挙する対象:

- (このファイルが対応する `.pfdsl` のパス)

## 自動生成 PR（ワークサイクル選択前に確認）

(issue close 等で自動生成される PR がある場合はここに記載する。なければ「なし」と明記する。)

## 終端ゲート追加項目（issue 固有）

(汎用ゲートに加えて、このプロジェクト固有に確認すべき項目を記載する。)
