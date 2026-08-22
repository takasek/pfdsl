# 散文資産と機械化台帳の突合 sweep（2026-08-23）

初回 sweep。基準となる #915 の PR #939 マージから3日、`check-asset-sweep` が数える対象追加は54件、findings は4件（修正3件、停止判断を要する保留1件）。初回は既存機構の全量を数えるため、期待値1.2件との単純比較では閾値20を改訂しない。次回以降の増分 sweep で歩留まりを再測定する。

## 実行主体と対象境界

本 sweep は Codex セッションで実施した。判定根拠はリポジトリ内の正本である `.claude/settings.json`・散文資産・hook/check スクリプトと、それらへ入力を与えた実出力であり、Claude Code のセッション内状態や自己申告には依存しないため、実行主体の違いは findings の有効性を変えない。

PR #966 は Claude Code 向け正本から Codex 向けの `.agents/`・`.codex/`・plugin 資産を生成する変更であり、本 sweep の基準ブランチには未導入である。生成物を正本と重複して再監査すると同じ規律を二重に数えるため、本 sweep は現行の正本とリポ固有の機構を対象とし、Codex 変換固有の欠落・矛盾・所有権は #966 の distribution review が受け持つ。この境界は、#966 の生成物を未確認のまま本 sweep が保証するという意味ではない。

## 工程1: hook / check 台帳

`.claude/settings.json` の hook 配線14件と `scripts/check-*.mjs` 23件を実測した。表の「出力」は、人が受け取る判定またはメッセージの役割を示す。

| 機構 | 検出・強制対象 | 出力 |
| --- | --- | --- |
| SessionStart setup | `node_modules` がない worktree | `make setup` を実行 |
| delegation-guard | 非 allowlist subagent の push・PR/issue mutation | deny |
| main-commit-guard | default branch または同一 repository の別 worktree を変える Git segment | deny / ask |
| command-usage-guard | 誤解を生む `npx @pfdsl/cli` と `gh issue view --comments` | ask / deny |
| verification-tree-guard | linked worktree 利用中に main checkout の暗黙 cwd で検証 | ask |
| closes-create-guard | default branch 向け PR に closes evidence がない | ask |
| worktree-write-guard | Edit / Write が session worktree 外へ出る | deny |
| roadmap-publish-guard | roadmap に publish process を追加する前の release 状態未確認 | ask |
| md-write-check | 編集直後の Markdown の文中改行 | advisory |
| companion-prose-advisory | companion へ置いた散文の機械化・配布層候補 | advisory |
| pre-artifact-advisory | 最初の実装 write 時点の `phase: pre-artifact` パターン | advisory |
| stale-dist-guard | 古い dist を読む test / typecheck / CLI 実行 | advisory |
| managed-issue-reminder | `flow:managed` issue 作成後の roadmap 登録 | advisory |
| cwd-drift-log | payload cwd・hook cwd・実 shell cwd の計測材料 | `/tmp` へ記録のみ |
| check-asset-sweep | 登録対象が前回 sweep 以降の追加閾値を超過 | release block と修正 skill 名 |
| check-biome | Biome の error / warning / info 全 severity | block |
| check-cli-conventions | 廃止済み argv parse・entrypoint 判定形 | block と file:line |
| check-closes-reference | PR の closing issue reference | CI block |
| check-companion-bindings | companion の repo path と必須 heading | block と dead pointer |
| check-criteria-judgeability | latest-only accessor に依存する判定不能 criteria | block と node |
| check-diag-registry | spec の診断表と core registry の欠落・余剰・severity 差 | block と差分 |
| check-distributed-prose | 配布 prompt に残る上流リポ固有参照 | block と file:line |
| check-distribution-review | 配布 prompt が最終 review commit より進んだ状態 | release block と未レビュー差分 |
| check-doc-examples | fenced pfdsl example の CLI validation | block と example 位置 |
| check-drift-gates | staged files に応じた生成物・snapshot drift | pre-commit block と全 failure |
| check-entry-path-headings | slash command 名を内容名の代わりに使う heading | block と file:line |
| check-forward-ref-markers | 定義済みになった可能性のある permissive spec ref | warning のみ |
| check-md-linebreaks | Markdown 散文の文中改行 | block と前後行 |
| check-no-shell-strings | shell 経由の command execution | block と file:line |
| check-review-perspectives-scale | 2カタログの bytes / item 数と分割閾値 | notice のみ |
| check-review-record | code diff に必要な delegated review trailer | CI block と不足観点 |
| check-roadmap-registration | PR が閉じる `flow:managed` issue の process 登録 | CI block と issue |
| check-scaffold-sync | canonical scaffold と plugin mirror の drift | block と path |
| check-script-imports | scripts の解決不能な relative import | block と specifier |
| check-skill-wiring | 配布 skill / agent の workflow 生産辺と runtime 消費辺 | block と欠落辺 |
| check-spec-history | 現行 spec version に対応する history entry | release block |
| check-spec-ids | strict spec ref の dangling と ID 重複 | block と参照位置 |

## 工程2: 機械化済み対策を語る散文

`CLAUDE.md` の main branch 規律は guard の deny / ask 一覧を複製せず、一次情報の定数へ寄せたうえで代替手順だけを残しているため維持した。Markdown 改行規律も純関数へ `一行目、\n二行目。` を与えて violation になることを実測し、読点改行を禁じる散文と機構が一致することを確認した。

## 工程3: スクリプト出力を再説明する散文

check 名の列挙を散文資産から検索し、判定値を手書き複製している箇所はなかった。`pfd-ops` の work-cycle が説明する設計対話条件と review 記録は、実行前に必要な入力契約と偽造可能性の境界を含み、スクリプト出力へ落とせない残余なので維持した。

## 工程4: 層内の同文再掲

`prose-mechanization-audit/SKILL.md` に初回は全件対象とする同義文が連続していたため1文へ統合した。2つの sweep skill が記録用2コミットの自己言及回避手順を同文で持っていたため、`docs/asset-sweep/README.md`「記録の確定」を一次情報にして各 skill を対象固有の1文へ縮めた。`.pfdsl/workflow.md` の agent 登録節と hook 登録節が同じ一般基準を再掲していたため、後者を前者へのポインタへ変えた。

`pfd-ecosystem` と architecture がそれぞれ持つ `check-install-sync --deploy` は独立した入口から実行するための入力契約なので維持した。対象別 sweep skill がそれぞれ `check-asset-sweep` の発火確認を持つことも、ホストの skill 選択に必要な起動条件なので維持した。

## 工程5: 散文と機械の矛盾

散文資産の `gh issue view --comments` と `npx @pfdsl/cli` は禁止形を教える例ではなく、誤りとして明示する説明だけだった。Git mutation の例は worktree 絶対パスか復旧・検証上の例であり、現行 guard の deny / ask と矛盾しなかった。

## 保留した finding

`cwd-drift-log` は「payload cwd と shell 実 cwd の信頼性が答えられたら削除」という停止条件を持つが、誰がいつログを数えるか、何件なら十分かを持たない。2026-08-20T13:40Z〜2026-08-22T17:37Z のログ2,269件では payload cwd と hook cwd の不一致0件、`pwd` probe 42件は42件とも payload cwd と一致した。停止条件の定量化または現時点での削除は設計判断を要するため、本 sweep では機構を変更せず #979 へ切り出した。
