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

Codexのprefix ruleと一致させる必要があるroutine commandはRTKで包まない。PreToolUse payloadから `exec_command.workdir` は観測できないため、変更系Gitとsetup/test/build/typecheckはユーザーレベルwrapperの明示target付きsubcommandを使う。wrapperはGit common-dirとGit dirをrealpath化してuser registryのtrusted rootと照合し、mainではGit dirとcommon-dirの一致、linked worktreeではGit dirがcommon-dir直下のworktrees領域にありbackpointerが対象の `.git` と一致することを要求する。さらに `git worktree list --porcelain -z` の登録path、実際のcwd、明示target、Git top-level、main checkoutでないこと、現在branch、subcommandごとのarityを照合してから、固定Node interpreterで起動しPATHを介さないGitまたはMake実体へ固定argvだけを渡す。GitとMakeの全子processからrepository・index・object・ref namespaceを変える7種類のGit target環境変数を除去し、明示cwdとtargetによるidentity検証をambient stateより優先する。現在trusted rootはpfdslだけであり、registry外やtrusted common-dirだけを借りた未登録directoryでは子processを起動せず通常のsandbox promptへ戻す。これにより悪意ある任意repoのMakefileやGit hooksをglobal allow経由でsandbox外実行しない。pfdslのguardもwrapper basenameと明示targetを認識するため、Codexが誤ったworkdirとtargetを同時に選んでもsession rootとの不一致で拒否できる。raw Git変更とraw package scriptsは永続allowにしない。

wrapperの `worktree-add` は `git rev-parse --path-format=absolute --git-common-dir` からmain repository rootを導き、その `.worktrees` 配下の相対名だけを受け付ける。これによりlinked worktreeから呼んでもnested worktreeを作らない。既存のsymlink祖先、絶対パス、親越境、追加引数、無効branchを拒否し、baseは `origin/*` 入力をcanonicalな `refs/remotes/origin/*` として構文・存在確認して、検証した同じcanonical refをGitのcommit-ishへ渡す。

両harnessのSessionStart hookは `node scripts/setup-completion.mjs check` が失敗したworktreeで `make setup` を自動実行する。fingerprintはrootとworkspaceのpackage manifests、lockfile、workspace定義、`.npmrc`、`.pnpmfile.cjs`、setup recipe、hook shim、repo skill linker、直接importするentrypoint helper、fingerprint実装を含む。setup全体はworktree単位のPID付きlockで直列化し、同じinputsを待つrunnerはlock取得後の再checkでbodyをskipする。dead/malformed stale lockは回収し、待機には上限を持つ。markerは依存install、hook配置、repo skill linkがすべて成功した後に同一directoryの一時fileからatomic renameする。

失敗後でも、既知の前提工程、同じ公式手順の次工程、同じ検証の再実行、同一ツールの引数訂正は追加確認なしで続ける。

認証、権限、ネットワーク、必須tool不在、破壊的操作、新しい公開先、 materially different な代替方式が必要な場合だけ停止してユーザー判断を求める。

pfdslのshared guardは空白でない `CLAUDE_PROJECT_DIR` が存在すれば従来どおりそれを優先し、存在しない場合だけ空白でないPreToolUse payloadの `cwd` をsession worktreeの根として使う。literalな `cd`、inputを含む先頭redirection、`git -C`、`env -C/--chdir`、Codex wrapperの明示targetを実行順に解決する。`--git-dir`・`--work-tree`、Gitのrepository・index・object・ref namespaceを変える非空のcommand内またはambient環境変数、shell展開、cwdを変えるbuiltin、未知または不完全なcommand/sudo/time prefix等でeffective cwdを確定できない変更系commandは元のcwdへfallbackせずfail closedする。identity取得用Git subprocessは7種類のGit target環境変数を除去し、明示cwdからrootとbranchを解決する。protected shell stateはGit target変数ごとの値・export状態とshellが直接読むCDPATHを分けて追跡する。literalな空代入・`unset`・Git target変数の `export -n` は安全状態を回復するが、`unset -f` は変数を消したものとして扱わない。`read`・`printf -v`・`source`・`.`・`eval` による動的変更と、`||`・pipeline・background・subshell・後続の無条件commandへ複数状態を残すAND-listは変更系Gitをfail closedする。ambientまたはcommand stateに非空 `CDPATH` があるrelative `cd` も到達先不明としてfail closedするが、絶対 `cd`、確実に空の `CDPATH`、単純なsuccess-pathの `cd <target> && git <mutation>`、変更系Gitより後ろにだけ現れるcontrol flowは静的解決を維持する。quoted/absolute executableと既知prefix optionを実行形どおり認識し、`command -p` は実行prefix、`command -v/-V` はpath queryとして区別する。

`.claude/settings.json` と `.codex/hooks.json` は同一wrapperを呼ぶ。Claude Codeでは復旧系のaskを維持するが、Codexではunsupportedなaskをdenyへ変換し、hook failure後のfail-openを防ぐ。

## Compatibility contract

- Claude Codeでは `CLAUDE_PROJECT_DIR` がpayloadの `cwd` より優先される。
- Codexでは `CLAUDE_PROJECT_DIR` がなくてもpayloadの `cwd` とcommand targetのGit common dirを比較できる。
- Codexのroutine allow ruleはtrusted-rootと登録worktree identityの検証付きwrapper subcommandだけに一致し、raw Git変更とraw package scriptsには一致しない。prefixに余分なargvが続いた場合、registry外のrepo、trusted common-dirだけを借りた未登録directoryは子process起動前に拒否する。
- wrapperのGitとMake子processは7種類のGit target環境変数を継承せず、明示cwd・target・branchに対する検証と操作を維持する。
- 自worktree内の通常git変更は許可される。
- main checkoutへの変更はClaude Codeで拒否または確認され、Codexでは必ず拒否される。
- sibling worktreeへの新規状態作成は拒否され、復旧・破壊操作はClaude Codeで確認、Codexで拒否される。
- wrapperはlinked worktreeからの `worktree-add` をmain repository直下へ作り、routine mutationではmain checkout、workdir不一致、branch不一致をGit起動前に拒否する。
- setup markerはinstall入力fingerprintが一致する場合だけcurrentであり、branch switch等による入力変更後のSessionStartはsetupを再実行する。同一inputsの同時runnerはsetup bodyを1回だけ実行し、partial failureはcurrent markerを残さない。
- malformed payloadやGit解決失敗で全Bash呼出しを停止させない既存の外側のfail-open境界は維持するが、変更系command内でeffective cwdだけを解決できない場合はdenyまたはaskへfail closedする。
- hook processが非空のGit target環境変数を継承した変更系command、非空CDPATHがrelative cdを変えうる変更系command、動的なprotected-state setter、静的に一つの実targetへ畳めないcontrol flowはfail closedする。読み取り系Git・絶対cd・literalな空代入または変数unsetで安全へ戻した状態・単純なsuccess-pathのAND-listは影響を受けない。

## Non-goals

通常pushとforce-pushを同じprefix ruleで無審査にする変更は行わない。

merge、issue close、publish、branch deletion、新しいPRや公開branchの作成に対する明示確認は削除しない。

#981で進行中の中立capability modelとgenerator再編には触れない。
