# ADR-0050: agent 操作の保護を減らし、検査と統合の層へ分担する

- Status: Accepted
- Date: 2026-10-23
- Supersedes: ADR-0046、ADR-0047。ADR-0044 の repo policy・harness の隔離前提・委譲先拒否・関連する移行方針と GitHub の責務は部分的に置き換え、Git 層の pre-commit・共有 shim・setup は維持する。
- 判断記録: [#1499 の採用決定](https://github.com/takasek/pfdsl/issues/1499#issuecomment-6359810314)、[P1 と deny 撤回](https://github.com/takasek/pfdsl/pull/1529)。

## Context

主体・worktree 所有者・コマンドの作用先を repo hook で推定すると、harness の版・起動経路・shell・CLI の表記へ追従する判定表と回復手順が増える。
正常作業の誤拒否を直すための機構が、次の停止や保守を生む状態を解消する。

所有者は、primary/sibling へのローカルの誤編集・stage が起こり得る残余を受け入れ、機構と運用を簡素化する方針を選んだ。
worktree の Claude から primary の README.md が編集・stage されたとの所有者報告がある一方、成功した呼出し・session・適用設定の対応は未取得である。
別試行の拒否は repo hook によるものであり、native 本体が全経路を拒否する証拠にはしていない。
Claude Desktop 3.6556.1 / Claude Code 2.1.308 の報告と、primary 起点である本 Codex チャットの観測を、linked worktree 起動時の隔離受入へ付け替えない。

これは事故が常に軽微・復旧可能であるという判断ではない。
他者の未コミット作業を壊す可能性を引き受ける判断であり、native の全面的な拒否や強いアクセス隔離の成立を撤去の前提にしない。

## Decision

### 廃止する責務

`agent-operation-guard`、`command-usage-guard`、`verification-tree-guard` の配線と実装を撤去する。
そのためだけの主体・所有追跡・shell/Git/MCP 分類、native 所有証拠、option 表・コーパス・未解決入力台帳、probe・policy supervisor と各テストも撤去する。
subagent の push 拒否を別の hook や allowlist で復活させない。
個人 wrapper や trusted-root を repo 全体の前提にしない。個人環境の設定変更はこの決定の実装範囲に含めない。

P1 で撤回した permissions.deny は追加しない。
clean 判定や全検査の snapshot 化も追加しない。
表記ごとの判定表・deny パターンや、コマンド文字列・プロセス・lock から主体・所有・作用先を再構成する仕組みを増やさない。

### 残す責務

| 層 | 担うことと限界 |
| --- | --- |
| harness・sandbox と作業先の割当 | 標準機能と通常の承認で取り違えを抑止する。primary/sibling の全経路の書込み拒否は保証しない。 |
| Git pre-commit・共有 shim・setup | default branch 上の通常 commit を拒否し、既存の staged 検査を実行する。編集・git add・hook を経由しない操作の防止ではない。 |
| make push | test・typecheck・lint・文書・生成物検査を通してから push し、検査失敗で止まる。一般の検査は作業ツリーを読むため、dirty tree で push する commit の検査成功を強制するものではない。 |
| remote の必須 check と人間 | main の通常の統合条件を担う。gen-plugin・sync-check・test・vscode-smoke を必須とし、既存 bypass は別扱いとする。ローカル file/index の保護は担わない。 |
| 検証と完了報告 | 実行 checkout・HEAD・未コミット差分の状態と結果を対応させ、対象 OID と同 OID に対応する CI 結果を報告する。待機・失敗・未実施を成功と説明しない。 |

実装だけの委譲では外向き操作の担当を呼び出し元に残し、harness が対応するツール制限と戻り時の照合を使う。
これは全経路の外向き操作を機械的に拒否する保証ではない。

### 消費者が残る部品

旧削除リストはファイル名だけで実行しない。
残す内容検査 guard と生成器を実際の消費者から確認する。

| 維持する部品 | 残る消費者 |
| --- | --- |
| harness-source-decoder | gen-plugin・Codex asset 生成器。hook 正本の decode は引き続き必要。 |
| shell-commands・shell-heredoc・shell-parser-tool と parser setup | closes-create-guard が PR 作成命令と本文を検査するために使用。既存の parser と3秒の timeout を維持する。 |
| closes-create・roadmap-publish・generated-root-instructions | PR 本文や明示された書込み先の内容を確認する既存 guard。所有・主体の分類器の代替にはしない。 |

残る parser の timeout 定数は使用箇所へ置き、消費者を失った agent-operation の timeout module と policy deadline は削除する。
parser の取得・依存 marker の検査は setup に残す。
共有 parser に残っていた未使用の cwd・Git 作用先 metadata と policy 用 API は撤去する。
内容検査が使うコマンド抽出・wrapper 解釈・literal script 展開とエラーの扱いは維持し、判定範囲を増やさない。

## Consequences

任意の raw push、検査回避、primary/sibling の未コミット file/index 変更、委譲先の全経路の外向き操作を repo が事前に止める保証を失う。
ローカル検査が未コミットの修正で通り、修正を含まない commit が push される残余もある。
remote CI や人間の判断を、これらのローカル操作自体を防ぐ機構とは説明しない。

残存する内容検査・生成・setup・Git hook の健全性と、正規 push の失敗時停止を確認する。
単体テストや CI の成功を native 隔離の受入には使わない。
移行後4〜6週間の誤拒否、CI 赤 push の件数と時間・手戻りは P3 で観察する。
保護を再追加する場合は、記録された実害と費用、既存の層で扱えない理由から所有者が再評価する。
