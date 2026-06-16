---
name: pfd-retro
description: |
  Use after a sustained stretch of design dialogue or work sessions, when the
  user asks for a retrospective, before consolidating ADRs — or when deeply
  reviewing ANY .pfdsl diagram (layers A/B are session-independent review
  prompts). Audits the PFDs, the session's events, and the knowledge
  artifacts for the failure modes that practice has actually produced, then
  routes findings into ops improvements. Complements pfd-ops (which runs the
  cycle; this skill improves it).
---

# PFD retrospective audit

ユーザーの気付きに依存していた監査を再現可能にする。対象3層: 図（PFD）、セッションで実際に起きたこと、知識成果物。各問いには実例があり、すべて実際に検出された誤りに由来する。

A・B 層はセッション文脈不要 — 任意の PFD のレビューに単体で適用できる（品質ガイドが「書くときのルール」、A・B は「問い詰めるときのプロンプト」）。C・D 層はふりかえり固有。

## A・B. 図の監査（任意の PFD レビューに適用可）

カタログ本文は `docs/review-prompts.md`（一次情報）を読むこと。A = 図 vs 現実（エッジ実在性・駆動源・名前の一般化水準・偽の不変性・入力充足）、B = 粒度・型（万能成果物・プロセス実在性・並列主張・修正案への再挑戦・型違い）。

## C. 運用イベント監査

- **忘れ物 = 構造の欠落**: セッション中に実際に忘れた作業（例: issue クローズ、gen-samples、README 更新）は、図に無いエッジ・ゲートに無い項目として読み、両方に反映する。個別「更新したか」より「edge が無い」を機械的に探す方が安い — 同型の複数件を1回の監査で束ねて検出できる（例: #72/#15/#17 の impl_flow 欠落3件を1回で発見）
- **委譲の失敗様式**: subagent の誤り（ID 捏造等）はプロセスの入力不足の発見として扱う
- **暗黙の設計判断**: 作業中に下したが記録されていない選択はないか（例: グルーピング基準は問われるまで暗黙だった → ADR-0008）

## D. 知識成果物のライフサイクル

- **スケール監査**: 増え続ける成果物の消費方法は全読を要求していないか（例: ADR は読まずガイド1行に蒸留 — ADR-0006 の分業）
- **同期在庫**: 知見の複数経路（ガイド蒸留・ADR・issue）で、片方にだけ届いて滞留している在庫はないか（実例: ADR-0008/0011 のガイド未蒸留、lint 候補の issue 未同期 — どちらも監査質問で検出された）
- **列挙ドリフト**: 同じリストが2箇所に存在しないか。一次情報を1つに定め、他はポインタにする
- **改訂規約**: 増え続ける成果物に改訂・廃止の規約があるか（例: docs/adr/README.md の改訂規約）
- **休眠能力**: 能力成果物（スキル・ツール）に運用側の起動条件（いつ・誰が・何を契機に呼ぶか）が定義されているか。道具を作っただけでは気付き依存は解消されない（例: pfd-retro 自体が起動条件なしで作られ、pfd-ops プロトコル8で解消）

## 出力

検出した findings を pfd-ops の3経路（品質ガイド改訂 / ADR / issue + 依存チェーン追加）に振り分け、ゲート・プロトコル自体の改善があれば pfd-ops に反映する。効果を体感した局面は payoff_log へ。監査自体の新しい型を発見したら本スキルに追記する — このスキルも能力成果物であり、前世代の知見でできている（ADR-0011）。
