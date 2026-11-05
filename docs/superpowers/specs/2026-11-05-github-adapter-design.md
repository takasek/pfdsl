# GitHub アダプタの配布と採用宣言（所有者判断案）

**単一の `pfdsl` plugin を維持し、リポジトリごとの明示宣言で GitHub Issues アダプタを有効にする案を推奨する。**
所有者には [ADR-0048 D5](../../adr/0048-responsibility-boundary-by-pfd-semantics.md) の代替案への切替と、以下の既定無効・一括移行の契約を承認するか判断していただく。
2026-11-05 時点の設計案であり、承認後に roadmap の後続工程 `apply_github_adapter_design` が実装する。

## 依存を誰が解決するか

pfdsl の調査基準は `7802a7a7`。Claude 用 marketplace は `pfdsl@pfdsl` の一件を `plugin/pfdsl` の git-subdir、公開タグ `v0.2.0` に固定している。
生成器は共通正本から Claude と Codex の別々の root を組み立てる。
Codex の互換導入は Claude 用の公開物を読み、native root は外部 marketplace 構築者への引渡し物である。repository 用の skills・agents も別に生成される。[marketplace](../../../.claude-plugin/marketplace.json)・[配布単位](../../../scripts/harness-template/skills/pfd-ops/references/architecture.md)

| 環境・経路 | adapter が core を要求したとき | 分割する場合の条件 |
| --- | --- | --- |
| Claude Code、同じ marketplace | `dependencies: ["pfdsl"]` で同じ marketplace の core を宣言でき、install 時に不足分を解決する。version を指定する場合は semver 制約を使える。 | 現行の git-subdir で範囲解決するには core の `pfdsl--v<version>` タグが必要。現在の `v<version>` pin と区別して release 手順で管理する。 |
| Codex、Claude 互換 marketplace | marketplace の読込みと plugin ごとの install はできる。Claude 用の依存を解決する契約は確認できない。 | 2エントリの掲載に加え、core の明示導入・有効化と版照合が要る。 |
| Codex、native root | 現行の `.codex-plugin/plugin.json` の読取型に plugin 依存欄がなく、ローカル marketplace の install は指定された一件を解決する。 | 外部構築者が両 root を掲載し、採用先が両方を有効にする必要がある。repository assets の配置にも marketplace の解決器は働かない。 |

Claude は公式のインストール・タグ解決仕様を確認した。Codex は OpenAI 公式のパッケージ仕様と、手元の CLI と同版の `rust-v0.166.0-alpha.6` のパーサおよび installer を照合した。
この結果は現行の配布経路についての仕様・ソース確認で、実機での二つの plugin の導入試験は分割案を選ぶ場合に行う。[Claude Code の依存解決](https://code.claude.com/docs/en/plugin-dependencies)・[OpenAI の plugin 配布仕様](https://developers.openai.com/plugins/build/plugins)・[Codex manifest](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.6/codex-rs/core-plugins/src/manifest.rs#L48-L73)・[Codex installer](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.6/codex-rs/core-plugins/src/manager.rs#L2138-L2192)

## 配布案の比較

分割案では同じ repo の `pfdsl` を core として残し、新しい GitHub plugin に preset、managed issue hook、配置用スクリプト・workflow を収める。非採用者の配布物からこれらを除けることが最大の利点である。
ただし現在の二つの harness root は四つになり、inventory・生成・release pin・版の互換条件・配布レビュー・外部への引渡しを両 plugin 分扱う。
既存の GitHub 採用者が旧単体を更新すると core だけが残る。依存の向きは adapter → core なので Claude でも新 adapter を追加する移行が必要になる。
Codex では片方が欠けた状態、無効な状態、片方だけ更新された状態を自前で検出する責任も生じる。
一つの配布元を保つため別 repo への分離も選ばない。

単一案は従来の導入名・release pin・外部引渡しを使い、両環境で同じ採用単位をリポジトリに置ける。
代償として GitHub 用ファイルは非採用者にも配布され、登録済み hook の入口は呼ばれ得る。その入口を含む全経路が宣言を守ることを配布側が検証する。
今回必要な結果は「採用したリポでだけ働く」ことであり、ホスト別の依存管理を引き受ける費用に見合う物理分割の要求はない。非採用環境への同梱自体が禁止されるか、Codex 両経路で依存・版解決が保証される場合は分割を再評価する。

## 提案する採用契約

採用先が管理する `.pfdsl/config.json` のトップレベルに次のキーを加える。値は今回の提案である。

```json
{ "githubIssues": { "enabled": true } }
```

ファイル・キーの欠損または明示的な false は無効。キーがあるときは object と boolean の enabled を必須にする。破損・型不正・読取エラーは診断して GitHub 操作を止める。
対象は操作するリポジトリ（hook はイベントの作業先、CI は checkout 先）で解決し、plugin の cache や別 worktree の設定を読まない。
機械判定の正本はこのキーとし、roadmap companion は backend の運用説明と参照先を持つ。companion と宣言が矛盾したら移行時・初期化時に所有者が解消する。remote の host、Issue URL、配置済みファイル、旧 sweep 宣言から採用を推定しない。

| 入口 | 宣言の適用 |
| --- | --- |
| pfd-ops・pfd-init・pfd-ecosystem・scaffold | pfd-ecosystem のステップ 3.5 で backend 選択後に採用宣言を保存し、GitHub 採用時だけ reference、配置、依存導入・ラベル準備、初回監査へ進む。未採用では file-based または選択済みの運用へ進む。 |
| managed issue hook・issue 監査 | 未採用の hook は通知も GitHub 呼出しもしない。配置済み audit の直接起動も取得前に判定し、非該当を明示する。 |
| install-sync | 共通の版・移行状態の確認は維持する。未採用では GitHub の drift 通知・deploy・orphan 削除を行わず、旧配置の manifest とローカル編集を保持する。上流自身への deploy 禁止を維持する。 |
| 自動回収 | GitHub 採用と既存の `sweepCompletedChains.enabled === true` の両方を要求する。checkout の直後に判定し、CLI 準備・token 発行・変更・PR 起票の前に終了する。 |
| core | process と作業項目の対応、managed/exempt・close の意味は共通 protocol、保持規則は CLI の `prune` に置く。file-based preset から GitHub reference に向く分類基準の参照は共通 protocol へ向ける。手動 prune と file-based 運用、独立宣言の知識監査、配布機構の上流報告は GitHub Issues 採用条件の外に置く。 |

## 既存採用先の切替

上流 pfdsl 自身は GitHub Issues と自動回収を採用している。後続実装では追跡中の config に採用宣言を加え、正本の hook・workflow・scripts と生成物を同じ変更で更新する。上流では deploy・移行記録を実行せず、生成差分の照合と repo の監査・回収プレビューで確かめる。以下は配布物を受け取る採用先の手順である。

1. 対象 release が出たら、旧 CLI・plugin の版と bundle、companion の採用 backend、sweep 設定、配置 manifest とローカル差分を記録する。移行は対象版の [migration guide](../../migration-guide.md) から案内する。
2. GitHub 採用先では、旧版のうちに既存キーを保って宣言を追記し、companion と照合する。現在の sweep の on/off はそのまま移す。宣言の追加から新 CLI・plugin・配置物の切替までを一つの移行として扱う。Claude は従来の marketplace、Codex は利用中の互換経路または外部構築者の同版 native bundle を使う。
3. GitHub 採用先では対象版の install-sync で差分を読み、通常の deploy で workflow とスクリプトを更新する。ローカル編集による skip は新旧を比較して必要な修正を手で統合する。yaml と prune 対応 CLI を確認し、初回 issue 監査、回収プレビュー、managed issue 通知と workflow の両条件を確認する。GHE では実際の host/repo の識別を確認する。
4. file-based・未採用のリポは未宣言のまま更新できる。過去に配備した旧 workflow は plugin 更新後もリポに残り、旧 sweep キーだけで動く。切替前に旧 sweep を無効化し、不要な workflow・監査の呼出し元と配置物を所有者が差分レビューして撤去する。編集済みの資産を退避し、未採用を理由に一括削除しない。新規採用先は backend 選択後に宣言してから配置する。
5. 成功確認後にだけ対象版を `appliedMigration` に記録する。中断時は sweep を停止し、保存した旧 CLI・plugin・配置物・設定を一組で戻し、旧監査と dry-run を確認してから従前の sweep 設定へ戻す。混在状態で運用を再開しない。

後続工程では新規初期化の選択・宣言保存・配置の順序と、file-based 選択時に配置しないことを確認する。両 harness の配布物から、未宣言・false・true・壊れた設定、既存 GitHub と file-based の移行を検証する。同じ managed issue 成功入力で通知の有無を比較し、sweep の二条件の各組合せ、未採用時の外部取得ゼロ、反復 deploy 後の編集済みファイル保全、core の prune と移行状態の照合を受入条件にする。公開版・採用先での動作確認は設計承認と別に記録する。
