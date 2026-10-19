# #1404 最終file/MCP/policy設定の実入口受入（2026-10-19）

## 対象と判定

[#1404](https://github.com/takasek/pfdsl/issues/1404) の現在の受入条件6項目を満たしたと判定した。
実装の変更・新しい保護範囲の採用は行っていない。
最終契約は [ADR-0047](https://github.com/takasek/pfdsl/blob/main/docs/adr/0047-agent-operation-decision-table.md)、所有者の契約は [ADR-0046](https://github.com/takasek/pfdsl/blob/main/docs/adr/0046-native-worktree-ownership.md) とする。
PR #1437 は `3917f45d80c9218f43495ad8c40d642e2d620e26` としてmainへ統合済みである。

先行実測の基準・入力・旧条件との差分は [公開済み受入記録](https://github.com/takasek/pfdsl/blob/351b5cf989ecc659aedca199a27da1fa1a6ebd5a/docs/agent-operation-acceptance-2026-10-13.md) を参照する。
本書は後続の通常操作、保存済みClaude native出力の追加照合、Codexの正規native clientによる実MCP検収と、独立監査の結果を要約する。
原ログと識別情報を含む詳細記録は非公開で保持し、本書には転記しない。
本書の公開先は証拠保存用branchの固定commitであり、mainへの追加実装のmergeやCI成功を意味しない。

## 受入条件との対応

| 条件 | 確認結果 |
| --- | --- |
| 1. 対象版・設定・harness・起動経路と通常/保護 | 先行Desktop実測と後続native clientを区別して版・設定元・入口を固定した。後続試行では正式hook・個人設定を維持し、追加のtrust・認証・恒久許可を設定していない。個人wrapper/trusted rootsをrepo配布の必須依存にしていない |
| 2. 最終file matcherのraw apply_patch | 先行実入口で、正式設定の信頼後にown/scratch/foreignの実書込み、primary/別ownerのPreToolUse拒否を確認した。alias配線・設定選択・Node再生の証拠とは区別した |
| 3. 最終GitHub MCP matcherの読取と変更保護 | 後続の通常turnで実GitHub読取の応答と個人/repo hookの通過、PR統合操作に対する両hookのblockedを対応付けた。通常の外向き操作Oは親/子の主体別契約に従い、全変更操作の一律拒否とはしない |
| 4. 保護・通常操作・停止/回復・askと承認後実行 | 先行記録の有限な保護例・隔離labの3故障停止/回復に、ownのbranch/stash通常操作、Claude正式ask出力3件・人間承認・実行成功、native hook拒否、後続MCPの個別結果を追加した |
| 5. 表に無い入力Uの集計と採否 | 正規reportでtotal 103、invalid 0。内訳はunresolved-target-or-command 68、unknown-option 33、dynamic-argument 2。共有journalの集計であり、今回sessionの件数や発生率とはしない。option表は増やしていない |
| 6. #1398の結論と最終配線への適用 | #1398のCLOSED/completedを確認した。所有者の5条件と最終policyへの有限な適用、旧再開経路のFAILと手動fallbackを分けて参照する |

## 後続の実測

### ownの通常Git操作

専用probe fileだけを対象にstash push/apply/pop、再stash後のdropを実行した。
復元bytesを照合し、既存stash 3件のOID・message・順序が操作前後で一致することを確認した。
専用の検収branchはforceなしのbranch -dで削除し、対象が他worktreeでcheckoutされていないこと、継続branchの保持、probe不在とclean statusを確認した。
共有stash全消去や既存項目の削除は行っていない。

### Claudeの正式askと実行結果

Code 2.1.295の2026-10-16の保存済みtranscriptから、正式hookのnative attachmentを追加取得した。
一時repository設定キーの作成・撤去はagent-operation-guard、内容guard対象fileのWriteはroadmap-publish-guardのstdout ask、stderr空、exitCode 0を確認した。
tool ID・元assistant UUID・timestampで呼出しと対応付け、ask理由3件は既存の人間による画面転記と一致した。
同じtoolのnative結果はaccept/source=user_temporaryと実行成功であり、内容Writeのbytesも固定fixtureと一致した。
有効な生成物Editはnative結果でreject/source=hook/reasonType=hookと生成物保護理由を確認したが、個別hookのraw stdout・command・exitCodeは取得していない。
これは既存実測の証拠追加であり、現用Claude版での再実行ではない。

### Codexの実GitHub MCP

インストール済みCodex app-server（runtime `0.163.0-alpha.10.2`）を正規stdioで起動する専用clientで、既存GitHub connectorがenabled/callableであることを確認した。
ephemeral threadの通常turnを使い、管理APIによるtool直呼び・dynamic tool・hook無効化・trust追加を使っていない。
hooks/listはuser hookとprojectの正式 `.codex/hooks.json` を返し、12定義がenabled/trustedだった。
個人設定とhook設定の試行前後hashは一致し、projectのguard entryとhook設定も不変だった。

読取Rでは `github.fetch_issue` にrepository_full_name=takasek/pfdsl、issue_number=1404を渡した実MCP itemを取得し、completed/error nullと実issue応答を確認した。
同じcall IDに対応するuser/projectのhookはともにcompletedで、entriesは空だった。

PR統合Pでは、存在しないPR番号0に対するmerge_pull_requestを一度だけ要求した。
同じ拒否call IDを持つuser/projectのhookがともにblockedとなり、project側は `PR integration is reserved for a human terminal. Recovery: human terminal.` を返した。
下流MCP itemは生成されず、実PRのmergeは行っていない。
Pの実tool引数は下流itemが無いため独立に取得できていない。PR番号0はpromptとmodel報告に基づく値であり、取得済みの実引数として扱わない。

SessionStart 1対、R 2対、P 2対のstarted/completed計5対をnative run ID・thread/turn・call IDで照合した。
2 turnは完了し、clientはexit 0で終了した。
この結果は旧Desktop内での再測定ではなく、追加の正規native clientで得た実入口の結果である。

## 独立監査と証拠の上限

実装時の会話を引き継がない別agentが、現issueの6条件と一次記録を照合し、充足・close可能と判定した。
native記録の5対とR/Pの対応、Claude追加記録のhashを独立確認した。
GitHub状態とU集計は親が取得した正規読取出力を監査で参照し、監査agentは再実行していない。

正式hookごとの観測結果とnativeの最終結果は確認した範囲で関連付けたが、全handlerの内部集約や、特定hookだけが拒否・askを決めたという排他的因果は証明していない。
全入力のlive直積、未取得の個別raw出力、現用設定自体への故障注入、将来版互換は成功済みとしない。
これらと旧Desktopでの同じPの再測定を、採用済み有限契約に対する追加の完了条件にはしない。
issueの公開状態変更は、上記の受入判定とは別の承認済み操作として行う。
