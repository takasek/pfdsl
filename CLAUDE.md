# pfdsl

成果物管理・進捗更新・ワークフロー運用は pfd-ops スキルに従う。

## セットアップ

Claude CodeとCodexのSessionStart hookは、クローン直後・新規 worktreeで `node_modules` がなければ `make setup` を自動実行する。hook実行後にagentが同じsetupを重ねて実行しない。session開始後にworktreeを手動作成した場合など、hookがそのworktreeで未実行かつ `node_modules` がない場合だけ `make setup` を1回実行する。依存インストールに加え pre-commit hook のシム（`scripts/hooks/pre-commit-shim`）を `.git/hooks/` に導入する。シムはコミット実行 worktree の `scripts/pre-commit` を都度 exec するため、hook の版とブランチのツリー内容が常に一致する（#411）。実体（`scripts/pre-commit`）はコミット時に staged ファイルの biome 検査（整形・lint・構文）と `.pfdsl` スナップショット鮮度を自動検査する。biome の指摘は自動修正しない — 落ちたら `make format` を実行して再 stage する。これを飛ばすとローカルコミットが検査をすり抜け、CI で初めて失敗に気付くことになる。

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

変更束はブランチで作業し PR で main に統合する（main 直コミットしない。生態系図の develop→PR→merge_pr が正規経路）。`scripts/main-commit-guard.mjs`（PreToolUse(Bash) hook、`.claude/settings.json` で配線）が main ブランチ上でツリー・インデックスを変える git コマンドを機械的に止める（#650・#777）。
ブランチ上に新しい状態を作る操作は deny（「worktree で同じことをする」が等価な代替になるため）、既存の状態を壊す・戻す操作は ask（事故と main ツリー復旧手順を payload から区別できないため人間に渡す）。
読み取り系は素通しする。
どのサブコマンドがどちらに入るかは `scripts/lib/main-commit-guard.mjs` の `DENIED_SUBCOMMANDS` / `ASKED_SUBCOMMANDS` が一次情報 — ここには列挙しない。

コミットメッセージは**英語**。

直近の履歴 (`git log --oneline`) を参考にスタイルを合わせる。
