# roadmap.md — 作業項目管理バインディング（roadmap.pfdsl の companion）

`roadmap.pfdsl` は作業項目の依存構造のみ管理する。作業項目の一次情報と同期手段はここに書く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

雛形の出力 artifact は `status: suspended` で着手候補から外してある。
プレースホルダを実際のノード名・完了条件へ置き換えた後、着手対象の出力 artifact を `todo` に戻す。

## バックエンド

(roadmap の作業項目バックエンドとしての採否を記載する。GitHub Issues を使う場合は `<pfd-ops skill root>/references/github-issues-backend.md` を、リポ内 markdown ファイルで管理する場合は `<pfd-ops skill root>/references/file-based-tracker-backend.md` を参照する。GitHub Issues を作業項目バックエンドに採用しない場合でも、roadmap 管理外の gap 記録などに利用しているなら、その用途と参照先を別に明記する。`<pfd-ops skill root>` は plugin 経由なら `${CLAUDE_PLUGIN_ROOT}/skills/pfd-ops`。上のパスが置換されず変数名のまま見えている場合は repo-local `.claude/skills/pfd-ops` を使い、それも無ければ pfd-ops の SKILL.md を読んでいる位置から相対で辿る。)

## このリポのインスタンス値

- 一次情報: (作業項目の管理先 URL またはファイルパス)
- 同期監査スクリプト: (採用する場合は `scripts/pfdsl/audit-issues-flow.mjs` のパス)
- 監査対象: (このファイルが対応する `.pfdsl` のパス)

## 運用対象の計画 PFD

ワークサイクルの選択ステップが列挙する対象:

- (このファイルが対応する `.pfdsl` のパス)

## 終端ゲート追加項目（作業項目固有）

(汎用ゲートに加えて、このプロジェクト固有に確認すべき項目を記載する。)
