---
name: pfd-retro
description: |
  Use after a sustained stretch of design dialogue or work sessions, when the
  user asks for a retrospective, before consolidating decision records (e.g.
  ADRs, where the repo keeps them) — or when deeply reviewing ANY .pfdsl
  diagram (layers A/B are session-independent review prompts). Audits the PFDs, the session's events, and the knowledge
  artifacts for the failure modes that practice has actually produced, then
  routes findings into ops improvements. Complements pfd-ops (which runs the
  cycle; this skill improves it).
---

# PFD retrospective audit

ユーザーの気付きに依存していた監査を再現可能にする。対象3層: 図（PFD）、セッションで実際に起きたこと、知識成果物。各問いには実例があり、すべて実際に検出された誤りに由来する。

A・B 層はセッション文脈不要 — 任意の PFD のレビューに単体で適用できる（品質ガイドが「書くときのルール」、A・B は「問い詰めるときのプロンプト」）。C・D 層はふりかえり固有。

## A・B. 図の監査（任意の PFD レビューに適用可）

カタログ本文は pfd-ops の workflow companion（`.pfdsl/workflow.md` 等）の pfd-retro バインディングセクションが示す一次情報を読むこと。記載がない場合は pfdsl スキルの `references/review-prompts.md`（skill sync で全採用リポに同梱される）を読む。それも無い場合のみ下記カテゴリ名で監査する。A = 図 vs 現実（エッジ実在性・駆動源・名前の一般化水準・偽の不変性・入力充足）、B = 粒度・型（万能成果物・プロセス実在性・並列主張・修正案への再挑戦・型違い）。

カタログの C 系（仕様・制約）は図でなく normative 仕様文書を問い詰める観点であり、リポが DSL・プロトコル等の仕様を保守している場合のみ適用する。実行手順（具体例の構築・agent プローブ）がリポにあれば companion のバインディングが指す。

## C. 運用イベント監査

- **忘れ物 = 構造の欠落**: セッション中に実際に忘れた作業（例: issue クローズ、tag 更新）は、図に無いエッジ・ゲートに無い項目として読み、両方に反映する。個別「更新したか」より「edge が無い」を機械的に探す方が安い — 同型の複数件を1回の監査で束ねて検出できる
- **起票 issue の roadmap 未追加スキャン**: セッション中に起票した issue を列挙し、全て `roadmap.pfdsl` の artifact として登録済みか機械的に確認する。「起票したが roadmap に追加しなかった」は「edge が無い」の典型型（例: issue 起票後に roadmap 追加を忘れてユーザー指摘まで気付かなかった）。`gh issue list --state open` と roadmap の `location:` フィールドを突合すると漏れが見える
- **委譲の失敗様式**: subagent の誤り（ID 捏造等）はプロセスの入力不足の発見として扱う
- **片肺更新スキャン**: companion `.md` を更新したセッションでは、対応する `.pfdsl` 本体（同じ変換をモデル化しているノード・エッジ・description・criteria）も更新が必要でないか確認する。機械列挙が先: `git diff --name-only <range>` で「`.md` が変更され sibling `.pfdsl` が未変更」のペア（と逆方向）を列挙してから中身を判断する — 全ファイル読みより安い。`.md` は手続き散文、`.pfdsl` は構造の一次置き場 — 片方だけ更新して構造反映が漏れるのが典型パターン。逆方向（`.pfdsl` だけ更新して companion 記述が古いまま）も同様に確認する
- **暗黙の設計判断**: 作業中に下したが記録されていない選択はないか（例: グルーピング基準が問われるまで暗黙だった）
- **選択前の着手**: 実装に入る前に issue 本文を再確認したか。複数の実装方針が列挙されており最終選択が明記されていない issue は「設計未確定」と同等 — 着手前に選択を確定させたか

## D. 知識成果物のライフサイクル

- **スケール監査**: 増え続ける成果物の消費方法は全読を要求していないか（例: ADR の知見をガイド1行に蒸留して全読不要にする）
- **同期在庫**: 知見の複数経路（ガイド蒸留・ADR・issue）で、片方にだけ届いて滞留している在庫はないか（例: 知見が ADR にはあるがガイドに未反映の状態、lint 候補が issue に未同期の状態 — いずれも監査質問で検出できる）
- **列挙ドリフト**: 同じリストが2箇所に存在しないか。一次情報を1つに定め、他はポインタにする
- **改訂規約**: 増え続ける成果物に改訂・廃止の規約があるか（例: ADR 一覧の改訂・廃止規約）
- **休眠能力**: 能力成果物（スキル・ツール）に運用側の起動条件（いつ・誰が・何を契機に呼ぶか）が定義されているか。道具を作っただけでは気付き依存は解消されない（例: 監査スキル自体の起動条件が pfd-ops プロトコルに明記されていなかった）。起動条件は計測可能か（「たまったら」でなく「前回実行以降 N 件以上」の差分計測形か）も確認する
- **L4 滞留監査**: companion のルールのうち固有名詞（リポ名・パッケージ名・ツール名・パス）を含まないものは汎用ルールの疑いがある — 配布層（L3 reference / スキル SKILL.md 本文）への昇格候補として検出する。companion（L4）は配布されないため、汎用知見が滞留すると採用リポに永久に届かない。昇格宛先の判定は出力表「ゲート項目」行の書き分けルール参照に従う

## 出力

検出した findings を以下の宛先に振り分ける。**発見経緯（いつ・何のサイクルで見つけたか）は宛先に書かない** — コミットメッセージ・PR 本文・issue コメントが記録場所。宛先には「ルール・基準・構造」だけを書く。

| finding の種類 | 宛先 |
|---|---|
| ツール・チェッカー品質ルール | 上流ツールスキルの品質ガイド（companion で宛先を指定） |
| 設計判断の記録 | 設計決定記録（ADR 等。companion で所在を指定。運用しないリポでは新設を提案する） |
| 未着手作業の発見 | issue 起票 + roadmap.pfdsl に依存チェーン追加 |
| ゲート項目の追加・修正 | 該当する PFD の criteria または sibling companion の終端ゲート（**ルール文のみ。発見括弧禁止**）。どの companion に書くかは `pfd-ops/references/architecture.md` の「companion への書き分けルール」表に従う |
| 能力成果物の起動条件漏れ | 当該スキルまたは workflow.pfdsl の description に追記 |
| 体感した効果 | 効果ログ（companion で宛先を指定。未定義の場合は記録しない） |
| 監査の新パターン発見 | 本スキルに追記（**L1 のみ**: リポ固有の固有名詞・issue 番号・ファイルパス・ADR 番号を含む記述は禁止。配布 bundle 内のスキル・reference への相互参照は可。問いの構造とパターン種別のみ書く。具体例は companion に追記する） |

宛先の上書き・追加は pfd-ops の workflow companion に従う。

各 companion の終端ゲートセクションはチェックリストであり発見記録ではない。追加するのはルール文1行のみ。

**実行記録**: 監査を完了したら、workflow companion の pfd-retro バインディングセクションに実行記録を1行追記する（形式: `日付 — 対象範囲 — findings 件数`）。この記録が次回 retro の起動条件（pfd-ops プロトコル「定期監査」の差分計測）の基準点になる。companion が無いリポでは記録を省略してよい（/pfd-cycle 経由の自動実行が基準点を代替する）。
