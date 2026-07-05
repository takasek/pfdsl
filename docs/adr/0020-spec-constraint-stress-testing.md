# ADR-0020: 仕様制約は具体例トレースで実装前に検証する

- Status: Accepted
- Date: 2026-06-21

## Context

v0.0.8 のマルチファイル意味論（`subflow:` / `extends:`）は、確定済みの提案 （#5 階層PFD・#6 共有プリセット・`multifile-policy.md`）を `docs/spec/spec.md` へ 統合して作られた（PR #136）。提案が決定を、統合が normative なプローズを与えた。

統合直後のプローズは**一見完結しており `check-docs` も通過**したが、散文には 現れない未定義動作を内包していた。具体例（例の `.pfdsl` ペア）を normative な制約に 手トレースしたところ、~16 件の未定義動作が露出した。例:

- `extends` のマージ深度が未定義（`statusStyles.done.fillcolor` のみ上書きしたときプリセット由来の `fontcolor` が残るか消えるか）
- subflow 境界整合が片方向検査で、親の余剰入出力が無検査（清水法の階層整合を破る）
- 境界 artifact の status/label が親子で食い違うときの正本が未定義
- 正規形（§13）が subflow をどう扱うか未定義（normalize が階層を落とす）
- 循環検出が 2 ホップ表現のみで自己参照・多段が「など」依存

さらに深い設計欠落として、**全単射の境界規則は親子の名前・粒度の完全一致を要求し、 独立に命名された子フローを再利用できない**ことが具体例で判明した。粒度差 （親 `order` / 子 `order_header`+`order_lines`）・名前不一致・N:M overlap の各シナリオを 作って初めて、規則の限界が見えた。

これらは**いずれも spec を読むだけでは見えず、具体的な入力をトレースして初めて現れた**。

## Decision

仕様変更を封印・実装する前に、**具体例による stress-test を1ステップとして踏む**。

- 各 normative 制約について、その境界に具体例を構築する: 粒度不一致・名前不一致・N:M・自己参照・多段・diamond・部分マップ等。
- 各例を制約に手トレースして判定（pass / error / **未定義**）まで詰める。
- **未定義**に落ちた例は、spec を明示的な決定で更新して潰す（既定動作を残さない）。
- 検証に用いた例とトレースは ADR 付随資料（サブディレクトリ）として**恒久保存**し、将来の仕様検証のテンプレートとする。

これは PFD 図に対する A/B レビュープロンプト（`docs/review-prompts.md`）の、 **DSL 仕様自身の制約**版に当たる。図は「書くときのルール」と「問い詰める問い」を持つが、 言語仕様も同様に問い詰める具体例を要する。

## Rationale

1. **散文は未定義動作を隠す**: 規則は単体では完結して読めるが、相互作用・境界・既定値が未規定のまま残る。具体的入力が「実際にどう動くか / checker はここで何を返すか」を強制する。

2. **実装前が安い**: spec で潰す未定義動作は1編集。実装後に発覚すれば、実装者ごとに解釈が割れて相互運用が壊れる（snapshot 陳腐化 #108/#116・skill_gen invariant #130 と同型の 「ルールはあるが検出・検証が無い」死角）。

3. **例は仕様のテストスイート**: 散文に対する TDD。例は「規則が答えるべき失敗ケース」であり、規則がその例に判定を返せないなら規則が不完全。

4. **再現可能な独立活動**: 気付き依存でなく、境界カテゴリ（粒度・名前・N:M・循環・diamond・部分マップ）を機械的に列挙して各々を当たれば、同型の穴を1回で束ねて検出できる。

## Consequences

- v0.0.8 の subflow/extends 仕様を未定義動作ゼロまで硬化した（PR #136）:
  - subflow 境界を全単射（双方向・集合一致）、フィードバック除外、メタデータ権威（平坦化時は親優先）、循環の自己/多段一般化、正規形の非展開明記
  - extends マージを属性レベル深マージ、多段/diamond の決定的解決アルゴリズム、プリセットのトップレベルキーをホワイトリスト化
  - 任意の `boundary:` 1:1 リネームマップを追加し子フロー再利用を可能化。粒度差は子フロー内部の分割で扱い、N:M overlap は不可と明文化
- 検証に用いた具体例とトレースを `0020-spec-stress-testing/` に保存した。
- **蒸留済み（2026-07-04）**: 本手法は `docs/review-prompts.md` の **C 系**（仕様・制約の監査観点）と `.claude/skills/spec-stress-test/`（実行手順スキル。agent 実書きプローブを含む）に蒸留した。
- #138（spec/proposals の fenced 例を `check` 検証）と同じ本能の機械化版 — 例は実行可能・検証可能であるべき。本 ADR の例も将来 #138 の検証経路に乗せられる。

## References

- `docs/adr/0020-spec-stress-testing/boundary-validation-log.md` — 具体例トレース全ログ（subflow/extends の穴・境界の粒度/名前/再利用・rename マップ edge ケース）
- `docs/adr/0020-spec-stress-testing/spec-v0011-review.md` — v0.0.11 全体の机上レビュー + CLI 実測（F1–F21。feedback×open input の非対称・V025 二重割当・terminal 三重定義ほか）
- `docs/adr/0020-spec-stress-testing/subflow-agent-probe.md` — 本 ADR の手法の拡張: spec のみを読ませた sonnet subagent に実書き・合否予測をさせ CLI を正解器に採点する「読者実験」。手トレースが規則の穴を、agent プローブが読者の躓きを検出する補完関係を確認
- `docs/adr/0020-spec-stress-testing/extends-agent-oracle-probe.md` — extends（プリセット継承）のオラクル型プローブ（sonnet/haiku モデル勾配、#304）。両モデルとも5/5・全問確信度「高」。副産物として `resolvePresentation` が checker/graph のどちらからも呼ばれず extends 継承スタイルが描画に無反映であることを発見
- PR #136（v0.0.8 統合 + 本検証による硬化・boundary マップ追加）
- `docs/spec/spec.md` §2.3 / §2.9.3 / §2.9.4 / §2.9.5 / §13 / §15.11 / §15.12
- `docs/spec/proposals/{i5-hierarchy,i6-presets,multifile-policy}.md`（統合元の確定提案）
- ADR-0013（v0.0.8 依存順序 — 統合が提案の盲点を露出する非対称）
- #137（status 非単調 lint）・#138（fenced 例の check 検証）— 同型の検出死角
