# roadmap.md — issue 管理バインディング（roadmap.pfdsl の companion）

この companion を読んだ後、pfd-ops スキルをロードして運用プロトコル（サイクル手順・終端ゲート・知見振り分け手続き等）を確認すること。

`roadmap.pfdsl` は issue 依存構造のみ管理する。issue の一次情報と同期手段はここに書く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## バックエンド

GitHub Issues。規約と採用手順は `.claude/skills/pfd-ops/references/github-issues-backend.md`（L3 プリセット）に従う。

## このリポのインスタンス値

- 一次情報: github.com/takasek/pfdsl/issues
- 同期監査スクリプト: `scripts/audit-issues-flow.mjs`（`--fix` で機械的修復）
- 監査対象: `.pfdsl/roadmap.pfdsl`

## 運用対象の計画 PFD

ワークサイクルの選択ステップが列挙する対象:

- `.pfdsl/roadmap.pfdsl` — オープン issue の依存グラフ

## 自動生成 PR（ワークサイクル選択前に確認）

このリポでは issue close 時に `flow-on-issue-close.yml` が `flow-sync/*` ブランチで flow-sync PR を自動起票する。サイクル開始時に `flow-sync/*` ブランチの PR が open のものがあれば CI が green であることを確認してマージ先行（コンフリクトがある場合は手動解消してからマージ）。それ以外の open PR（機能追加・バグ修正等）は「今回の着手作業に競合するか」を判断軸としてケースバイケースで確認する。

## 終端ゲート追加項目（issue 固有）

**タイミング規約**: issue クローズと flow 確定は **main への PR マージ時**に行う（生態系図 merge_pr: 成果物・進捗・issue 更新はマージで正本になる）。PR 作成時点では行わない — PR がレビューで変わる/却下される可能性があるため。サイクルが PR 作成で終わる場合、下記2項目は「マージ時に実施」と記録して未了のまま閉じてよい。**feature branch への中間 PR では `closes #xxx` を使わない** — feature branch マージ時に issue が閉じられるが、main 未到達のため誤 close になる。

汎用ゲート（status 更新 / check 通過 / 論理単位コミット / PR 集約）に加え、**マージ時に**:

- [ ] 完了した issue をクローズし、進捗・新発見を issue に反映した
- [ ] close 時の降格規則を適用した（定義は L3 reference。専属 process も含めて削除する）
- [ ] 変更が公開物の挙動を変える場合（CLI 出力・拡張機能の動作変化を含む — パスでなく挙動で判定）、npm 公開・Marketplace 公開が必要か確認した（`make release-status` で behind を確認。pending なら次サイクルの先頭タスクとして明記する）

**worktree 前提**: 新規 worktree では CLI/core が未ビルドのため `check` も snapshot 更新も失敗する。ゲート実行前に `pnpm install && pnpm -r build` を済ませる。

**Cycle 計画のパッケージ層明記**: PR body に対象パッケージ層を明記する（→ workflow.pfdsl `develop` プロセスの description 参照）。

**worktree での git 操作**: `git commit` など git コマンドは worktree ディレクトリ（`.claude/worktrees/<name>/`）から実行する。main repo パスから実行するとその HEAD ブランチ（main など）にコミットが積まれる。

**hotfix PR の明示**: 緊急修正（バグ修正、誤り修正）を PR にのせる場合は description 冒頭に `hotfix:` を明記する。レビュー優先度・マージ判断の依拠になる。

**issue 起票と roadmap 追加は同時に行う**（→ workflow.pfdsl `file_issues` プロセスの description 参照）。
