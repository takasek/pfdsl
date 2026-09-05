<!-- DO NOT EDIT. Authoritative source: CLAUDE.md. -->

# pfdsl

成果物管理・進捗更新・ワークフロー運用は pfd-ops スキルに従う。

## セットアップ

Claude CodeとCodexのSessionStart hookは、クローン直後・新規worktreeで `node scripts/setup-completion.mjs check` が失敗すれば `make setup` を自動実行する。`check` はmarkerのfingerprint一致に加え、rootのmanifestと、`packages/`直下の各ディレクトリから読み取り・解析できたmanifestが宣言する依存を検査する。各依存の`node_modules/<name>`と依存自身の`package.json`が実在・解析可能であり、`bin`がstringなら依存manifestの`name`（なければ依存キー）、objectなら各キーをpnpmの規則でbasename化して導出したshimが同じmanifestの`node_modules/.bin/`に通常ファイルとして実在し、`0o111`の実行ビットを持つことを確認する。`bin`を宣言しない依存にはshimを要求せず、manifestがない、読み取れない、または解析できない`packages/`直下のディレクトリは検査対象から除外する。markerはrootとworkspaceのpackage manifests、lockfile、workspace定義、`.npmrc`、`.pnpmfile.cjs`、setup recipe、hook shim、repo skill linker、fingerprint runtimeのSHA-256を記録し、branch switch等で入力が変わればstaleになる。setup全体はworktree単位のlockで直列化され、同じinputsを待っていたrunnerはlock取得後の再checkでbodyをskipする。markerは全工程成功後に同一directory内の一時fileからatomic renameされる。session開始後にworktreeを手動作成した場合など、SessionStart hookが完了しなかった場合だけ `make setup` を1回手動実行する。依存installに加えpre-commit hookのshim（`scripts/hooks/pre-commit-shim`）を `.git/hooks/` に導入する。shimはcommit実行worktreeの `scripts/pre-commit` を都度execするため、hookの版とbranchのtree内容が常に一致する（#411）。実体はcommit時にstaged filesのBiome検査と `.pfdsl` snapshot freshnessを自動検査する。Biomeの指摘は自動修正しない。落ちたら `make format` を実行して再stageする。

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

変更束はブランチで作業し PR で main に統合する（main 直コミットしない。生態系図の develop→PR→merge_pr が正規経路）。`scripts/main-commit-guard.mjs`（PreToolUse(Bash) hook）は、mainまたはsibling worktreeを対象にする変更系Gitを保護する。ツールに渡すパスと実行worktreeを一致させる。
新しい状態を作る操作はdenyとし、破壊・復元操作はClaude Codeでask、askを表現できないCodexでfail-closed denyとする。変更系Gitの実効targetをshell構文から確定できない場合もfail closedとする。分類と構文対応の一次情報は `scripts/lib/main-commit-guard.mjs` とする。
リポジトリのCodexでroutine Gitを実行するときは、trusted-root検証付き `codex-git-routine.mjs` の明示target付きsubcommandを使う。raw Gitは永続allowしない。Claude Codeにはこのuser-level wrapperを前提としない。

コミットメッセージは**英語**。

直近の履歴 (`git log --oneline`) を参考にスタイルを合わせる。

## Codex 固有の責務境界

この節は本文中の git に関する指示より優先する。
親 agent が `git fetch`、stage、commit、`git push`、PR の作成・更新、issue の作成・クローズ・コメントを担当する。
subagent は worktree 内のファイル編集とテスト・検査だけを担当する。
subagent は git metadata 操作や外部公開操作を実行しない。
subagent の権限エラーはユーザーへ直接継続を求めず、親 agent へ引き上げる。
