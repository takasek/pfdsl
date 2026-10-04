# ADR-0044: worktree 運用ガードの責務を、効果を観測できる層へ移す

- Status: Accepted（実装は後続の PR で行う。それまでは既存の guard と文書が現行である）
- Date: 2026-10-04

## Context

このリポジトリは、worktree での日常作業の事故を repo-local の PreToolUse hook で防いでいる。
対象は次のとおりである。

- main の直接変更（#650、#777）
- 別 worktree の変更（#784、#1201）
- pre-commit の回避（#1232、#1281）
- 検証ツリーの取り違え（#840）
- 委譲先の外向き操作（#554、#1318）
- PR の Closes 漏れ（#871）

hook はコマンド文字列しか見られない。
それでも、実行後の cwd・branch・shell の状態を予測して、対象と保護の要否を決めようとしてきた。

PR #1335（head `5659d8c8`、base `83b52ec2`）はこの方向をさらに進め、shell の文脈解析（`scripts/lib/shell-context.mjs`）と heredoc の解析を加えた。
批判的レビューで、base と PR head に同じ入力を与えて比べると、次の後退が見つかった。

- `FOO=1 cd /main && git commit` と `command cd /main && git add -A` が allow になる。prefix の付いた `cd` を無視するため。
- `gh repo create foo -h <url>` が allow になる。gh の `-h` はコマンドによって `--homepage` や `--hostname` に束縛されるのに、help と誤認するため。
- `$[1<<2]` や `${x:-a<<b}` の次の行の Git 変更が、heredoc の本文として隠れる。
- 前方に `|` や `&` があると、feature branch でも `git add` が deny になる。
- 相対 `cd` を明示扱いし、primary checkout での検証に対する確認が消える。

PR の触ったテストは全て通っていた。
反例ごとに解析の範囲を広げる構造そのものが、局所解だった。

あわせて、harness の性質について次の事実を確かめた。

- Claude Code の `CLAUDE_PROJECT_DIR` は起動元に留まり、hook の payload.cwd は worktree に追従する（公式資料 worktrees の「Hook paths don't follow the worktree」）。旧 guard の sibling ask は、Claude Code desktop（2.1.286）の worktree セッションで、自分の worktree での `git checkout` 4回すべてで発火した。session root は所有権の信号になっていなかった。
- 同じ desktop の worktree セッションで worktree を PR head に切り替えても、guard の拒否の文面は起動元 checkout の版のままだった（2回観測）。Codex の hook は session の cwd（起動元）で実行される（OpenAI の Codex hooks 資料）。両 harness とも、hook のコードは起動元の checkout から来ると扱う。Claude Code で hook の定義をどこから読むかは未測定である。
- Codex の PreToolUse は ask を出せない。payload.cwd は起動元で、`.git` は sandbox で保護される。
- Claude Code の command hook は、2以外の非0終了や timeout では tool 呼出しを止めない（公式資料 hooks）。
- verification-tree-guard は、Codex が primary checkout で `node scripts/…` を直接実行するのを拒否する。読取りだけの検査（`setup-completion.mjs check`、CLI の `--version`）も実行できる経路が無くなる事例があった。
- GitHub の ruleset は main に PR を必須にしているが、承認必須数は0で、必須 check は `gen-plugin` と `sync-check` だけである。bypass actor として Integration 5103181 が登録されている。

方針は、Claude（Opus）と Codex の2モデル（gpt-6-astra、gpt-6.1-sol）が議論して作った。
最初の周では、3者が互いの案と結論を見ずに独立に提案した。
その後、Opus の subagent と新しい Codex（gpt-6-astra）のセッションが独立に批判的検証を行い、指摘を全て反映した。
所有者は 2026-10-04 にこの方針を承認した。

## Decision

### 脅威モデル

善意の agent・人間の事故を対象にする。
対象は、パスの取り違え、コマンド一式のコピー、習慣的なフラグ、cwd の戻り、結果の読み違え、setup 漏れ、古い hook、子プロセスの誤書込みである。
意図的に guard を迂回するプログラム、設定改変、権限拡張は対象外にする。
hook には、コマンド文字列だけで判定できるものを担わせる。
実行後の状態の予測はさせない。

### 用語と範囲

- primary checkout は `dirname(git-common-dir)` を指す。
- launch checkout は、hook のコードを供給する起動元の checkout を指す。このリポジトリでは primary checkout と一致させ、default branch を追従し、作業場所にしない。launch checkout が default branch にあれば、他の worktree で default branch を checkout することは Git 自体が拒否する。
- 保護の範囲はこのリポジトリ（git common dir が同じ checkout）に限る。リポジトリ外のパスと他のリポジトリは対象外とする。これは既存の契約（#1221）を保つものである。

### Git 層

- pre-commit は、HEAD が default branch（origin/HEAD から取得）なら commit を拒否する。取得できない場合も拒否する。
- shim は、`scripts/pre-commit` が無い・実行できない場合に非0で終える。shim は版の行を持つ。
- setup は、管理先の shim を配置してから実効 hook を検査する。`core.hooksPath` が未設定でも、default の shim の実在と内容を確かめる。custom の hooksPath は上書きせず失敗にする。共有 shim の更新は lock するか atomic に置き換え、新しい setup は shim を降格しない。
- 旧 checkout の `make setup` は、共有 shim を無条件にコピーして旧版へ戻せる。preflight と新しい pre-commit は、導入済み shim の版を確かめ、古ければ置き直す。
- 依存の準備と、共有 shim・skill link の配置は分ける。

### GitHub

- ruleset は現状のままとする。
- 承認必須数が0なので、「マージは人間」は下の policy（`gh pr merge` と MCP の merge）が担う。
- `check-closes-reference` と `test` を必須 check にするか、bypass actor の Integration 5103181 を残すかは、所有者が判断する未決事項である。必須にするまで、PR の Closes 漏れは CI で検出するだけで、マージを止めない。

### repo hook

hook は2本の policy dispatch にまとめる。
Bash と MCP を扱う1本と、Edit・Write・apply_patch を扱う1本である。
2本の dispatch は既存の entrypoint のファイル名を再利用する。起動中の session の配線を壊さないためで、名前を据え置いた先例が既にある。
それ以外の個別 guard の entrypoint は削除する。
lib は try/catch の中で動的に import し、ロードに失敗したら exit 2 にする。
これは policy に限り、advisory（command-usage）は失敗しても操作を止めない。

Bash と MCP の policy は次を判定する。

- 検査回避は token 単位で deny する。
  - 対象は、commit 系の `--no-verify`/`-n`、`-c core.hooksPath=…`、`--config-env` による hooksPath、`git config` による core.hooksPath の書込みである。
  - `GIT_CONFIG_COUNT`・`GIT_CONFIG_KEY_n`・`GIT_CONFIG_VALUE_n`・`GIT_CONFIG_PARAMETERS`・`GIT_CONFIG_GLOBAL`・`GIT_CONFIG_SYSTEM` の代入は、hook を走らせる subcommand の前にある場合だけ deny する。
  - `rtk git …` の前置きも扱う。
- Claude では、変更系 Git の target の checkout root を、payload.cwd の checkout root と比べる。
  - 明示 target は、`git -C <abs>`、`cd <abs> &&` の直後、`--git-dir`、`--work-tree`、`GIT_DIR`、`GIT_WORK_TREE` である。明示 target が無ければ payload.cwd の checkout を target とする。
  - target が primary checkout なら deny、別の worktree なら ask、解決できない変更系なら deny する。
- 実行先と作用先が異なる Git 操作は subcommand で分類する。default branch の ref を書き換える操作は deny する。`worktree remove`・`move`・`prune` は、Claude では ask、Codex では deny にする。
- 委譲先の外向き操作は deny する。
  - gh の help は `--help` だけを認める。
  - 確定できない heredoc は本文を隠さない。
  - 委譲先から呼ばれた MCP ツールのうち、名前が読取り（get・list・search・view・read・fetch）でないものも deny する。MCP のツール名の分類表は1か所に置く。
  - Claude の issue-worker は公開担当として例外にする。
- `gh pr merge`（`--auto` を含む）と、MCP の merge・auto-merge 系は、Claude では ask、Codex では deny にする。

file の policy は、対象を物理パスで解決して判定する。

- Claude では、primary checkout なら deny、payload.cwd の checkout root と異なれば ask、解決できなければ deny する。
- Codex では、相対パス、primary checkout、`.claude/worktrees/` 配下を deny する。Codex の payload.cwd は作業場所を表さないため、比較には使わない。
- 名前が root の CLAUDE.md・AGENTS.md に一致した場合だけ Git root を取得し、正本を示して deny する。
- roadmap-publish の判定もこの dispatch に統合する。

SessionStart は読取りだけの表示にし、setup の自動実行はやめる。
表示するのは、code host のパス・branch・HEAD、`refs/remotes/origin/<default>` との差、hook のパスの未 commit 差分で、異常があれば警告する。
この表示は診断であり、各 policy hook が trust・ロードされている証拠にはしない。

### 検証

共有の preflight を置く。

- root が primary checkout なら止まる。公開（`make release`）と監査のために明示の override を持つ。
- setup の readiness を確かめ、shim の版を確かめる。
- root・branch・HEAD を1行で出力する。

Makefile は `build: preflight` とし、並列実行でも順序を保証する（`test: build` は既存）。
変更の検証として報告する個別テストは、一束につき一回 preflight を実行して報告に含める。
読取りの監査と CLI の検査は preflight の対象外で、primary checkout でもそのまま実行できる。

### harness についての前提と範囲

リポジトリの guard は、harness の既定の挙動とリポジトリの仕組みだけで成り立たせる。
個人の machine-local の拡張（承認を省く wrapper、execpolicy の規則、個人の指示など）はリポジトリの範囲外で、その持ち主が管理する。
リポジトリはそれを前提にせず、規定もしない。
リポジトリのコードは machine-local の実行ファイル名を参照しない。

前提にする harness の性質は次のとおりである。

- Codex の PreToolUse は ask を出せない。payload.cwd は起動元を表す。sandbox は `.git` を保護し、raw Git の変更は承認に回る。
- Codex は、定義が変わった hook を trust されるまで skip する。
- Claude Code の PreToolUse は ask を出せる。payload.cwd は worktree と `cd` に追従し、`CLAUDE_PROJECT_DIR` は起動元に留まる。
- Claude Code の command hook は、2以外の非0終了や timeout では tool 呼出しを止めない。
- Claude Code の sandbox は前提にしない（理由は「検討した対案」）。

### PR #1335 から採用するもの

この ADR の基準は PR #1335 の head `5659d8c8` である。
次の3点は、この ADR の修正を加えて採用する。

- gh の読取り判定（#1318）。help は `--help` だけを認める。
- heredoc の解析（#1280）。確定できない形では本文を隠さない。
- hooksPath の検査（#1281）。setup の順序と shim の版の扱いを直す。

次は採用しない。

- `scripts/lib/shell-context.mjs`
- `scripts/run-repo-hook.mjs` と、hook コマンドの書換え
- `scripts/lib/file-target-context.mjs` の branch と origin/HEAD の取得
- `GIT_CONFIG_*` を target 環境変数として扱う変更
- verification-tree-guard と closes-create-guard の書換え
- 所有権の確認の撤去（代わりに上記の payload.cwd 基準の確認を置く）

#1335 を縮小するか、閉じて該当部分を出し直すかは、#1335 の担当者と調整して移行の最初の段階で決める。

### main から削除するもの

- `verification-tree-guard`（entrypoint・lib・テスト）
- `closes-create-guard`（entrypoint・lib・テスト）
- `main-commit-guard` の target 解決・default branch 判定・sibling 判定
- `main-commit-guard` が machine-local の実行ファイル名（`codex-git-routine.mjs`）を参照する分類
- 文書中の shell 対応形式の列挙

### #1208 の処遇表 B との関係

#1208 の処遇表 B は、事前チェック hook 8本を「実行前に止める価値（所有者判断）」で維持すると定めた。
この ADR はそのうち2本の事前拒否を外す。

- verification-tree の事前拒否は、preflight の停止と表示に置き換える。
- closes-create の事前確認は、CI の検出に置き換える。

残りの6本は2本の policy dispatch と advisory に統合し、実行前に止める役割を保つ。
所有者は 2026-10-04 にこの変更を承認した。

### 移行の順序

1. launch checkout を default branch へ移し、作業場所にしない。Claude Code の hook 定義の読込元を実測する。PR #1335 の扱いを決める。
2. Git 層と setup を直す。
3. repo hook を再編する。マージの直後に launch checkout を fast-forward する。
4. Claude Code の組込み worktree 隔離（公式資料 worktrees の「How Claude Code enforces isolation」）が、desktop の worktree セッションで変更系 Git に効くかを実測する。効くなら primary checkout 宛ての分岐を削る。

## 前提の検討

PR #1335 までの候補は、「PreToolUse hook がコマンド文字列から対象と結果を確定して保護する」ことを前提にしていた。
この前提を否定し、効果を観測できる層（Git の hook、GitHub、harness の権限、検証の出力）へ保護を移す案を作り、採用した。
#1207 が提案した「native worktree・branch protection・CI へ移す」案は、事前チェックを失うとして取り下げられている。
この ADR は事前チェックを全て外すのではなく、効果を観測できる層で代わりが成立するものだけを外す点で #1207 と異なる。
一段上の前提「保護は実行前に行う」は、検証ツリーと PR の Closes についてだけ否定した。

## 検討した対案

- **PR #1335 の方向（有限の命令契約として shell 解析を広げる）**: 却下。Context の5種類の後退を、base と PR head に同じ入力を与えて再現した。所有者は 2026-10-04 に、最終的なコードを「動くだけでなく無駄や重複を削ったもの」にするよう求めた。反例ごとに解析を広げる方式は、この要求と両立しない。
- **両 harness 共通の Git 入口を必須にする**: 保留。入口を主担当にするには、raw Git を入口の外で使えないようにする必要がある。Claude Code の公式資料（permissions）は、Bash の権限規則を「プログラムの周りの security boundary ではない」としており、規則だけでは raw Git を止められない。止めるには sandbox が要るが、下記の保護パスの制約で日常作業が止まる。sandbox が使えるようになった時点で再検討する。
- **CI を検査回避の防止の主担当にする**: 却下。Git は `--no-verify` による pre-commit の回避を仕様として提供している（githooks）。後で CI が緑になっても、検査を飛ばさなかったことは示せない。
- **Claude Code の sandbox を必須経路にする**: 保留。
  - sandbox は `.claude/{skills,agents,commands}` と settings への書込みを例外なく拒否する（公式資料 sandboxing の Protected paths）。
  - このリポジトリでは tracked file の57件がそこにある。`245bf669`（2026-10-03）から遡る30日の first-parent の変更137件のうち、46件がそこを変えている。
  - これらを書き換える rebase・switch・pull は、承認を得た sandbox 外での再実行でしか進まず、その間は sandbox の保護が外れる。
  - 保護パスを設定で外せるようになるか、tracked file を保護パスの外へ移した時点で再検討する。
- **Codex で作業対象を照合する（人間承認、所有者台帳、最初に使った対象との結び付け）**: リポジトリの guard では扱わない。Codex の PreToolUse は ask を出せず、payload.cwd は作業対象を表さないため、hook には照合の基準が無い。照合を行う場合は machine-local の拡張の責務になり、リポジトリはそれを前提にしない。
- **全 hook を exit 2、または全 hook を exit 0 にする**: 却下。Claude Code の command hook は timeout で判定を失う（公式資料 hooks）ので、exit 2 だけでは保証にならない。一律の exit 0 は、ロード失敗で policy を素通しにする。
- **session root を基準に sibling を確認する（base の形）**: 却下。`CLAUDE_PROJECT_DIR` は起動元に留まる（公式資料 worktrees）ため、自分の worktree の操作でも毎回発火する。

## Consequences

- 実装は後続の PR で、移行の順序に沿って行う。それまでは既存の guard と文書が現行である。
- 後続の PR では次の文書を更新する。
  - root の `CLAUDE.md`・`AGENTS.md`（正本は `scripts/root-instructions-template/INSTRUCTIONS.md`）
  - `.pfdsl/workflow.md`
  - `.pfdsl/bindings/pfd-ops.md`
  - `.pfdsl/workflow.pfdsl` の main_branch_guard
- 「SessionStart がこの worktree を setup する」という記述は削除する。
- 次の事故は防がない残存リスクとして扱う。
  - Claude Code の Bash の子プロセスが、絶対パスで別の checkout に書く。
  - Claude Code で別の checkout へ `cd` した後の操作は、payload.cwd が追従するため自分の checkout の操作として扱われる。
  - hook の timeout で判定が失われる。
  - pre-commit が走らない Git 操作（merge、cherry-pick、rebase、reset）。
  - Codex で、別の worktree 向けのコマンド一式をコピーして実行する（primary checkout と `.claude/worktrees/` 配下への書込みを除く）。
  - Codex で hook 定義を変えた後、trust されるまでの間は hook が skip される。リポジトリは trust の状態を検出できない。
  - 旧 checkout の setup が shim を降格させる。preflight と新しい pre-commit が置き直すまでの間に限られる。
  - 個別テストの preflight は報告の規約で、機械では強制しない。`build` に依存しない make の target（lint、coverage、check 系、gen-plugin）も preflight を通らない。
- 各段階の受入条件は、後続の issue に記す。対象は、拒否と確認の境界、ロード失敗の扱い、Codex の trust、縮小後の Codex の setup → build → test、MCP の判定、shim の置き直しである。

この ADR は品質ガイド（pfdsl スキル）への蒸留を要する規則を含まない。
