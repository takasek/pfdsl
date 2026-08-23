# Codex worktree approval design

## Goal

Codexの通常のworktree作業で、誤tree操作を防ぐ既存の安全性を維持しながら、可変絶対パスと過剰な意味確認による承認要求を減らす。

## Observed causes

ユーザー指示がworktree対象の固定に `git -C <毎回変わる絶対パス>` を要求するため、同じ操作でもCodexのprefix ruleから見るコマンド列が毎回変わる。

ユーザー指示の「ブロック後の横滑り禁止」が、別方式への無断迂回だけでなく、fresh worktreeでbuild後に同じtestを再実行する正規手順まで停止対象として読める。

`scripts/main-commit-guard.mjs` はClaude Codeの `CLAUDE_PROJECT_DIR` だけをセッションworktreeの根として使うため、Codex hook payloadだけではsibling worktree判定が無効になる。

## Design

Codexのshell呼出しは、コマンド文字列を固定したまま `exec_command.workdir` に対象worktreeの絶対パスを毎回指定する。

workdir指定を持たないharnessでは従来どおり `git -C <absolute-worktree>`、`make -C <absolute-worktree>`、絶対script pathを使い、誤tree操作の防止を弱めない。

Codexのprefix ruleと一致させる必要があるroutine commandはRTKで包まず、`git fetch origin`、`git worktree add ...`、`make setup`、`pnpm -r build`、`pnpm test`の正規形を使う。

失敗後でも、既知の前提工程、同じ公式手順の次工程、同じ検証の再実行、同一ツールの引数訂正は追加確認なしで続ける。

認証、権限、ネットワーク、必須tool不在、破壊的操作、新しい公開先、 materially different な代替方式が必要な場合だけ停止してユーザー判断を求める。

pfdslのshared guardは `CLAUDE_PROJECT_DIR` が存在すれば従来どおりそれを優先し、存在しない場合だけPreToolUse payloadの `cwd` をセッションworktreeの根として使う。

`.claude/settings.json` と `.codex/hooks.json` の配線は変更せず、同一wrapperの入力adapterだけを両harness対応にする。

## Compatibility contract

- Claude Codeでは `CLAUDE_PROJECT_DIR` がpayloadの `cwd` より優先される。
- Codexでは `CLAUDE_PROJECT_DIR` がなくてもpayloadの `cwd` とcommand targetのGit common dirを比較できる。
- 自worktree内の通常git変更は許可される。
- main checkoutへの変更は既存どおりdefault-branch guardで拒否または確認される。
- sibling worktreeへの新規状態作成は拒否され、復旧・破壊操作は確認へ送られる。
- malformed payloadやGit解決失敗で全Bash呼出しを停止させない既存のfail-open境界は維持する。

## Non-goals

通常pushとforce-pushを同じprefix ruleで無審査にする変更は行わない。

merge、issue close、publish、branch deletion、新しいPRや公開branchの作成に対する明示確認は削除しない。

#981で進行中の中立capability modelとgenerator再編には触れない。
