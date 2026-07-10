---
name: pfd-retro
description: |
  Use after a sustained stretch of design dialogue or work sessions, when the
  user asks for a retrospective, or before consolidating decision records
  (e.g. ADRs, where the repo keeps them). Audits the PFDs, the session's
  events, and the knowledge artifacts for the failure modes that practice
  has actually produced, then routes findings into ops improvements.
  Complements pfd-ops (which runs the cycle; this skill improves it).
---

# PFD retrospective audit

ユーザーの気付きに依存していた監査を再現可能にする。対象3層: 図（PFD）、セッションで実際に起きたこと、知識成果物。各問いには実例があり、すべて実際に検出された誤りに由来する。

A・B 層はセッション文脈不要 — 任意の PFD のレビューに単体で適用できる（品質ガイドが「書くときのルール」、A・B は「問い詰めるときのプロンプト」）。C・D 層はふりかえり固有。

## A・B. 図の監査（任意の PFD レビューに適用可）

対象が大きい図・複数図の場合は pfd-lens agent（`.claude/agents/pfd-lens.md`）へ委譲する。pfd-lens はセッション文脈不要な read-only agent で、A・B カタログを自ら読み込み file:line アンカー付き findings を返す — main context にカタログ全文・対象図・思考過程を載せずに済む。返った findings は C・D 層の監査結果と合流させて出力表へ振り分ける。

小さい図1枚のみのレビューであれば委譲の cold start（agent 起動オーバーヘッド）が割に合わないため main thread でカタログを直接参照する。カタログ本文は `.pfdsl/bindings/pfd-retro.md` が示す一次情報を読むこと（例: `.pfdsl/review-perspectives.md`）。記載がない場合は pfdsl スキルの `references/review-perspectives.md`（plugin なら `${CLAUDE_PLUGIN_ROOT}/skills/pfdsl/references/`、repo-local なら `.claude/skills/pfdsl/references/`）を読む。それも無い場合のみ下記カテゴリ名で監査する。A = 図 vs 現実（エッジ実在性・駆動源・名前の一般化水準・偽の不変性・入力充足）、B = 粒度・型（万能成果物・プロセス実在性・並列主張・修正案への再挑戦・型違い）。

カタログの C 系（仕様・制約）は図でなく normative 仕様文書を問い詰める観点であり、リポが DSL・プロトコル等の仕様を保守している場合のみ適用する。実行手順（具体例の構築・agent プローブ）がリポにあれば `.pfdsl/bindings/pfd-retro.md` が指す。

## C. 運用イベント監査

- **忘れ物 = 構造の欠落**: セッション中に実際に忘れた作業（例: issue クローズ、tag 更新）は、図に無いエッジ・ゲートに無い項目として読み、両方に反映する。個別「更新したか」より「edge が無い」を機械的に探す方が安い — 同型の複数件を1回の監査で束ねて検出できる
- **起票 issue の roadmap 未追加スキャン**: セッション中に起票した issue を列挙し、全て `roadmap.pfdsl` の artifact として登録済みか機械的に確認する。「起票したが roadmap に追加しなかった」は「edge が無い」の典型型（例: issue 起票後に roadmap 追加を忘れてユーザー指摘まで気付かなかった）。`gh issue list --state open` と roadmap の `location:` フィールドを突合すると漏れが見える
- **委譲の失敗様式**: subagent の誤り（ID 捏造等）はプロセスの入力不足の発見として扱う
- **片肺更新スキャン**: companion `.md` を更新したセッションでは、対応する `.pfdsl` 本体（同じ変換をモデル化しているノード・エッジ・description・criteria）も更新が必要でないか確認する。機械列挙が先: `git diff --name-only <range>` で「`.md` が変更され sibling `.pfdsl` が未変更」のペア（と逆方向）を列挙してから中身を判断する — 全ファイル読みより安い。`.md` は手続き散文、`.pfdsl` は構造の一次置き場 — 片方だけ更新して構造反映が漏れるのが典型パターン。逆方向（`.pfdsl` だけ更新して companion 記述が古いまま）も同様に確認する
- **暗黙の設計判断**: 作業中に下したが記録されていない選択はないか（例: グルーピング基準が問われるまで暗黙だった）
- **選択前の着手**: 実装に入る前に issue 本文を再確認したか。複数の実装方針が列挙されており最終選択が明記されていない issue は「設計未確定」と同等 — 着手前に選択を確定させたか
- **保留した違和感の想起**: 他の C・D 層項目をすべて確認し終えた後、セッションログを遡り「これでいいのか」と一瞬迷ったが立ち止まらず流した判断・スキップした検証・声に出さず流した疑問はないか自問する。他の項目は git diff・issue 一覧等の機械列挙が起点になるが、この種の迷いは実行者の記憶にしか残らず、明示的に想起するステップを置かないとユーザーに聞かれるまで出てこない（例: 「完了基準を満たした」と報告しつつ実地検証はせず文言修正のみで済ませた、ゲート項目が "presence-only" で実質不通過判定できていないと自分で気づきつつ流した）。「特になし」で終える場合はその旨を報告に明示する

## D. 知識成果物のライフサイクル

- **スケール監査**: 増え続ける成果物の消費方法は全読を要求していないか（例: 設計決定記録（ADR 等）の知見をガイド1行に蒸留して全読不要にする）
- **同期在庫**: 知見の複数経路（ガイド蒸留・設計決定記録・issue）で、片方にだけ届いて滞留している在庫はないか（例: 知見が設計決定記録にはあるがガイドに未反映の状態、lint 候補が issue に未同期の状態 — いずれも監査質問で検出できる）
- **列挙ドリフト**: 同じリストが2箇所に存在しないか。一次情報を1つに定め、他はポインタにする
- **改訂規約**: 増え続ける成果物に改訂・廃止の規約があるか（例: 設計決定記録の一覧の改訂・廃止規約）
- **休眠能力**: 能力成果物（スキル・ツール）に運用側の起動条件（いつ・誰が・何を契機に呼ぶか）が定義されているか。道具を作っただけでは気付き依存は解消されない（例: 監査スキル自体の起動条件が pfd-ops プロトコルに明記されていなかった）。起動条件は既存の機械判定可能なイベントに紐づいているか、それとも判定のために新たな記録機構を要る条件かも確認する — 後者は運用コストに見合っているか要検討
- **L4 滞留監査**: companion のルールのうち固有名詞（リポ名・パッケージ名・ツール名・パス）を含まないものは汎用ルールの疑いがある — 配布層（L3 reference / スキル SKILL.md 本文）への昇格候補として検出する。companion（L4）は配布されないため、汎用知見が滞留すると採用リポに永久に届かない。昇格宛先の判定は出力表「ゲート項目」行の書き分けルール参照に従い、昇格の実施は「出力」節の上流変更ルールに従う
- **配布スキル本文の蒸留監査**: 配布スキル本文の手順リストで、複数の追記が同一原則に統合できるものはないか。追記の堆積は原則への蒸留候補である — 各行について「これはまだ原則か、個別事故の傷跡か」を問う

## 出力

検出した findings を以下の宛先に振り分ける。**発見経緯（いつ・何のサイクルで見つけたか）は宛先に書かない** — コミットメッセージ・PR 本文・issue コメントが記録場所。宛先には「ルール・基準・構造」だけを書く。

| finding の種類 | 宛先 |
|---|---|
| ツール・チェッカー品質ルール | 上流ツールスキルの品質ガイド（companion で宛先を指定） |
| 設計判断の記録 | 設計決定記録（ADR 等。companion で所在を指定。運用しないリポでは新設を提案する） |
| 未着手作業の発見 | issue 起票 + roadmap.pfdsl に依存チェーン追加 |
| ゲート項目の追加・修正 | 該当する PFD の criteria または sibling companion の終端ゲート（**ルール文のみ。発見括弧禁止**）。どの companion に書くかは `pfd-ops/references/architecture.md` の「companion への書き分けルール」表に従う |
| 能力成果物の起動条件漏れ | 当該スキルまたは workflow.pfdsl の description に追記。当該スキルが配布 bundle 内（`.claude/skills/pfd-*`）の場合は `.pfdsl/bindings/<当該スキル名>.md` |
| 体感した効果 | 効果ログ（companion で宛先を指定。未定義の場合は記録しない） |
| 監査の新パターン発見 | `.pfdsl/bindings/pfd-retro.md`。問いの構造・パターン種別・具体例をここに書く |

宛先の上書き・追加は pfd-ops の workflow companion に従う。配布物（`.claude/skills/pfd-*` 配下）への finding 反映手続きは `.pfdsl/bindings/pfd-retro.md` に従う。

各 companion の終端ゲートセクションはチェックリストであり発見記録ではない。追加するのはルール文1行のみ。
