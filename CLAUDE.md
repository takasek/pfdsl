# pfdsl

成果物管理・進捗更新・ワークフロー運用は pfd-ops スキルに従う。

## セットアップ

クローン直後・新規 worktree では最初に `make setup` を実行する。依存インストールに加え pre-commit hook のシム（`scripts/hooks/pre-commit-shim`）を `.git/hooks/` に導入する。シムはコミット実行 worktree の `scripts/pre-commit` を都度 exec するため、hook の版とブランチのツリー内容が常に一致する（#411）。実体（`scripts/pre-commit`）はコミット時に staged ファイルの biome 検査（整形・lint・構文）と `.pfdsl` スナップショット鮮度を自動検査する。biome の指摘は自動修正しない — 落ちたら `make format` を実行して再 stage する。これを飛ばすとローカルコミットが検査をすり抜け、CI で初めて失敗に気付くことになる。

## 文字列の言語

ユーザーの目に触れる文字列（`docs/samples/` のサンプル、CLI 出力、エラーメッセージ、README 等の公開ドキュメント）は英語で書く。内部向け（スキル・`docs/spec`・ADR・`.pfdsl` の運用図・companion 等、メンテナが読む資料）は日本語でよい。サンプルの `label:` も英語。判断軸は「読み手が外部ユーザーか、内部メンテナか」。

## .pfdsl ファイルの記述

`description:` / `criteria:` 等の長い文字列は、句読点（。、）の位置でのみ改行してよい。意味の切れ目でない場所での改行は禁止。短い場合は1行に収める。

## Markdown の改行

`.md` の散文は CI の `check-md-linebreaks` が検査する。改行してよいのは文境界（。！？.:等）のみで、**読点（、）での改行は違反**（.pfdsl の規約より厳しい）。段落は1文=1行か、文境界で折り返す。

## 実装方針

t-wadaのTDDで。適切な粒度でコミットすること。

### コミット粒度

論理単位ごとに分割する。1コミット = 1つの一貫した変更。Conventional Commits 準拠（`feat(scope): ...`, `refactor: ...`, `docs: ...`, `feat!: ...` 破壊的）。

ただし事後的な分割（先に一括で変更してから複数コミットへ割り直す）が中間ファイル再構成等でトークン効率を著しく損なう場合は、論理単位の純度より作業順=コミット順を優先してよい。

変更束はブランチで作業し PR で main に統合する（main 直コミットしない。生態系図の develop→PR→merge_pr が正規経路）。`scripts/main-commit-guard.mjs`（PreToolUse(Bash) hook、`.claude/settings.json` で配線）が main ブランチ上でツリー・インデックスを変える git コマンドを機械的に止める（#650・#777）。`commit` / `add` / `rm` / `mv` / `apply` / `am` は deny（worktree で同じことをするのが等価な代替）、`reset` / `restore` / `checkout` / `switch` / `stash` / `clean` / `merge` / `rebase` / `cherry-pick` / `revert` は ask（事故と main ツリー復旧手順を payload から区別できないため人間に渡す）。

コミットメッセージは**英語**。

直近の履歴 (`git log --oneline`) を参考にスタイルを合わせる。
