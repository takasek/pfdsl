<!-- DO NOT EDIT. Authoritative source: scripts/root-instructions-template/INSTRUCTIONS.md. -->

# pfdsl

成果物管理・進捗更新・ワークフロー運用は pfd-ops スキルに従う。作業サイクルの開始時に `.pfdsl/workflow.md` の実行・検証手続きを確認する。
作業の開始時に `.pfdsl/bindings/pfd-ops.md`「このリポの作業規律」を読み、作業サイクルの手順1〜3の各段と終端ゲートで、その節の該当小見出しに従う。

## 作業量と確認

ユーザーが許可した範囲の通常作業は、工程が移るたびに再承認を求めない。
小さな修正や方式が確定した作業に設計承認を追加せず、結果を大きく変える未決事項がある場合と、ユーザーが明示した待機点で確認する。
この方針はスキルの定型手順にも適用する。公開・破壊的操作・権限の拡張は、利用中のハーネスとユーザーの承認範囲に従う。

## PR 操作の承認範囲

PR 本文と issue 連携の規約は、pfd-ops が roadmap companion の採用宣言から解決するバックエンド reference に従う。
PR 作成・更新が承認済みなら、その対象・範囲に対応する issue のクローズ参照を本文に追加するためだけの再確認は不要とする。
ユーザーが指定した issue の OPEN 維持などの限定は守る。本文のクローズ参照は将来のマージ時の設定であり、即時の issue close や PR merge を実行する承認にはならない。

## Claude Code の作業分担

Claude Code では Opus を中心に作業を進め、調査・実装を必要に応じて委譲する。
Claude Code のコード変更では自己レビューに加えて別主体のレビューを行い、観点と実施条件は `.pfdsl/workflow.md` の「レビューの観点と記録」「レビューの実施と手段」に従う。

## セットアップ

Claude CodeとCodexのSessionStart hookが、このworktreeのセットアップを検査し、未完了または古い場合は `make setup` を実行する。
手動でworktreeを作成した場合など、hookによるセットアップが完了していない場合は `make setup` を実行し、`node scripts/setup-completion.mjs check` の成功を確認してから作業する。
`make setup` は依存関係の準備と、共有hook shim・worktreeのスキルリンクの配置を分ける。
依存のmarkerが有効ならhook・リンクだけを修復し、依存を再installしない。
共有hook shimはコミット先worktreeの `scripts/pre-commit` だけを呼ぶ。
checkout側の `scripts/hooks/check-default-branch` がorigin/HEAD・HEADを検証してdefault branchと不明・異常な参照を拒否し、続いて `scripts/pre-commit` が通常検査を実行する。
共有shimはcommon dirのlock内で実行可能な一時ファイルをatomicに置換し、setup判定はcheckoutのshimとの完全一致を要求する。
異なる内容の既存hookとcustom hooksPathを自動上書きしない。
既存hookが異なる場合は、内容と対象を確認して現行shimへ明示的に置き換えてからsetupする。
旧checkout・旧shimとの後方互換や自動移行は提供しない。
Biomeの指摘は自動修正されないため、失敗時は `make format` を実行して再stageする。
完了判定・依存検査は `scripts/setup-completion.mjs`、共有shimの排他・配置は `scripts/shared-hooks.mjs`、配置と検査の入口は `Makefile` の `setup` / `setup-deps` / `setup-artifacts` / `preflight` を参照する。

## 検査コマンド

`make test` と `make typecheck` は依存する `build` を自動実行するため、新規 worktree でもこの全体入口を直接使う。
単独packageのテストや `dist` を直接読む検査を実行する場合は、必要な `make build` を先に通す。
`make test` は各パッケージのテストと `scripts/` `hooks/` の `node --test`、import・shell 文字列・CLI 規約の検査を通しで回す。
`make lint` は Biome、`make typecheck` は型検査、`make coverage` はカバレッジ。
単一ファイルは `node --test <path>` で直接回せる。

## 文字列の言語

ユーザーの目に触れる文字列（`docs/samples/` のサンプル、CLI 出力、エラーメッセージ、README 等の公開ドキュメント）は英語で書く。内部向け（スキル・`docs/spec`・ADR・`.pfdsl` の運用図・companion 等、メンテナが読む資料）は日本語でよい。サンプルの `label:` も英語。判断軸は「読み手が外部ユーザーか、内部メンテナか」。

## .pfdsl ファイルの記述

`description:` / `criteria:` 等の長い文字列は、句読点（。、）の位置でのみ改行してよい。意味の切れ目でない場所での改行は禁止。短い場合は1行に収める。

frontmatter で改行する場合は folded scalar (`>`) を使う。プレーンスカラーや複数行の flow collection を書くと `fmt` が1行へ畳む。`>` の折返し位置は `fmt` / `meta set` / `sort` / `reindex` / `insert-definition` のいずれを通しても保存される（ADR-0037）。継続行のインデント幅は正準化される。保存されないのは、そのフィールド自身の値を書き換えた場合・`>2` のようにインデント指標を付けた場合・シーケンス要素として書いた場合の3つ。

## Markdown の改行

`.md` の散文は pre-commit の `md-linebreaks` gate が staged ファイルを検査する。改行してよいのは文境界（。！？.:等）のみで、**読点（、）での改行は違反**（.pfdsl の規約より厳しい）。段落は1文=1行か、文境界で折り返す。字下げの有無を問わず散文全体が対象（#770）。コード片・文法記法はフェンスで囲む — フェンス外に置くと散文として検査される。

## Markdown の見出し

手続きの見出しには、起動コマンド名よりも内容を表す名前を推奨する。
この指針は機械検査しない。

## 実装方針

t-wadaのTDDで。適切な粒度でコミットすること。

### コミット粒度

論理単位ごとに分割する。1コミット = 1つの一貫した変更。Conventional Commits 準拠（`feat(scope): ...`, `refactor: ...`, `docs: ...`, `feat!: ...` 破壊的）。

ただし事後的な分割（先に一括で変更してから複数コミットへ割り直す）が中間ファイル再構成等でトークン効率を著しく損なう場合は、論理単位の純度より作業順=コミット順を優先してよい。

変更束はブランチで作業し PR で main に統合する（main 直コミットしない）。
`scripts/agent-operation-guard.mjs` は Bash・GitHub MCP・Edit・Write・apply_patch の操作先と責務を、ADR-0047 の有限の判定表で判定する。
primary・default branch・検査回避・PR 統合・別 worktree の変更を保護し、own での通常作業を許可する。
session の起点と native 所有証拠は所有判定に使い、実行先は literal な先頭 cd の AND-list、git -C、削除対象、書込み先の物理パスから決める。
同じ命令文字列の pushd・popd、Git target 環境変数・CDPATH の literal な名前への書込みは、変更系 Git を unresolved にする。値や実行順序は追跡しない。
literal な shell -c・eval の内側も同じ規則で分類し、source・dot が読む file の中身は保証外とする。
other-live・other-unowned の変更は全主体 deny とし、own の repository 設定だけ Claude 親 ask とする。
Claude subagent の外向き書込みは親へ返し、agent_type の許可表にある issue-worker だけを例外とする。
Codex の子は読取と own の通常ファイルの書込みだけを担当する。
ロード故障・同期停止・未解決入力は回復先を示して deny し、parser 欠落時は案内にある hook root 固定の回復コマンドだけを許可する。
保証外の shell・Git 構文を増やさず、未決点は所有者へ記録する。

コミットメッセージは**英語**。

直近の履歴 (`git log --oneline`) を参考にスタイルを合わせる。
