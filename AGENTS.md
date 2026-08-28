<!-- DO NOT EDIT. Authoritative source: CLAUDE.md. -->

# pfdsl

成果物管理・進捗更新・ワークフロー運用は pfd-ops スキルに従う。

## セットアップ

Claude CodeとCodexのSessionStart hookは、クローン直後・新規worktreeで `node scripts/setup-completion.mjs check` が失敗すれば `make setup` を自動実行する。`node_modules` やmarkerの存在だけはsetup完了を表さない。markerはrootとworkspaceのpackage manifests、lockfile、workspace定義、`.npmrc`、`.pnpmfile.cjs`、setup recipe、hook shim、repo skill linker、fingerprint runtimeのSHA-256を記録し、branch switch等で入力が変わればstaleになる。setup全体はworktree単位のlockで直列化され、同じinputsを待っていたrunnerはlock取得後の再checkでbodyをskipする。markerは全工程成功後に同一directory内の一時fileからatomic renameされる。session開始後にworktreeを手動作成した場合など、SessionStart hookが完了しなかった場合だけ `make setup` を1回手動実行する。依存installに加えpre-commit hookのshim（`scripts/hooks/pre-commit-shim`）を `.git/hooks/` に導入する。shimはcommit実行worktreeの `scripts/pre-commit` を都度execするため、hookの版とbranchのtree内容が常に一致する（#411）。実体はcommit時にstaged filesのBiome検査と `.pfdsl` snapshot freshnessを自動検査する。Biomeの指摘は自動修正しない。落ちたら `make format` を実行して再stageする。

## 文字列の言語

ユーザーの目に触れる文字列（`docs/samples/` のサンプル、CLI 出力、エラーメッセージ、README 等の公開ドキュメント）は英語で書く。内部向け（スキル・`docs/spec`・ADR・`.pfdsl` の運用図・companion 等、メンテナが読む資料）は日本語でよい。サンプルの `label:` も英語。判断軸は「読み手が外部ユーザーか、内部メンテナか」。

## .pfdsl ファイルの記述

`description:` / `criteria:` 等の長い文字列は、句読点（。、）の位置でのみ改行してよい。意味の切れ目でない場所での改行は禁止。短い場合は1行に収める。

frontmatter で改行する場合は folded scalar (`>`) を使う。プレーンスカラーや複数行の flow collection を書くと `fmt` が1行へ畳む。`>` の折返し位置は `fmt` / `meta set` / `sort` / `reindex` / `insert-definition` のいずれを通しても保存される（ADR-0037）。継続行のインデント幅は正準化される。保存されないのは、そのフィールド自身の値を書き換えた場合・`>2` のようにインデント指標を付けた場合・シーケンス要素として書いた場合の3つ。

## Markdown の改行

`.md` の散文は CI の `check-md-linebreaks` が検査する。改行してよいのは文境界（。！？.:等）のみで、**読点（、）での改行は違反**（.pfdsl の規約より厳しい）。段落は1文=1行か、文境界で折り返す。字下げの有無を問わず散文全体が対象（#770）。コード片・文法記法はフェンスで囲む — フェンス外に置くと散文として検査される。

## 実装方針

t-wadaのTDDで。適切な粒度でコミットすること。

### コミット粒度

論理単位ごとに分割する。1コミット = 1つの一貫した変更。Conventional Commits 準拠（`feat(scope): ...`, `refactor: ...`, `docs: ...`, `feat!: ...` 破壊的）。

ただし事後的な分割（先に一括で変更してから複数コミットへ割り直す）が中間ファイル再構成等でトークン効率を著しく損なう場合は、論理単位の純度より作業順=コミット順を優先してよい。

変更束はブランチで作業し PR で main に統合する（main 直コミットしない。生態系図の develop→PR→merge_pr が正規経路）。`scripts/main-commit-guard.mjs`（PreToolUse(Bash) hook、`.codex/hooks.json` で配線）が main ブランチ上でツリー・インデックスを変える git コマンドを機械的に止める（#650・#777）。
ブランチ上に新しい状態を作る操作はdenyにする。既存の状態を壊す・戻す操作はClaude Codeではaskだが、Codex PreToolUseはaskをサポートせずhook failure後に実行を続けるためdenyへ変換する。Codexで永続allowするroutine Gitは、実際のworkdirがhook payloadに現れない境界を避けるため、`codex-git-routine.mjs` の明示target付きsubcommandだけを使う。wrapperはGitとMakeの子processからGitのrepository・index・object・ref namespaceを変える7種類の環境変数を除去する。guardはwrapperの `stage-all`・`commit`・`branch-rename` をGit変更として認識し、コマンド文字列中のtargetをsession rootと比較する。raw commandではliteral `cd`、`git -C`、`env -C/--chdir`を順に解決し、`--git-dir`・`--work-tree`、command内またはhook processから継承したGit target環境変数とそれを後続segmentへ残すstateful shell builtin、非空のambientまたはcommand-state CDPATHによるrelative cd、inputを含む先頭redirection、dynamic cwd、未知または不完全なcommand/sudo/time prefix等で実targetを安全に確定できなければfail closedする。identity取得用Git subprocessはGit target環境変数を除去して明示cwdからrootとbranchを解決する。
読み取り系は素通しする。
どのサブコマンドがどちらに入るかは `scripts/lib/main-commit-guard.mjs` の `DENIED_SUBCOMMANDS` / `ASKED_SUBCOMMANDS` が一次情報 — ここには列挙しない。

コミットメッセージは**英語**。

直近の履歴 (`git log --oneline`) を参考にスタイルを合わせる。

## Codex 固有の責務境界

この節は本文中の git に関する指示より優先する。
親 agent が `git fetch`、stage、commit、`git push`、PR の作成・更新、issue の作成・クローズ・コメントを担当する。
subagent は worktree 内のファイル編集とテスト・検査だけを担当する。
subagent は git metadata 操作や外部公開操作を実行しない。
subagent の権限エラーはユーザーへ直接継続を求めず、親 agent へ引き上げる。
