# Codex worktree approval design

## Goal

Codexの通常のworktree作業で、誤tree操作を防ぐ既存の安全性を維持しながら、可変絶対パスと過剰な意味確認による承認要求を減らす。

## Observed causes

ユーザー指示がworktree対象の固定に `git -C <毎回変わる絶対パス>` を要求するため、同じ操作でもCodexのprefix ruleから見るコマンド列が毎回変わる。

ユーザー指示の「ブロック後の横滑り禁止」が、別方式への無断迂回だけでなく、fresh worktreeでbuild後に同じtestを再実行する正規手順まで停止対象として読める。

`scripts/main-commit-guard.mjs` はClaude Codeの `CLAUDE_PROJECT_DIR` だけをセッションworktreeの根として使うため、Codex hook payloadだけではsibling worktree判定が無効になる。

## Design

Codexの読取・build等のshell呼出しは、コマンド文字列を固定したまま `exec_command.workdir` に対象worktreeの絶対パスを毎回指定する。

workdir指定を持たないharnessでは従来どおり `git -C <absolute-worktree>`、`make -C <absolute-worktree>`、絶対script pathを使い、誤tree操作の防止を弱めない。

Codexのprefix ruleと一致させる必要があるroutine commandはRTKで包まない。PreToolUse payloadから `exec_command.workdir` は観測できないため、変更系Gitと `make setup` / `make test` はユーザーレベルwrapperの `stage-all`・`commit`・`branch-rename`・`setup`・`test` を使い、コマンド文字列にもworktree絶対パスと期待branchを置く。wrapperは実際のcwd、明示target、Git top-levelの一致、main checkoutでないこと、現在branchの一致、subcommandごとのarityを検査してから固定argvだけを実行する。pfdslのguardもこのwrapper basenameと明示targetを認識するため、Codexが誤った `workdir` とtargetを同時に選んでもsession rootとの不一致で拒否できる。raw `git switch`・`git add`・`git commit`・`git branch -m` は永続allowにしない。

wrapperの `worktree-add` は `git rev-parse --path-format=absolute --git-common-dir` からmain repository rootを導き、その `.worktrees` 配下の相対名だけを受け付ける。これによりlinked worktreeから呼んでもnested worktreeを作らない。既存のsymlink祖先、絶対パス、親越境、追加引数、無効branchを拒否し、baseは `origin/*` 入力をcanonicalな `refs/remotes/origin/*` として構文・存在確認して、検証した同じcanonical refをGitのcommit-ishへ渡す。

両harnessのSessionStart hookは `node scripts/setup-completion.mjs check` が失敗したworktreeで `make setup` を自動実行する。markerは依存install、hook配置、repo skill linkがすべて成功した後にsetup入力のSHA-256を書き、lockfile、workspace定義、setup recipe、hook shim、repo skill linker、fingerprint実装のいずれかが変わればstaleになる。session開始後に手動作成したworktreeなどhook未実行の場合だけ1回実行する。

失敗後でも、既知の前提工程、同じ公式手順の次工程、同じ検証の再実行、同一ツールの引数訂正は追加確認なしで続ける。

認証、権限、ネットワーク、必須tool不在、破壊的操作、新しい公開先、 materially different な代替方式が必要な場合だけ停止してユーザー判断を求める。

pfdslのshared guardは空白でない `CLAUDE_PROJECT_DIR` が存在すれば従来どおりそれを優先し、存在しない場合だけ空白でないPreToolUse payloadの `cwd` をセッションworktreeの根として使う。literalな `cd <path>`、`cd -- <path>`、後置redirection、`git -C`、Codex wrapperの明示targetを解決し、変数展開などでeffective cwdを解決できない変更系commandは元のcwdへfallbackせずfail closedする。shellの引用はargvの値を変えない位置では実行可能tokenとして扱い、`env -i`等の既知prefix optionもunwrapしてquoted subcommand bypassを残さない。

`.claude/settings.json` と `.codex/hooks.json` は同一wrapperを呼ぶ。Claude Codeでは復旧系のaskを維持するが、Codexではunsupportedなaskをdenyへ変換し、hook failure後のfail-openを防ぐ。

## Compatibility contract

- Claude Codeでは `CLAUDE_PROJECT_DIR` がpayloadの `cwd` より優先される。
- Codexでは `CLAUDE_PROJECT_DIR` がなくてもpayloadの `cwd` とcommand targetのGit common dirを比較できる。
- Codexのroutine Git allow ruleはwrapper subcommandだけに一致し、raw `git switch`・`git add`・`git commit`・`git branch -m`・`git worktree add`には一致しない。prefixに余分なargvが続いてもwrapperがGit起動前に拒否する。
- 自worktree内の通常git変更は許可される。
- main checkoutへの変更はClaude Codeで拒否または確認され、Codexでは必ず拒否される。
- sibling worktreeへの新規状態作成は拒否され、復旧・破壊操作はClaude Codeで確認、Codexで拒否される。
- wrapperはlinked worktreeからの `worktree-add` をmain repository直下へ作り、routine mutationではmain checkout、workdir不一致、branch不一致をGit起動前に拒否する。
- setup markerは入力fingerprintが一致する場合だけcurrentであり、branch switch等による入力変更後のSessionStartはsetupを再実行する。
- malformed payloadやGit解決失敗で全Bash呼出しを停止させない既存の外側のfail-open境界は維持するが、変更系command内でeffective cwdだけを解決できない場合はdenyまたはaskへfail closedする。

## Non-goals

通常pushとforce-pushを同じprefix ruleで無審査にする変更は行わない。

merge、issue close、publish、branch deletion、新しいPRや公開branchの作成に対する明示確認は削除しない。

#981で進行中の中立capability modelとgenerator再編には触れない。
