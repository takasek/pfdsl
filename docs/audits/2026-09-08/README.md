# pfdsl アーキテクチャ監査 — 2026-09-08

> アーカイブ注記（2026-09-10）: この文書は固定コミット `827bcb1cb96238f918dad84dc6453176f131e029` を対象にした当時の監査記録であり、現行の不具合一覧や実装計画ではない。
> 最新の対応状況と残件は [#1055](https://github.com/takasek/pfdsl/issues/1055)、CLI 0.0.26 の公開完了記録は [#1138](https://github.com/takasek/pfdsl/issues/1138) を参照する。
> 観測・評価・提案は当時の内容を保持し、個人環境を含むパス表記は公開用の例示パスへ置換した。
> Markdown リンクは、このアーカイブ内の相対参照または監査対象コミットへの固定参照へ置き換えた。

対応方針は、機構自体の必要性まで見直した [削減を優先する対応表](reduction-plan.md) に更新した。
以下は初回監査の観測事実と、その時点の改善案である。

優先して直すべき問題は、整形時のグラフ消失、roadmap 同期時の依存情報消失、生成処理のロックと復旧範囲の不一致である。
いずれも固定コミットの実装を使う小さな反例で再現した。
既存テストは 3,975 件成功・1 件 skip だったが、正当な構文の組合せ、依存先を含む判定、更新の履歴、非同期処理の順序を横断する反例は取りこぼしていた。

監査対象は `827bcb1cb96238f918dad84dc6453176f131e029`。
取得時の `origin/main` と同一で、専用 worktree `/path/to/pfdsl` の detached HEAD に固定した。
issue・PR の本文・コメント・状態は取得も検索もしていない。
実装、仕様、テスト、ワークフロー定義、呼出し経路と合成データだけを監査根拠とした。
通常の setup/build が作る無視対象ファイルを除き、追加物は本監査資料と証拠だけである。
製品ソースの変更、commit、push、外部公開は行っていない。

## 優先順位と証拠の強さ

P1 は通常操作で保存内容を失う、または競合時に他の実行の成果を取り消す問題。
P2 は検査・表示・配布の正しさ、または入力規模に対する計算量の問題。
P3 は検証の過剰実行と補助通知の不整合。
この分類は本監査内の修正順であり、実運用の発生頻度や障害件数を測ったものではない。

| ID | 優先 | 根本原因と確認した結果 | 証拠・限界 | 詳細 |
|---|---|---|---|---|
| C1 | P1 | 全体 parser と別の分割・出力規則で整形し、成功した入力の辺を失う | 実 CLI の `fmt --write` が exit 0 で 2 辺を 0 辺へ変更。コメントを挟む継続も 3 辺から 0 辺 | [core/CLI](core-cli.md) |
| G1 | P1 | roadmap 同期が regex で再構築した不完全なグラフを使って削除する | 正準 flows の合法な `Product` を下流なしと誤認。別例では残存 `revises` が V016 | [運用・検証](governance.md) |
| D1 | P1 | 全体 rollback が内側の排他制御を越えて他の実行を復元対象にする | 本物の lock/rollback に実行順を注入。ロック拒否側が別 writer の `new` を `old` へ復元。実 2 process 実験ではない | [生成・配布](distribution.md) |
| C2 | P2 | 読込済み依存の診断と検証対象範囲が成功結果に表れない | 子の V001、孫の V034、不正 preset が entry の `check --json` では成功。全面再帰検証の仕様は要明確化 | [core/CLI](core-cli.md) |
| C3 | P2 | YAML の構文成功を既知フィールドの型保証として扱い、空宣言の正規化も局所的 | `parts: 42`、`extends: 42`、空 process 宣言で TypeError。数値 label は正常対照 | [core/CLI](core-cli.md) |
| R1 | P2 | 差分の入力と「変更なし」の判定が表示経路間で保存されない | 同じ CLI 入力で text は 4 辺の差分、DOT は変更なし。extension command は metadata を渡さず変更を消す | [描画・エディタ](render-editor.md) |
| R2 | P2 | フィールド別のパス規則と YAML 値を各 UI が再解釈する | subflow に誤って basePath 適用。引用符付き配列・comma・comment・URL のリンク先も不一致 | [描画・エディタ](render-editor.md) |
| R3 | P2 | プレビュー描画に失効条件がなく、古い非同期結果が現在の状態を上書きする | WASM 初期化待ちに error を受けると、先行 render が完了後に古い図を復活。DOM/host harness で確認 | [描画・エディタ](render-editor.md) |
| D2 | P2 | 今回の canonical と前回の配布 baseline を混同する | 無編集 v1 の v2 更新を skip し、manifest だけ v2 hash。後の削除も orphanSkipped | [生成・配布](distribution.md) |
| G2 | P2 | 登録ゲートの起動範囲と失敗範囲が対象作業に合わない | roadmap 無変更では path trigger 外。対象 issue 以外の updatedAt drift でも失敗。hosted 設定未確認 | [運用・検証](governance.md) |
| G3 | P2 | bundle の実入力と freshness 判定の入力集合が一致しない | core 更新を CLI bundle の古さに反映しない。実 helper と filesystem fixture で確認。古い CLI による具体的な誤合格までは未実験 | [運用・検証](governance.md) |
| G5 | P2 | 限定的な語句 lint の結果を意味判定・全面的な合格表示へ広げる | version 固定の `npm view` criteria を誤拒否。shell import の表記差を取りこぼす。限定 lint の成功表示も過大 | [運用・検証](governance.md) |
| C4 | P2 | 共有 preset DAG を実効値の解決前に経路数へ展開する | 深さ 18、登録 38 文書で 524,287 要素。最終 presentation は一定。1 回の小規模計測 | [core/CLI](core-cli.md) |
| G4 | P3 | snapshot の起動条件が実入力より広く、目的を失った依存入替も残る | operational PFD 変更から無関係な fixture の core 全体 `-u` を起動。時間・通信量は未測定 | [運用・検証](governance.md) |
| G6 | P3 | 補助通知が成功した commit ではなく command の部分文字列を観測する | 所定 wrapper と `git -C` を見逃し、echo を検出。repo-local の別 reminder は存在 | [運用・検証](governance.md) |

15 所見を、P1 3 件、P2 10 件、P3 2 件に整理した。
同じ設計傾向でも修正境界が異なる fmt・roadmap 同期・リンク解決は別所見とした。
R1 は一つの差分保証に関する所見だが、metadata の受け渡しと空判定は別々に修正・回帰確認する必要がある。

## 現在の責務と残すべき境界

| 領域 | 入力から成果物への責務 | 評価 |
|---|---|---|
| core | DSL/YAML → AST → 正規化辺・ノード種別 → 診断・graph・編集結果 | 共有する意味モデルの中心として妥当。C1/C3 は他層へ渡す前の保証に穴がある |
| graphviz / metadata / preview | 解析済み graph と metadata → DOT・固定列データ・描画結果 | 固定列や Node/browser 別実装には用途上の理由がある。全 exporter 統合は不要 |
| CLI / VS Code | ファイル・文書・利用者操作 → core/描画呼出し → 検査結果・保存・表示 | 宿主依存の分離は妥当。ただし判断と非同期状態管理が「配線」の中に残る |
| PFD 運用 | roadmap の成果物依存・進捗、workflow の作業契約、pipeline の製品生成関係を可視化 | 成果物の先行関係と open work 保存は重要。regex の別モデルで更新しないことが課題 |
| scripts / hooks / CI | 変更・イベント・証拠から、検証対象と verdict を選ぶ | 全体チェックの存在より、何を・いつ・どの対象について保証するかを揃える必要がある |
| generator / install | canonical source と配布能力定義 → Claude/Codex の repo/plugin、採用先 install | 4 target、意図的な配布除外、adopter の自立性は維持。D1/D2 は排他と更新履歴の責務を修正する |

`.pfdsl/pipeline.pfdsl`、`workflow.pfdsl`、`roadmap.pfdsl` は実 CLI の `check --json` がすべて成功し、roadmap の orphan は空だった。
pipeline の terminal を含む構成は companion の役割説明と合わせて確認した。
図が表す成果物の因果関係、サイクル終了時の retrospective、正本から配布物への一方向生成は残すべき設計である。

## 問題を見逃す横断的な要因

**解析済みの意味を、境界で再び文字列から推測している。**
formatter のコメント境界、roadmap の consumer/output、エディタの YAML 値がそれぞれ別の規則を持つ。
個別の regex 例外を足すだけでは、正当な表記の組合せに追従し続ける必要がある。
既存 parser、normalized edges、CST の値と範囲を必要な場所で使うことが、小さい修正で保証を揃える方向になる。

**入力・結果・証拠の有効範囲が同じ単位で扱われていない。**
検査した entry と読み込んだ子、CLI source と bundle に取り込む core、表示中の文書と初期化待ちの描画、配布済み内容と今回の canonical がずれる。
各層に万能な状態管理を新設する前に、対象 path、文書 version、実入力集合、前回配布 hash など、既に必要な同一性を境界へ渡すべきである。

**テストが守る局所保証と、利用者へ示す保証に差がある。**
formatter の既知非 roundtrip を固定する期待値、辺追加時に必ずノードも増える diff テスト、単一生成関数内だけの競合テスト、初回配布と直後削除だけの更新テストは、今回の反例を区別できない。
extension の coverage 除外は「判断を logic へ抽出済み」と説明するが、metadata の入力選択、basePath 適用、render 失効管理は除外側に残る。
一方、既存 smoke が検証する pan、zoom、minimap、ソースへの移動には価値がある。
閾値の引上げや全 UI テストの常時実行より、登録済み command/message handler を通す少数の契約テストを加える方が各欠陥に対応する。

## 改善の順序（初回監査時）

1. **保存内容を失う経路を修正する。** C1 の共通 ID serializer と statement 境界、G1 の normalized graph に基づく削除判断を優先する。回帰条件は構文成功に加え、残す辺・ノード種別・孤立ノード・参照・open work の状態が保たれること。
2. **生成の排他を最外周へ合わせる。** D1 は snapshot 前に所有権を取得し、lock 拒否側が rollback へ入らない形にする。inner と outer の両方を通す競合テストを置く。
3. **検査・表示・更新の契約を境界で揃える。** C2 の範囲明記と構文診断保持、C3 の既知 shape の検査、R1/R2 の入力保持、R3 の世代管理、D2 の三者比較をそれぞれ小さな変更として扱う。
4. **ゲートの保証範囲を整える。** G2 は登録対象の verdict と全体 drift を分ける。G3 は bundle の実入力へ freshness を合わせる。G5 は確実に判定できる形だけを hard error にし、成功表示もその範囲へ合わせる。
5. **不要な仕事を減らす。** C4 は解決済み presentation をメモ化し、後勝ちの merge 意味を保つ。G4 は実際の snapshot 入力に起動条件を合わせ、G6 は成功した commit に補助通知を結び付ける。

保存前の全面的な再解析や新しい重いキャッシュ基盤を、一律に必須とする提案ではない。
まず各反例を失敗する回帰テストにし、既存の意味モデルを再利用して直し、その費用に見合う安全網を選ぶ。
この初回案は既存機構の維持を前提にしていた。
その後、過剰な強制と重複を削る方針へ見直したため、実装対象と順序は冒頭の対応表を参照する。

## 断定しなかった事項

- `label: 42` は check/render の両方で正常に処理された。クラッシュ候補から除外した。
- start-of-cycle の `behindBase > 0` 拒否は最新 origin 起点の方針に合う。「checker 自身が古い」という説明は過大でも、開始 gate の停止自体は不具合として数えなかった。
- review trailer の self-report 性は実装が明示的に受容している。「一度レビューした」記録と「最終差分がレビュー済み」のどちらを求めるかは設計判断であり、現在の挙動だけで欠陥としなかった。
- partial staging の index/worktree 不一致、setup の crash・stale lock 回収競合、release の生成集合と stage 集合の差は追加調査対象。今回、実障害として再現していない。
- metadata の固定列、repo 専用能力の plugin 配布除外、bundle manifest が runtime integrity を証明しないことは、明示された責務に沿う。機能が存在しないだけでは欠陥に数えていない。

## 実施した検証

実行環境は macOS arm64、Node.js `26.5.0`、pnpm `10.33.2`。
CI 定義の Ubuntu / Node 24 と異なるため、この結果を hosted CI の実行結果とは扱わない。
setup/build 後の checkout-local CLI と library を用いた。

| 検証 | 結果 | 証拠 |
|---|---|---|
| setup / workspace build | 成功 | 実行時の tool 結果。build 済み dist を後続再現で利用 |
| 既存 package tests | core 626、graphviz 173、metadata 9、preview 25、VS Code 215、CLI 591 成功・1 skip | [全テストログ](evidence/baseline-tests.log.txt) |
| scripts tests | 2,336 成功、失敗 0 | 同上。例外表示を含む fixture のログより最終集約を採用 |
| workspace typecheck | 成功 | [ログ](evidence/baseline-typecheck.log.txt) |
| check-docs | 成功。既存 sample の warning は残る | [ログ](evidence/baseline-docs.log.txt) |
| 文書内 DSL / registry / retro catalog | 13 block・11 file、59 codes、83 patterns の検査が成功 | 同上 |
| canonical install-sync / scaffold-sync | 成功 | 実行時の tool 結果 |
| 運用図の check | 3 図とも `ok:true`、diagnostics 空 | [pipeline](evidence/pipeline-check.json)、[workflow](evidence/workflow-check.json)、[roadmap](evidence/roadmap-check.json) |
| 追加反例 | 8 本のスクリプトが実行完了。製品の誤挙動を観測・assert する実験 | [再現手順と証拠一覧](evidence/README.md) |

skip は `CI` 環境変数がないと動かない CLI smoke の CI 専用 assertion である。
それ以外の成功数は保存した全ログの最終集約から計算した。
製品コードを変更していないため、合格済みの全件テストは繰り返していない。

## 範囲と限界

core/CLI、描画/エディタ、生成/配布を独立担当で読み、主担当が重要な一次資料と全追加再現を確認した。
所見の統合後には、検査範囲の仕様、正常対照、意図的な制約を再確認して断定を弱めた。
各詳細ファイルに、調べたモジュール、実行した経路、未確認条件を記載した。

本監査は全経路の証明、実利用者への影響調査、セキュリティ全体の認証ではない。
VS Code 実機・remote/virtual workspace、実 2 process の競合、OS をまたぐ path と publish 後の package import、browser による PDF/PNG、GitHub event と branch protection、実採用先の install 更新は未実行である。
それらに依存する結論は、配線の所見または追加調査対象として明示した。
