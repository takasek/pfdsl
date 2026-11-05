# Governance / scripts / hooks audit

> アーカイブ注記（2026-09-10）: この文書は固定コミット `827bcb1cb96238f918dad84dc6453176f131e029` を対象にした当時の監査記録であり、現行の不具合一覧や実装計画ではない。
> 最新の対応状況と残件は [#1055](https://github.com/takasek/pfdsl/issues/1055)、CLI 0.0.26 の公開完了記録は [#1138](https://github.com/takasek/pfdsl/issues/1138) を参照する。
> 観測・評価・提案は当時の内容を保持し、個人環境を含むパス表記は公開用の例示パスへ置換した。
> Markdown リンクは、このアーカイブ内の相対参照または監査対象コミットへの固定参照へ置き換えた。

対象コミット: `827bcb1cb96238f918dad84dc6453176f131e029`。
対象 worktree: `/path/to/pfdsl`。
以下は固定コミットの一次資料と synthetic fixture による所見であり、実在 issue・PR を検索・取得していない。
証拠スクリプトと実行結果は [evidence/governance](evidence/governance/results.json) に保存した。

## G1 — P1: roadmap 同期が core と別の不完全なグラフモデルで破壊的な判断をする

- 経路: `.github/workflows/pfdsl-flow-on-issue-close.yml:35` → `scripts/pfdsl/audit-issues-flow.mjs:157` → `getConsumedArtifactIds` / `buildProcessOutputs` → `computeFindings` → `applyClosedInFlowFixes` → `writeFileSync` (`audit-issues-flow.mjs:354`)。
- 根本原因: 入出力と参照整合を core の parser/graph から導かず、行ごとの regex から簡略化して再構築し、そのモデルだけで artifact/process/edge を削除する。
  主要な一次資料は [consumer 抽出](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/pfdsl/audit-issues-flow.mjs#L165) と [出力抽出・削除処理](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/pfdsl/lib/issues-flow-audit.mjs#L374)。
- 根拠: `audit-issues-flow.mjs:165` の consumer ID は小文字で始まる ID しか拾わない。
  `scripts/pfdsl/lib/issues-flow-audit.mjs:374` は `input >> process -> output` の同一行だけを読む。
  同ファイル `:462` と `:469` の削除は `revises` 等の残存参照を整理しない。
  書込後の core 検証や意味比較は entrypoint に無い。
- 再現: `probe.mjs` は実装から未 export の `getConsumedArtifactIds` 本体を抜き出して実行し、他は実 production module を import する。
  全て synthetic issue data を注入する。
  `lowercase-control` は正準 flows 形式・core error 0 で下流成果物を保存する。
  同じ構造で `product` を合法な `Product` に変えた `uppercase` は `hasDownstream:false` になり、生産者 `i1_build` と `Product.status:done` を削除する。
  下流 `Product >> i2_use -> result` は残り、Product が暗黙の外部入力へ変わる。
  これは after の core check も error 0 であり、単なる構文検証では検出できない。
  `revises` fixture は after に `result.revises: product` を残して `product` を消し、V016 を生む。
- 別の反例: `a >> i1_p` と `i1_p -> b` の2行、末尾コメント付きの1行、複数 process を含む1行チェーンは全て core error 0 だが同期の出力集合が欠落する。
  CLI fmt の flows 正準化はこれらの一部を救うが、大文字・revises の反例は正準化済みで残る。
- 破られる保証: `.claude/skills/pfd-ops/references/github-issues-backend.md:13` の「下流入力が残るものは tracking fields のみ削除」、同 `:16` の残存参照整理と依存集合保存。
- 影響条件: closed event または明示 `--fix` が該当構造を含む roadmap に適用される。
  本監査は実データでの損失発生を調べていない。
- 小さい改善: 同期の graph extraction を core の normalized edges に一本化し、削除候補の変換後に構文・参照検証と残す process の完全な入出力/状態を比較してから保存する。
  採用先に core を置けない配布制約があるなら、対応構文を明示し unsupported 入力では更新を止めることを先行できる。
  大文字 regex の単発修正だけでは分割辺や参照整合の問題は残る。
- 維持する目的: issue で運べない成果物依存と ready/blocked 判定、不要な完了チェーンの回収、close による同期、他の open work の保存。

## G2 — P2: 登録ゲートの起動対象と失敗対象が、責任を持つ作業集合に一致しない

- 経路: `.github/workflows/check-roadmap-registration.yml:9-12` → `scripts/check-roadmap-registration.mjs:71-89` → `buildAuditArgs` → `audit-issues-flow.mjs:262-324` → `partitionFindings`。
- 見逃し: workflow は `.pfdsl/roadmap.pfdsl` の変更でしか起動しない。
  managed issue の実装が roadmap を全く登録しなかった差分は、検査の目的に該当するのに path trigger に該当しない。
  close 後の別ゲートは存在するが、merge 前に登録を直せる保証を代替しない。
  [GitHub の path filter 仕様](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) でも変更ファイルを基準とする。
  この check が branch protection の必須項目であれば、skip は Pending のまま merge を止める場合がある。
  従って実設定次第で「登録漏れの見逃し」または「関連しない変更も未完了待ち」が生じる配線であり、現実の merge 成功・停止は未確認である。
- 誤停止: `--enforce-issue 1` は issue 1 だけに入力を絞る引数ではなく、advisory を blocking へ昇格するリストである。
  `gate-probe.mjs` の issue 1 は同期済みでも、無関係な issue 2 の `updatedAt` が変わるだけで `stale_updated_at` が fixable に残る。
  entrypoint は fixable が1件でもあれば exit 1 なので、issue 1 の登録検査も失敗する。
  対象 issue の registration が同じなのに、別セッションの metadata 更新だけで結果が失効する。
- 反証: target issue 自体が missing の場合には enforce が有効である。
  一般監査に全体 drift を表示する意味はある。
  不整合なのは target 専用の登録 verdict と global 同期 verdict を同じ終了コードにしている点である。
- 検証範囲: workflow YAML を実 parse、実 pure functions に fixture を注入して判定を確認した。
  GitHub hosted event と branch protection 設定は未確認。
  「実際に無検査で merge された」とは主張しない。
- 小さい改善: 登録確認は関連 PR event 全体で起動し、既に取得している closing issue 集合だけについて registration を判定する。
  全体同期監査は別 verdict/advisory に残す。
  issue 状態が変更された場合の再確認時点も、merge 前の保証をどこまで求めるかに応じて明示する。
- 維持する保証: managed/exempt の区別、実装対象の登録漏れ検出、他者の未マージ作業に干渉しないこと、全体 drift の可視性。
  一次資料: [workflow trigger](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/.github/workflows/check-roadmap-registration.yml#L9)、[登録ゲート引数](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/check-roadmap-registration.mjs#L71)。

## G3 — P2: build freshness が実際のビルド入力を識別していない

- 経路: `scripts/check-drift-gates.mjs:53` → `isDistStale` → `runDriftGates` → CLI fmt/check-links。
  `packages/cli/tsup.config.ts:15` は `@pfdsl/*` を CLI bundle に取り込む。
  `packages/cli/src/cli-smoke.test.ts:30` も CLI 自身の src mtime だけで current を決める。
- 根本原因: `scripts/lib/dist-freshness.mjs:40` は dist の sibling src 最新 mtime だけを比較する。
  core/graphviz/preview の transitive source、package.json の埋込 version、tsup config、lockfile、削除された source は identity に含まれない。
- 再現: `gate-probe.mjs` の filesystem fixture は core source を古い core/CLI dist より新しくし、CLI source は不変にする。
  actual `isDistStale` は `coreStale:true, cliStale:false`。
  actual `runDriftGates` は `.pfdsl/roadmap.pfdsl` の fmt/check-links を実行候補に残し、stale note を出さない。
  command executor はログ採取 stub であり、古いCLIが具体的な不正PFDを通すところまでは実行していない。
  ただし bundle の transitive input と freshness の対象不一致は一次配線で確定している。
- 反証: clean CI は build 後に test するため、この stale-local ケースを防ぐ。
  PostToolUse advisory が core 自体の stale を知らせる経路もある。
  しかし core だけを build し直して全 sibling dist が fresh でも、CLI に既に取り込まれた core は更新されず、CLI freshness 判定には伝わらない。
- 小さい改善: bundled output の入力集合を build が記録し、その集合に対して freshness を判定する。
  初期修正は transitive workspace inputs と manifest/config を対象に含めるだけでもよい。
  mtime は cheap な advisory と位置付け、source-equivalence の保証として表示しない。
- 維持する保証: checkout-local CLI の利用、速い限定検証、fresh build 後の CI と配布物の整合。
  一次資料: [freshness 判定](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/dist-freshness.mjs#L40)、[CLI bundle inputs](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/cli/tsup.config.ts#L15)。

## G4 — P3: snapshot 再検証が、実際の入力でない図の変更からも起動する

- Snapshot 経路: `scripts/lib/drift-gates.mjs:59-68` は全 `.pfdsl` staged を trigger に全 core suite の `vitest run -u` を実行する。
  `scripts/gate-check.mjs:194-214` も同じ広い条件で再実行する。
  `.github/workflows/test.yml:52-55` は通常 core test の後にもう一度 `-u` を実行する。
- 実入力: tracked core source の snapshot assertion は `packages/core/src/index.test.ts:165` の1箇所で、input は同 `:18-19` の `__fixtures__/pipeline-scale.pfdsl`。
  `.pfdsl/workflow.md:90` 自身も operational roadmap/workflow の編集では snapshot は変わらないと述べる。
  `scripts/flow-sync-local-hook.mjs:14-29` はそれでも roadmap の snapshot を更新する目的で node_modules を消し、依存を入れ直し全 core `-u` を実行する。
  これは retrospective でも依存グラフの検査でもなく、入力に含まれない図の変更で同じ golden fixture を再検証する配線である。
- 反証: parser/formatter/fixture を変更した回に golden output を検証する意味はある。
  指摘は snapshot の入力でない変更を同じ理由で扱う過剰範囲である。
  本監査は実依存入替による時間・通信量を測定しておらず、性能改善率は主張しない。
- 小さい改善: snapshot の trigger を fixture/実装入力に限定し、通常 snapshot assertion を使う。
  golden を書き換える `-u` は明示更新時へ寄せ、flow-sync から目的を失った専用依存入替を外す。
  新しい重いキャッシュ基盤を先に作る必要はない。
- 維持する保証: golden fixture の変更検出、サイクルごとの retrospective、roadmap sync。
  一次資料: [snapshot trigger](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/drift-gates.mjs#L59)、[実 snapshot 入力](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/index.test.ts#L18)、[local sync hook](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/flow-sync-local-hook.mjs#L5)。

## G5 — P2: 限定的な文字列 lint を意味判定・全面的な合格表示へ広げている

- 確認済みの誤停止: `scripts/lib/criteria-judgeability.mjs:32-34` は `npm view` を含み `versions` を含まない criteria を全て latest-only とみなす。
  `npm view @pfdsl/cli@0.0.25 version returns 0.0.25` は exact version を指定しているのに `runCriteriaJudgeabilityCheck` が exit 1 を返す。
  `make check-docs` → terminal gate / CI / release の全体停止に繋がる。
  [npm の一次仕様](https://docs.npmjs.com/cli/v11/commands/npm-view/) は version 指定を受け付け、unspecified の場合にだけ latest を既定にすると記す（2026-09-08 確認）。
- 確認済みの見逃し: `scripts/lib/check-no-shell-strings.mjs:31-34,77-110` は named import/require と `shell:true` に限る。
  named `execSync` は検出するが、`import * as cp from 'node:child_process'; cp.execSync(...)` と default import は findings 0。
  shell executor を禁止するという目的に対する構造的な欠落であり、危険なプログラムを実行せず source fixture だけで再現した。
  `check-cli-conventions` は `parseArgs({strict:false})` を検出しないのに entrypoint は「all scripts parse argv strictly」と表示する。
  ただし同 library の冒頭は対象を廃止済み2形に明示的に限定するため、strict:false の未検出自体は機能欠陥として数えない。
  成功メッセージが限定 lint の保証より強いことが問題である。
  既存 corpus に脆弱な command が存在するという主張ではない。
- 根本原因: 語形を観測する lightweight detector が、意味的な正誤を判定したかのように使われる。
  例外を足すだけでは同じ意味の別表現が増えるたび再発する。
- 小さい改善: 確実に決められる構文だけ hard error にし、criteria の一般的な意味判断は advisory/人手へ残す。
  import の種類は既存 parser 等で構造的に読むか、少なくとも named/default/namespace を同じポリシーで扱う。
  合格表示は「対象の禁止形を検出しなかった」に縮める。
- 維持する保証: shell 経由の引数解釈の防止、タイポに黙って成功しない CLI、長期に真であり続ける criteria。
  一次資料: [criteria 判定](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/criteria-judgeability.mjs#L32)、[shell lint](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/check-no-shell-strings.mjs#L31)、[限定 lint の説明](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/check-cli-conventions.mjs#L1)。

## G6 — P3: retrospective 通知が成功した commit ではなく command 文字列を観測する

`hooks/retro-reminder-post-tool-use.mjs:23-25` は `command.includes('git commit')` で検出する。
`git -C /repo/worktree commit ...` と Codex の所定 wrapper commit を見逃し、`echo "git commit is the next step"` は検出する。
entrypoint `:79-96` は command 成功や新しい commit identity を見ず cwd の HEAD を読む。
`checker-probe.mjs` で detector の真偽を確認し、実 commit や hook の外部実行は行っていない。
一次資料: [commit detector](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/hooks/retro-reminder-post-tool-use.mjs#L23)、[HEAD 読取経路](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/hooks/retro-reminder-post-tool-use.mjs#L79)。

repo-local pre-commit reminder は別に存在するため、pfdsl repo 全体の reminder 消失とは言わない。
plugin adopter の PostToolUse backstop と supported invocation の不一致である。
小さい改善は、supported commit forms と成功した実効対象 worktree の commit identity を結び付け、対象 commit の done 差分に通知を限定すること。
通知のために毎回全体 retro を起動せず、サイクル終了時の明示的な retrospective と軽量通知の両方を維持する。

## 設計判断が必要な懸念（不具合とは断定しない）

- `scripts/lib/cycle-status-steps.mjs:90-119` は start-of-cycle gate として `behindBase > 0` を拒否する。
  `gate-probe.mjs` の README typo 1 commit という synthetic log でも fetch/log 後に exit 1 となるが、最新 origin から開始する共通方針には適合する。
  「このスクリプト自身が古い」というメッセージは変更内容を見ずに断定しているものの、開始条件の停止そのものを不具合とは数えない。
  開始後の状態取得にも利用したい場合に限り、開始 gate と観測 command を分ける設計判断が必要になる。
- `scripts/lib/review-record.mjs:9-26` は trailer の self-report 性を明示して受容している。
  `parseReviewRecords` / `classifyCycle` は1サイクル内の1件の correctness 記録があれば、後の変更や対象 hash を区別せず成功する。
  `CODE_PATH` は packages/scripts のみで、hooks-only の実行コード変更は record を要さない。
  `gate-probe.mjs` でこの挙動を確認した。
  これは「サイクルでレビューを一度行った」記録としては仕様どおりで、「最終差分がレビュー済み」という強い保証にはならない。
  求める意味と、有効範囲・失効条件を決める必要がある。
- pre-commit は staged path で選択しても検査/生成の入力は worktree files である。
  partial staging 中の index と worktree の等価性は実装から読み取れない。
  本監査は index を用いた破壊実験を行っておらず、bypass を確認済みとはしていない。
- setup は fingerprint、lock、成功後 marker の atomic rename を持つ。
  kill/crash、stale lock 回収競合、dependency version 内容破損の耐性は、本監査で新しい fault injection を行っていない。
  通常 setup と既存テストは成功した。

## 検証

`probe.mjs` / `gate-probe.mjs` / `checker-probe.mjs` は exit 0。
これは製品の正常性ではなく、上記出力の観測が完了したという意味である。
結果は `results.json` / `gate-results.json` / `checker-results.json` と before/after fixture に保存した。
全ての新規実験は synthetic data に対する local execution であり、GitHub issue/PR I/O を呼んでいない。
