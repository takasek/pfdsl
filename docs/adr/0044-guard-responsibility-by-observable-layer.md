# ADR-0044: worktree 運用ガードの責務を、効果を観測できる層へ移す

- Status: Accepted
- Date: 2026-10-04

## Context

このリポジトリは、worktree での日常作業の事故を repo-local の PreToolUse hook で防いでいる。
対象は、main の直接変更（#650、#777）、別 worktree の変更（#784、#1201、#357）、pre-commit の回避（#1232、#1281）、検証ツリーの取り違え（#840）、委譲先の外向き操作（#650、#1318）、PR の Closes 漏れ（#871）である。
hook はコマンド文字列しか見られない。
それでも、実行後の cwd・branch・shell の状態を予測して、対象と保護の要否を決めようとしてきた。

PR #1335 はこの方向をさらに進め、shell の文脈解析（`scripts/lib/shell-context.mjs`）と heredoc の解析を加えた。
批判的レビューで、base と PR head に同じ入力を与えて比べると、次の後退が見つかった。

- `FOO=1 cd /main && git commit` と `command cd /main && git add -A` が allow になる。prefix の付いた `cd` を無視するため。
- `gh repo create foo -h <url>` が allow になる。gh 2.101 では `-h` が `--homepage`・`--hostname` に束縛されているのに、help と誤認するため。
- `$[1<<2]` や `${x:-a<<b}` の次の行の Git 変更が、heredoc の本文として隠れる。
- 前方に `|` や `&` があると、feature branch でも `git add` が deny になる。
- 相対 `cd` を明示扱いし、main checkout での検証に対する確認が消える。

PR の触ったテストは全て通っていた。
反例ごとに解析の範囲を広げる構造そのものが、局所解だった。

あわせて、harness の性質について次の事実を確かめた。

- Claude Code の `CLAUDE_PROJECT_DIR` は起動元に留まり、hook の payload.cwd は worktree に追従する（公式資料 worktrees の「Hook paths don't follow the worktree」）。旧 guard の sibling ask は、desktop の worktree セッションの自分の worktree での `git checkout` 4回すべてで発火した。session root は所有権の信号になっていなかった。
- 両 harness とも、project hook のコードは起動元の checkout から実行される。worktree を PR head に切り替えても、拒否の文面は起動元の版のままだった。
- Codex の PreToolUse は ask を出せない。payload.cwd は起動元で、`.git` は sandbox で保護される。
- Claude Code の command hook は、2以外の非0終了や timeout では tool 呼出しを止めない（公式資料 hooks）。
- Codex で、wrapper の `node-script` 経由の読取り検査（`setup-completion.mjs check`、CLI の `--version`）が、primary checkout だからと拒否された。特権 Git 入口と汎用の検証実行を1つの wrapper に同居させたことによる。
- GitHub の ruleset は main に PR を必須にしているが、承認必須数は0である。

方針は、Claude（Opus）と Codex の2モデル（gpt-6-astra、gpt-6.1-sol）による4周の議論で作った。
その後、Opus の subagent と、新しい Codex（gpt-6-astra）のセッションが、それぞれ独立に批判的検証を行った。
両者の指摘（blocking 2件、should-fix 10件）を全て取り込んだ。

## Decision

### 脅威モデル

善意の agent・人間の事故を対象にする。
対象は、パスの取り違え、コマンド一式のコピー、習慣的なフラグ、cwd の戻り、結果の読み違え、setup 漏れ、古い hook、子プロセスの誤書込みである。
意図的に guard を迂回するプログラム、設定改変、権限拡張は対象外にする。
hook には、コマンド文字列だけで判定できるものを担わせる。
実行後の状態の予測はさせない。

### 用語

- primary checkout は `dirname(git-common-dir)` を指す。
- launch checkout は、hook のコードを供給する起動元の checkout を指す。このリポジトリでは primary checkout と一致させ、default branch を追従し、作業場所にしない。

### Git 層

- pre-commit は、HEAD が default branch（origin/HEAD から取得）なら commit を拒否する。取得できない場合も拒否する。
- shim は、`scripts/pre-commit` が無い・実行できない場合に非0で終える。shim は版の行を持つ。
- setup は、管理先の shim を配置してから実効 hook を検査する。`core.hooksPath` が未設定でも、default の shim の実在と内容を確かめる。custom の hooksPath は上書きせず失敗にする。共有 shim の更新は lock するか atomic に置き換え、新しい setup は shim を降格しない。
- 依存の準備と、共有 shim・skill link の配置は分ける。

### repo hook

hook は2本の policy dispatch にまとめる。
Bash と MCP を扱う1本と、Edit・Write・apply_patch を扱う1本である。
entrypoint は既存のファイル名を再利用する。
lib は try/catch の中で動的に import し、ロードに失敗したら exit 2 にする。
これは policy に限り、advisory（command-usage）は失敗しても操作を止めない。

Bash と MCP の policy は次を判定する。

- 検査回避は token 単位で deny する。対象は、commit 系の `--no-verify`/`-n`、`-c core.hooksPath=…`、`--config-env` による hooksPath、`git config` による core.hooksPath の書込みである。`GIT_CONFIG_*` の代入は、hook を走らせる subcommand の前にある場合だけ deny する。`rtk git …` の前置きも扱う。
- Claude では、直接形の Git 変更の明示 target（`git -C <abs>`、`cd <abs> &&` の直後、`--git-dir`、`--work-tree`、`GIT_DIR`、`GIT_WORK_TREE`）の checkout root を、payload.cwd の checkout root と比べる。primary checkout なら deny、別の worktree なら ask、解決できない変更系なら deny する。
- 実行先と作用先が異なる Git 操作は subcommand で分類する。default branch の ref を書き換える操作は deny する。`worktree remove`・`move`・`prune` は、Claude では ask、Codex では deny にする。
- 委譲先の外向き操作は deny する。gh の help は `--help` だけを認める。確定できない heredoc は本文を隠さない。委譲先から呼ばれた MCP ツールのうち、名前が読取りでないものも deny する。Claude の issue-worker は公開担当として例外にする。
- `gh pr merge` と、MCP の merge・auto-merge 系は、Claude では ask、Codex では deny にする。

file の policy は、対象を物理パスで解決して判定する。

- Claude では、primary checkout なら deny、payload.cwd の checkout root と異なれば ask、解決できなければ deny する。
- Codex では、相対パス、primary checkout、`.claude/worktrees/` 配下を deny する。Codex の payload.cwd は作業場所を表さないため、比較には使わない。
- 名前が root の CLAUDE.md・AGENTS.md に一致した場合だけ Git root を取得し、正本を示して deny する。

SessionStart は読取りだけの表示にする。
code host のパス・branch・HEAD、`refs/remotes/origin/<default>` との差、hook のパスの未 commit 差分を示し、異常があれば警告する。
この表示は診断であり、各 policy hook が trust・ロードされている証拠にはしない。

### 検証

共有の preflight を置く。
preflight は、root が primary checkout なら止まり（監査用の override を持つ）、setup の readiness を確かめ、root・branch・HEAD を1行で出力する。
Makefile は `build: preflight` とし、並列実行でも順序を保証する。
変更の検証として報告する個別テストは、一束につき一回 preflight を実行して報告に含める。
読取りの監査と CLI の検査は preflight の対象外で、primary checkout でもそのまま実行できる。

### harness と machine-local の設定

machine-local の設定は repo の外にあり、この ADR はその責務だけを定める。

- Claude Code の sandbox は必須経路にしない。
- Codex の wrapper は Git の routine と整合性検査を残し、汎用実行（node-script、node-test、setup、build、test、typecheck）を外す。
  - setup は、依存の準備を通常の sandbox で行い、shim の配置だけを routine にする。
  - raw Git の恒久 allow を外す。
  - 特権 Git 操作の target は、thread で最初に使った作業対象と比べる。意図した切替は明示の rebind で行う。
- Codex の手順書には、hook 定義を変えた後は全ての policy hook を trust するまで Git の変更をしないことを書く。

### 削除するもの

- `verification-tree-guard`
- `closes-create-guard`
- `scripts/lib/shell-context.mjs`
- `main-commit-guard` の target 解決・default branch 判定・sibling 判定
- `run-repo-hook.mjs`
- `file-target-context.mjs` の branch と origin/HEAD の取得
- 個別 guard の entrypoint
- 文書中の shell 対応形式の列挙

PR #1335 のうち、gh の読取り判定（#1318）、heredoc の解析（#1280）、hooksPath の検査（#1281）は、上記の修正を加えて残す。

### 移行の順序

1. launch checkout を default branch へ移し、作業場所にしない。Claude Code の hook 定義の読込元を実測する。
2. Git 層と setup を直す。
3. repo hook を再編する。マージの直後に launch checkout を fast-forward する。
4. Codex の wrapper・rules・手順書を縮小する。
5. Claude Code の組込み worktree 隔離が変更系 Git に効くかを実測し、効くなら primary checkout の分岐を削る。

## 前提の検討

これまでの候補は、全て「PreToolUse hook がコマンド文字列から対象と結果を確定して保護する」ことを前提にしていた。
この前提を否定し、効果を観測できる層（Git の hook、GitHub、harness の権限、検証の出力）へ保護を移す案を作り、採用した。
一段上の前提「保護は実行前に行う」も否定した。
検証ツリーの取り違えは実行の拒否でなく preflight の表示と停止で扱い、PR の Closes は CI の検出に任せる。

## 検討した対案

- **PR #1335 の方向（有限の命令契約として shell 解析を広げる）**: 却下。上記の後退を実測した。解析の範囲は反例に追いつかず、所有者が求める「無駄と重複を削ったコード」と両立しない。
- **両 harness 共通の Git 入口を必須にする**: 却下。Claude Code で raw Git を制限しない限り、入口は推奨経路にとどまる。raw Git の制限は、所有者が定めた脅威モデル（事故）に対して過剰である。Claude Code の公式資料も、Bash の権限規則をプログラムの境界として扱っていない。
- **CI を検査回避の防止の主担当にする**: 却下。Git は `--no-verify` による pre-commit の回避を仕様として提供しており、後で CI が緑でも、検査を飛ばさなかったことは示せない。
- **Claude Code の sandbox を必須経路にする**: 保留。sandbox は `.claude/{skills,agents,commands}` と settings への書込みを例外なく拒否する（公式資料 sandboxing の Protected paths）。このリポジトリでは tracked file の57件がそこにあり、直近30日の main の変更137件のうち46件がそこを変えている。日常の rebase・switch・pull が止まる。保護パスを設定で外せるようになるか、tracked file を保護パスの外へ移した時点で再検討する。
- **作業対象を固定した人間承認や所有者台帳を必須にする**: 却下し、縮小案を部分採用した。thread で最初に使った対象と比べる結び付けは、承認も台帳も要らず、コマンド一式のコピー事故の大半を止める。thread の最初の操作がコピーされたものである場合は防げない。
- **全 hook を exit 2、または全 hook を exit 0 にする**: 却下。Claude Code の command hook は timeout で判定を失うので、exit 2 だけでは保証にならない。一律の exit 0 は、ロード失敗で policy を素通しにする。
- **session root を基準に sibling を確認する（base の形）**: 却下。`CLAUDE_PROJECT_DIR` は起動元に留まるため、自分の worktree の操作でも毎回発火する。

## Consequences

- 次の事故は防がない残存リスクとして扱う。
  - Claude Code の Bash の子プロセスが、絶対パスで別の checkout に書く。
  - hook の timeout で判定が失われる。
  - pre-commit が走らない Git 操作（merge、cherry-pick、rebase、reset）。
  - Codex の thread の最初の操作がコピーされたものである。
  - 旧 checkout の setup が shim を降格させる（preflight が置き直す）。
- 次の4点は移行時に実際の harness の入口で確かめる。
  - 拒否と確認の境界。
  - ロード失敗の扱い。
  - Codex の trust。
  - 縮小後の Codex の setup → build → test。
- 実装の手順は、この ADR に続く実装計画で定める。
