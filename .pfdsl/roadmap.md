# roadmap.md — issue 管理バインディング（roadmap.pfdsl の companion）

この companion を読んだ後、pfd-ops スキルが未ロードならロードして運用プロトコル（サイクル手順・終端ゲート・知見振り分け手続き等）を確認すること（ロード済みなら再ロード不要）。

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

**タイミング規約**: issue クローズと flow 確定は **main への PR マージ時**に行う（生態系図 merge_pr: 成果物・進捗・issue 更新はマージで正本になる）。PR 作成時点では行わない — PR がレビューで変わる/却下される可能性があるため。サイクルが PR 作成で終わる場合、下記2項目は「マージ時に実施」と記録して未了のまま閉じてよい。**feature branch への中間 PR では `closes #xxx` を使わない**（理由と規約は L3 reference「PR 本文規約」が一次情報）。

**着手時**: develop ブランチを切った時点で、実装対象の出力 artifact を `todo → wip` に更新する（workflow.md「develop 着手時の artifact status 更新」）。PR 作成・マージを待たない。

汎用ゲート（status 更新 / check 通過 / 論理単位コミット / PR 集約）に加え、**マージ時に**:

- [ ] 完了した issue をクローズし、進捗・新発見を issue に反映した
- [ ] close 時の降格規則を適用した（定義は L3 reference。専属 process も含めて削除する）
- [ ] 変更が公開物の挙動・同梱内容を変える場合（CLI 出力・拡張機能の動作変化に加え、skill sync 同梱物 = `.claude/skills/` の配布4スキル・pfd-* コマンドの変更を含む — パスでなく挙動と同梱内容で判定）、npm 公開・Marketplace 公開が必要か確認した（`make release-status` で behind を確認。pending なら次サイクルの先頭タスクとして明記する）
- [ ] CLIコマンドを追加・変更した場合、HELP テキスト（`packages/cli/src/index.ts`）と README のコマンド一覧の両方を更新した

**worktree 前提**: 新規 worktree では CLI/core が未ビルドのため `check` も snapshot 更新も失敗する。ゲート実行前に `pnpm install && pnpm -r build` を済ませる。`make gen-samples` は graphviz の `dot` バイナリを要求する。web/worktree 環境には未インストールのことがあるため、未導入なら `apt-get install graphviz` 等で先に用意する。ビルド後は `npx @pfdsl/cli@latest` でなく `node packages/cli/dist/cli.js` を使う（`npx` は npm の公開バージョンを使うため、未リリースの status 値等が V008 エラーになる）。

**vscode-extension を変更した場合**: `pnpm --filter @pfdsl/vscode-extension typecheck` を実行してエラーがないことを確認してからコミットする。`noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` の strict 設定により、他パッケージの型変更が vscode-extension 側でエラーを起こす場合がある。クリック・ホバー等の UI 挙動変更（DocumentLinkProvider・HoverProvider 等）を含む場合は `/vscode-ext-debug` スキルで PR 作成前に実動作確認し、ユーザーの確認結果を受け取るまで完了とみなさない。

**`docs/spec/spec.md` / `docs/samples/` を変更した場合**: workflow.md「生成物の再生成と自動ドリフト検査」に従う（再生成手続きの一次情報はそちら。ここには複製しない）。

**Cycle 計画のパッケージ層明記**: PR body に対象パッケージ層を明記する（→ workflow.pfdsl `develop` プロセスの description 参照）。

**PR 本文の `Closes` キーワード確認**: L3 reference「PR 本文規約」に従う（main 直接マージのみ使用・中間 PR では使わない）。

**worktree での git 操作**: `git commit` など git コマンドは worktree ディレクトリ（`.claude/worktrees/<name>/`）から実行する。main repo パスから実行するとその HEAD ブランチ（main など）にコミットが積まれる。

**hotfix PR の明示**: 緊急修正（バグ修正、誤り修正）を PR にのせる場合は description 冒頭に `hotfix:` を明記する。レビュー優先度・マージ判断の依拠になる。

**`flow:managed` issue の起票と roadmap 追加は同時に行う**（→ workflow.pfdsl `file_issues` プロセスの description 参照）。`flow:exempt`（保守・基盤・修正など roadmap 非管理。判定は L3 reference の「ラベル判定基準」）は roadmap に登録しない。

**新 frontmatter フィールドを追加した場合**: 対応する feature sample（`docs/samples/`）を同一 PR で追加する（生成物 `.dot` / README / `references/` の再生成・ドリフト検査は pre-commit と CI が強制する）。加えて `packages/core/src/__fixtures__/pipeline-scale.pfdsl` にもそのフィールドを追記する（fixture がスナップショットの入力であり、feature sample とは別に網羅性を担う）。

**`make gen-samples` 実行後**: 全 `.svg` が再生成されるが、`.svg` は graphviz のバージョンに依存して描画差分が出る。今回追加・変更したサンプルの `.pfdsl` / `.dot` / `.svg` のみをステージし、無関係なサンプルの `.svg` 差分（バージョン差由来）は `git checkout` で戻してからコミットする。`.dot` と README は決定論的（純 JS）のため差分はそのまま採用してよい。

- [ ] このサイクルで起票した issue を `flow:managed` / `flow:exempt` に分類した（判定は L3 reference の「ラベル判定基準」。保守・基盤・修正は exempt）
- [ ] `flow:managed` の issue がすべて roadmap.pfdsl の artifact として登録済みか確認した（exempt は登録しない）
- [ ] `node scripts/audit-issues-flow.mjs` が差分なしで通過した（手動追記した `updated_at` のズレを機械的に検出する）

**spec バージョン artifact の issue 管理**: `spec_vXXX` 系の artifact（spec_v007 / spec_v008 / spec_v009 等）は GH issue 管理対象外。「完了した issue をクローズ」ゲートは NA とする（artifact の criteria 達成のみで完了を判断する）。

**spec 統合プロセスの前バージョン入力**: 新しい `integrate_spec_vXXX` プロセスを roadmap に追加する際は、前バージョンの spec artifact を `>>?` フィードバック入力として追加する（例: `spec_v008 >>? integrate_spec_v009`）。`integrate_spec` が `spec_v006 >>?` を持つのと同じパターン。

**`integrate_spec_vXXX` の入力列挙**: `integrate_spec_vXXX` の通常入力には、そのバージョンで spec に統合される全ての変更を引き起こした artifact を列挙する。「実装が完了した artifact のうち、未統合のもの」を漏らさず書く（例: basepath と ready_cmd の両方が v0.0.10 の変更点なら `[basepath, ready_cmd] >> integrate_spec_v0010`）。

**publish 系 artifact を新規追加するとき**: 追加前に `make release-status` を実行し、現行リリース済みバージョンを確認してから次バージョンの artifact を起こす。確認せずに追加すると、已リリースのバージョンを「次期」として登録する drift が発生する。

**publish_cli_vXXXX の入力列挙**: そのバージョンに含まれる全実装 artifact を入力として列挙する。実装 artifact の追加と同一サイクルで publish の入力集合も更新する（後回しにすると artifact が publish チェーンから切れる）。
