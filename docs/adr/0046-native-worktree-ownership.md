# ADR-0046: native 所有者の肯定証拠で sibling 誤判定を補正する

- Status: Accepted（変更系 Git の限定補正。#1398 全体の受入は未了）
- Date: 2026-10-07
- 対象: #1398。判断記録: https://github.com/takasek/pfdsl/issues/1398#issuecomment-6022222988

PR #1413 の拡張案は [ADR-0047](0047-codex-policy-boundaries.md) に記録する。
以下は限定実装時の判断と受入履歴であり、Codex linked checkout の own・file・主体別 Git policy の拡張と区別する。

## Context

起動元を基準にした既存の guard は、同じリポジトリの別 worktree を sibling と分類する。
native 操作で作成した自分の worktree でも起動元が変わらない場合があり、Claude は ask、Codex は deny となる。
他セッションの誤変更を防ぎつつ、この正常経路を改善する。

Claude 2.1.286 の Desktop と CLI では、対象 worktree の native lock の PID と UTC 起動時刻が、hook プロセスの直接の親と一致した。
Desktop の親・subagent の hook 入力から直接親照合の材料を観測し、CLI の親では候補 hook を通した実 add/commit を確認した。
subagent の hook 観測は、subagent の隔離 worktree にある agent 種別の lock を補正できるという受入ではない。
Codex では native managed worktree の version 1 metadata にある ownerThreadId と hook.session_id が一致し、Desktop の親から候補 hook を通した実 add/commit を確認した。
Claude CLI の生存別所有者・main と、Codex CLI の別 owner identity への add は候補 hook により止まり、対象の HEAD・index・試験ファイルは不変だった。

これらは限定された試行である。
Claude Desktop の実 Git、変更後の全ライフサイクル、Codex の別所有者の同時稼働を確認したものではない。
cd の CLI 試行は harness が own worktree へ cwd を戻したため、移動先に留まった状態での Git 操作には到達していない。
肯定側の baseline ask/deny は同じ入力の比較計算であり、baseline を有効にした別試行ではない。
決定前の Claude 成功 pilot は任意祖先探索版であり、その時点では直接親限定版を接続した実 Git 成功を確認していなかった。
その後、直接親限定の最終ソースを接続した CLI 親の実 add/commit を確認した（後述「この限定実装の検証」）。
比較の公開記録は上記 issue コメントに残す。
2026-10-06〜07 の Claude Desktop/CLI 2.1.286、Codex Desktop/CLI の native metadata version 1 が根拠であり、Claude の保存観測では Desktop 親・subagent と CLI 親の hook 直接親が lock と一致した。
陰性側の native 実測は Claude CLI の生存別所有者・main、Codex CLI の別 owner identity の3ケースである。
独立レビューで原 hook 記録、拒否結果、Git 事後状態を照合した。
7件の再生・注入試験は native 実測件数に含めない。

## Decision

### 既存の保護に対する限定補正

既存の target 解決と repository 分類を維持する。
同一 Git common dir の sibling と確定した対象に限り、native 所有者を操作時に確認して own へ補正する。
own・foreign・unknown の分類自体はこの補正では変更しない。
特に、既存の unknown 判定を全面的な fail-closed と説明しない。
対象 root の解決不能を厳格化する変更は別の方針判断であり、この補正に混ぜない。

main/default branch、検査回避、作用先の既存判定は維持する。
補正が確認するのは checkout の所有者であり、共有 ref や別 worktree に対する権限の証明とは扱わない。
既存の作用先判定を適用するが、repository 全体への影響をすべて拒否できるとは主張しない。
例えば feature checkout を own とした場合の `git stash clear` は現行 parser では allow となり、共通の `refs/stash` に作用する。
この既存の own policy による限界は sibling を own に補正した対象にも生じる。
また `git branch -f main` や `git update-ref refs/heads/main` は現行 parser の guard 対象外であり、feature checkout から共有 default branch の ref を変更する操作まで保護していない。
これらは補正前から relation によらず allow であり、本変更による新たな対象外化ではない。
共有 ref の操作を別 policy として厳格化する判断は #1404 に残し、本変更の受入から一般的な共有状態保護を導かない。
個人の wrapper、trusted roots、承認規則を repo の導入要件にしない。

### Claude の対応条件

初版は、`claude session <name> (pid P start S)` 形式の native lock に記録された PID と UTC 起動時刻が hook プロセスの直接の親に一致する場合だけ補正する。
`claude agent <name> (pid P start S)` の agent 種別は意図して除外し、PID と起動時刻が一致しても確定済み sibling を補正しない。
親セッションと subagent の隔離 worktree が同じ PID を記録する場合でも、親からその隔離 worktree を own と扱う根拠にはしない。
任意の祖先まで一致を探索しない。
Claude A が別セッション B を子プロセスとして起動した構成で、B の hook の遠い祖先に A があることを A の worktree の所有証拠にしないためである。

直接親の照合は保存した CLI・Desktop の親と subagent の hook 観測に一致するが、session 種別の lock への限定を含めて適用する。
subagent が親セッションの session 種別 worktree を対象にする場合と、自分の agent 種別隔離 worktree を対象にする場合を区別し、後者の sibling 補正は行わない。
追加の shell・wrapper・未知の中継プロセスが入る構成は、初版では補正しない。
lock の欠落・読取不能・形式不明、開始時刻不一致、ps 取得失敗、再開後の stale lock は従来の sibling 判断へ戻す。
native 観測で条件を絞った結果であり、全 Claude 起動方式への互換性は主張しない。
native lock が当該プロセスのセッション系列を表すという観測に依存する。
同一プロセス内の独立セッション多重化・所有権移管、時刻の同じ秒内の PID 再利用、読取り後の所有状態変更は未検証である。

### Codex の対応条件

Git が返す対象 worktree 固有の metadata パスから version 1 の ownerThreadId を読む。
非空の hook.session_id と完全一致する場合だけ補正する。
shell の CODEX_THREAD_ID、cwd の移動、個人の台帳を代用しない。
metadata の欠落・読取不能・不正 JSON・未知 version・空 ID・不一致は従来の sibling deny を維持する。
観測済みの private 形式への任意対応であり、将来の意味の互換性を保証しない。
過去の成功判定を永続化して再開後に流用しない。

Codex subagent の所有者 ID が親と同じでも、Git metadata 操作を親が担当する既存指示は変えない。
この責務境界を現行 delegation-guard が Git 全般について機械的に強制しているとは説明しない。
新しい主体別 Git policy の導入は本変更に含めない。

### 実装・説明の境界

所有証拠の取得失敗は補正しないこととして扱い、既存判定を残す。
module のロード失敗、hook timeout、trust skip は所有証拠の欠落と別であり、今回の補正だけで解決したとは扱わない。
policy 全体の失敗時動作と再編は #1404 の判断に従う。
再開・managed 外の worktree の自動救済も本限定改善の成功条件にはしないが、#1398 の未完了項目を消さない。

既存の「そこで作業しているなら所有している」という案内は、所有者を確認できない場合の案内へ修正する。
metadata の手修正、hook の無効化、別コマンドによる迂回を回復手段として案内しない。

## ADR-0044 から変える範囲

次の条項のうち、Bash 経由の変更系 Git に対する所有権判定だけを本 ADR の限定補正へ置き換える。
Edit・Write・apply_patch を扱う file policy と、それらに対する cwd 追従の残存リスクは今回の置換対象に含めない。

- 「repo hook → Bash と MCP の policy」の Claude 変更系 Git で、payload.cwd の checkout root と target を比較する判断。
- 「検討した対案」の Codex 照合を repo 外へ置く判断のうち、変更系 Git の sibling を native 所有情報で補正する範囲。
- 「Consequences」の cd 後の別 checkout を自身と扱う残存リスクのうち、変更系 Git で native 所有者を確認できる範囲。
- 「検討した対案」の session-root による sibling 確認を却下する判断のうち、変更系 Git の既存 fallback を維持する範囲。
- 「main から削除するもの」の main-commit-guard の target 解決・default branch 判定・sibling 判定は、今回の限定補正と既存保護に必要なため本変更では削除しない。#1404 で実装配置を整理する場合も、ここで維持する判定を単純削除する根拠に旧リストを使わない。

ADR-0044 の旧 Decision 本文は保持し、Status と索引で置換範囲と後継を示す。
個人拡張と repo の責務分離、Git 層、MCP・merge、setup・shim、policy 再編の独立した要求は、本変更では確定し直さない。
file policy の現行保護を維持したまま、その再編と旧 ADR の移行手順は #1404 で判断する。
#1403 と #1404 はそれぞれの追跡先に残す。

## 対案と前提

既存候補が共有していた「起動元と異なる native worktree で作業を続ける」という前提を外し、各タスクを独立 clone の起点で実行する案も比較した。
共有 index は除けるが、既存チャットの native worktree 経路そのものは改善せず、別 clone への誤操作を防ぐ境界も別に必要になる。
本件の置換方式としては保留し、所有者が運用変更を選ぶ場合に再検討する。

| 案 | 扱いと理由 |
| --- | --- |
| 両 harness の native 肯定証拠による限定補正 | 採用を提案。実操作の成功と一部の拒否維持を確認でき、個人設定を必須にせず既存の sibling 誤判定を改善できる |
| Claude だけの lock 補正 | 両 harness を改善する目的の全部は満たさない。組合せの Claude 部分として取り込む |
| payload.cwd 比較と Codex 照合撤去 | cd 後も別所有者を区別する要求を満たす代替根拠が無いまま、この要件の置換としては採らない |
| native 隔離へ委ね sibling guard を削除 | 保留。guard を外した同一入力の Desktop・primary・別生存所有者等の検証を再検討条件にする |
| 明示的な session-target binding | 保留。native metadata が無い経路を扱える利点はあるが、登録を正当化する人間確認とライフサイクルを別途決める必要がある。native 案が包含するとは主張しない |
| 現状維持 | 証拠不足時の fallback として維持するが、自分の managed worktree が停止する経路の改善にはならない |

## Consequences と受入

### この限定実装の検証

2026-10-07 に実装先の最終ソースを接続して、次の範囲を確認した。

| 経路 | 結果 | 証明限界 |
| --- | --- | --- |
| Claude 2.1.286 同梱実行体の CLI 親 | 新規 native EnterWorktree、実 add/commit、clean。保存した同一入力の比較では baseline ask、補正後 own。commit `7ce9a6759a61a967cfeccca0fed47196ae7d3802` | Desktop・子の実 Git、再開を含まない。比較 baseline は独立実行ではない |
| Codex Desktop の親 | native create_worktree の version 1 owner と現チャットが一致。最終 hook の下で実 switch/add/通常 pre-commit 付き commit、clean。commit `12eb7f3fc2e47d086f4819cc11bdaaf48a8f719c` | 肯定側の raw hook stdin は未保存。別所有者の拒否で最終 hook の新案内文が実発火したことを別に確認 |
| Codex Desktop の別 owner | clean な別 native owner の worktree に対する tracked/未変更 README の add を一度だけ要求し、最終 hook が実行前に deny。HEAD・index・status 不変 | owner の同時稼働は未検証。不変性だけで拒否とは判定せず、router の拒否を根拠とする |
| 別主体の checker シナリオ | Codex 7本、Claude 4本で own、別owner、main、検査回避、読取等を確認し、Git 状態は不変 | 合成 metadata/lock の実入口判定であり、Git command は実行していない |

Claude CLI の生 stdout/stderr と hook 観測、Codex Desktop の実 command 出力・native metadata・Git 事後状態はローカル試行資料に保存した。
外側の CLI stream と Git 自身の stdout/stderr は区別する。
最終ソースの unit/entry/既存 guard と runner の focused tests は405件成功し、全体 `make test`、`make typecheck`、Biome を確認した。
独立レビューで共有 stash 等に作用する既存 own policy の限界を検出し、上記 Decision に反映した。

### 残る受入

補正のない場合の既存挙動と、補正があっても残る main・検査回避等を、先に失敗するテストから固定する。
session と agent の区別、直接親と遠い祖先の区別、PID 開始時刻、native metadata の形式と失敗、非 ASCII を含む target、環境による Git target の混入を扱う。
最終実装を接続した実入口で、両 harness の対象経路を確認する。
prototype の成功や保存入力の再生を、最終実装の native 実行へ格上げしない。

Claude の親・subagent、Codex の親担当への引継ぎ、別生存所有者、cd 後、Desktop、再開・fork・handoff の未確認項目を #1398 に残す。
全条件を満たすまで本限定変更だけで #1398 を close しない。
品質・correctness・設計妥当性・既存動線のレビューを最終差分に適用する。
この変更は repo 運用 guard の規則であり、pfdsl 記法の品質ガイドへの蒸留は不要である。
