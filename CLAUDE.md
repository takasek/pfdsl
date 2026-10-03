<!-- DO NOT EDIT. Authoritative source: scripts/root-instructions-template/INSTRUCTIONS.md. -->

# pfdsl

成果物管理・進捗更新・ワークフロー運用は pfd-ops スキルに従う。作業サイクルの開始時に `.pfdsl/workflow.md` の実行・検証手続きを確認する。

## 作業量と確認

ユーザーが許可した範囲の通常作業は、工程が移るたびに再承認を求めない。
小さな修正や方式が確定した作業に設計承認を追加せず、結果を大きく変える未決事項がある場合と、ユーザーが明示した待機点で確認する。
この方針はスキルの定型手順にも適用する。公開・破壊的操作・権限の拡張は、利用中のハーネスとユーザーの承認範囲に従う。

## Claude Code の作業分担

Claude Code では Opus を中心に作業を進め、調査・実装を必要に応じて委譲する。
Claude Code のコード変更では自己レビューに加えて別主体のレビューを行い、観点と実施条件は `.pfdsl/workflow.md` の「レビューの観点と記録」「レビューの実施と手段」に従う。

## セットアップ

Claude CodeとCodexのSessionStart hookが、このworktreeのセットアップを検査し、未完了または古い場合は `make setup` を実行する。
手動でworktreeを作成した場合など、hookによるセットアップが完了していない場合は `make setup` を実行し、`node scripts/setup-completion.mjs check` の成功を確認してから作業する。
`make setup` は依存関係とスキルリンクを整え、コミット先worktreeの `scripts/pre-commit` を実行するhook shimを導入する。
Biomeの指摘は自動修正されないため、失敗時は `make format` を実行して再stageする。
完了判定・依存検査・並行実行制御の詳細は `scripts/setup-completion.mjs`、セットアップ内容は `Makefile` の `setup` / `setup-unlocked` を参照する。

## 検査コマンド

新規 worktree では `make build` を先に通し、その後 `make test` を実行する（build 前の `make test` は packages/vscode-extension のテストで落ちる。2026-09-18 実測）。
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

変更束はブランチで作業し PR で main に統合する（main 直コミットしない。生態系図の develop→PR→merge_pr が正規経路）。タスクが決まった後、編集前に適切な worktree を選び、ブランチはその場所で命名する。意味ある名前を付けるためだけに worktree やチャットを作り直さない。`scripts/main-commit-guard.mjs` は明示された操作対象のブランチとリポジトリを検査する。
main上では新しい状態を作る操作をdenyとし、破壊・復元操作はClaude Codeでask、askを表現できないCodexでfail-closed denyとする。
session root はリポジトリの範囲を定める入力であり、worktree の所有権や実効実行場所の証明には使わない。同じリポジトリの feature checkout は対象を明示して操作できる。共有の有無と他者の変更は agent が事前に確認し、書込み権限は harness と sandbox に従う。
保護の範囲はこのリポジトリのcheckoutに限る。targetのgit common dirがsessionのものと異なれば、ブランチ名が `main` でも素通しする（使い捨てsandboxの既定ブランチが `main` になるため）。
変更系Gitの実効 target を確定できない場合は fail closed とする。Codex の hook payload.cwd は session の場所なので、`git -C /absolute/worktree ...`、`make -C /absolute/worktree ...`、`cd /absolute/worktree && node ...` のように操作対象を命令内にも明示する。ツールの workdir とファイル操作の絶対パスも同じ checkout に固定する。絶対 Node script path は process.cwd() を変えない。shell の `cd` に `..` を含めず、対象の正準な絶対パスを使う（logical cd と Git の physical chdir は異なる）。
環境状態を設定・解除する命令、複雑な制御構文、branch や repository の状態変更は、後続の変更系 Git・検証と別のツール呼出しに分ける。ガードは解除の成否や shell mode を予測して同じ呼出しの続行を許可しない。version/help の直接読取りは維持する。
検査を飛ばすコマンド（`--no-verify`/`-n`、`-c`・`--config-env`・`git config` 経由の `core.hooksPath` 上書き）はforeign target以外、branch・worktreeを問わずdenyとし、`git config` の `--global`/`--system`/`--file`・`-f`（`--file`・`-f` は指す先を問わず対象）はforeign targetでもdenyとする（#1232）。
session または target の git roots を解決できない場合は管轄外と区別し、ブランチ名規則を適用したままにする。ファイル編集は対象の checkout とブランチを確認し、保護ブランチまたは未解決の対象を拒否する。生成された root instructions は対象 checkout の正本へ案内する。ガードは任意の program 内部、他者の専有や検査後の競合を保証しない。分類と対応形式の一次情報は `scripts/lib/main-commit-guard.mjs` と `scripts/lib/shell-context.mjs` とする。

コミットメッセージは**英語**。

直近の履歴 (`git log --oneline`) を参考にスタイルを合わせる。
