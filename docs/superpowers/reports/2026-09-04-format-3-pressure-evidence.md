# Format 3 pressure evidence — durable Task 4 verification

## Current status and chronology

This report retains historical pre-transition evidence from the review-fix loop. After the durable evidence migration and the validations recorded below, `reader_first_design_records` was transitioned from `wip` to `done`; earlier `wip` and `done` captures remain chronological evidence only.

## Scope and implementation evidence

The review-fix loop changes only the parser, its template, their tests, this report, and the roadmap artifact. `parsePartialAdoption` is shared by original and premise dispositions at `scripts/lib/gate-check.mjs:831-845`; both call sites require it at `scripts/lib/gate-check.mjs:975-979` and `scripts/lib/gate-check.mjs:1038-1046`.

`parseRevisionRow` trims every captured revision field before acceptance at `scripts/lib/gate-check.mjs:847-860`. The template tells operators that both disposition locations need a non-empty selected part and a reasoned rejected or pending remainder at `scripts/lib/cycle-status.mjs:233`.

The regression matrix covers original selected part, original remainder kind, original remainder reason, premise selected part, premise remainder kind, premise remainder reason, and revision old decision, new decision, reason, and reapproval at `scripts/lib/gate-check.test.mjs:2114-2177`. It also accepts one complete premise partial adoption at `scripts/lib/gate-check.test.mjs:2139-2148`.

## Pressure-sample method and independence

The 15 samples below are persisted here rather than summarized. Each accepted sample was dispatched in its own fresh context with `fork_turns: none`, had read-only scope, and was allowed one operational source: `.claude/skills/pfd-ops/references/work-cycle.md:36-53`.

| Group | Samples | Fresh-context evidence | Read/write boundary |
| --- | --- | --- | --- |
| Single-axis input handling | S1–S5 | `pressure_s1`, `pressure_s2`, `pressure_s3`, `pressure_s4`, `pressure_s5`; five separate `fork_turns: none` dispatches. | Only the named work-cycle reference; no worktree writes. |
| Mixed implementation and waiting axes | M1–M5 | `pressure_m1`, `pressure_m2`, `pressure_m3`, `pressure_m4`, `pressure_m5`; five separate `fork_turns: none` dispatches. | Only the named work-cycle reference; no worktree writes. |
| Partial adoption boundaries | P1–P5 | `pressure_p1`, `pressure_p2`, `pressure_p3_replacement`, `pressure_p4_final`, `pressure_p5_parser_final`; five separate `fork_turns: none` dispatches. | Only the named work-cycle reference; no worktree writes. |

The semantic boundary in every verdict applies the contract's explicit division: structure is machine-blocking, while candidate completeness, decision consistency, and actual independence require human review (`.claude/skills/pfd-ops/references/work-cycle.md:51-53`).

### S1 — ASCII outer-space removal

Prompt/input: Decide whether an input-processing change removes ASCII leading and trailing spaces while preserving non-ASCII whitespace semantics.

Complete record:

```text
設計記録形式: 3
決定:
- 入力空白処理（実装）: ASCII の前後空白だけを除去する
理由:
- 入力空白処理: 既存の Unicode 空白の意味を変えずに利用者の誤入力を減らす
案の処分:
- 採用 — 元候補「前後空白を除去する」— 目的を満たす
- 却下 — 元候補「Unicode 空白も除去する」— 既存データの意味を変える
- 保留 — 元候補「入力エラーにする」— 利用状況を測定後に再検討する
前提検査 P1:
対象: ASCII 前後空白の扱い
前提: Unicode 空白を同じ規則で扱える
前提を外した案: ASCII 空白だけを除去する
既存候補との差分: Unicode 空白を保存する
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=4, dispositions=6, premise P1=10, history=16. Selected/remainder: N/A. Semantic boundary: structural order cannot prove that preserving Unicode whitespace is the right product decision. Human verdict: approved as a bounded, independently reviewable axis; no semantic claim is inferred from parser conformance.

### S2 — raw-input preservation

Prompt/input: Decide whether raw input is preserved while a trimmed value is used only by a downstream validation path.

Complete record:

```text
設計記録形式: 3
決定:
- 入力保存方式（実装）: 原文を保存し検証用の値だけを trim する
理由:
- 入力保存方式: 監査可能性と既存の表示契約を保つ
案の処分:
- 採用 — 元候補「原文を保存する」— 既存表示を保つ
- 却下 — 元候補「保存前に trim する」— 原文の監査性を失う
前提検査 P1:
対象: 検証用の trim
前提: 原文保存と検証値を分けられる
前提を外した案: 保存値をそのまま検証する
既存候補との差分: 検証だけに trim を限定する
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=4, dispositions=6, premise P1=9, history=15. Selected/remainder: N/A. Semantic boundary: the record shape cannot establish that the audit contract truly requires raw preservation. Human verdict: approved pending owner confirmation of that contract; parser PASS alone is insufficient.

### S3 — empty-after-trim rejection

Prompt/input: Decide whether values that become empty after outer trimming are rejected before persistence.

Complete record:

```text
設計記録形式: 3
決定:
- 空値検証（実装）: trim 後に空の入力を拒否する
理由:
- 空値検証: 実質的な空値を保存しない
案の処分:
- 採用 — 元候補「trim 後の空値を拒否する」— 保存の不変条件を守る
- 却下 — 元候補「空文字として保存する」— 後段の区別を失う
前提検査 P1:
対象: 空値の判定時点
前提: trim は保存前に実行できる
前提を外した案: 原文長だけで空値を判定する
既存候補との差分: 空白だけの値も拒否する
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=4, dispositions=6, premise P1=9, history=15. Selected/remainder: N/A. Semantic boundary: syntax cannot determine whether blank-only input should be legal for every field. Human verdict: approved only for fields whose persistence invariant is confirmed by the owner.

### S4 — outer trim without internal normalization

Prompt/input: Decide whether the system strips only outer whitespace and explicitly declines internal-whitespace normalization.

Complete record:

```text
設計記録形式: 3
決定:
- 入力空白処理（実装）: 前後空白だけを除去する
理由:
- 入力空白処理: 内部空白の意味を保持する
案の処分:
- 部分採用 — 元候補「全空白を単一空白へ正規化する」— 採用部分: 前後空白の除去; 残部: 却下 — 内部空白の意味を変更するため
前提検査 P1:
対象: 正規化の範囲
前提: 内部空白に意味がある
前提を外した案: 内部空白も単一空白へ正規化する
既存候補との差分: 外側だけを変更する
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=4, dispositions=6, premise P1=8, history=14. Selected/remainder: selected=`前後空白の除去`; remainder=`却下 — 内部空白の意味を変更するため`. Semantic boundary: the parser preserves both portions but cannot decide whether internal whitespace is semantically meaningful. Human verdict: approved as a genuine partial adoption after boundary review.

### S5 — trim with an audit record

Prompt/input: Decide whether outer trimming is performed and an audit record notes that the normalized path was used.

Complete record:

```text
設計記録形式: 3
決定:
- 正規化監査（実装）: 前後空白を除去した事実を監査記録へ残す
理由:
- 正規化監査: 調査時に入力変換を追跡できる
案の処分:
- 採用 — 元候補「trim と監査記録を行う」— 変換の追跡が必要
- 保留 — 元候補「入力原文も毎回保存する」— 保持期間の方針後に再検討する
前提検査 P1:
対象: 監査記録の粒度
前提: 変換事実だけで調査できる
前提を外した案: 原文全体を監査記録へ保存する
既存候補との差分: 個人データを増やさない
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=4, dispositions=6, premise P1=9, history=15. Selected/remainder: N/A. Semantic boundary: record order cannot establish that the audit data is sufficient or privacy-safe. Human verdict: approved only with retention-owner review; no semantic validity is claimed by structure.

### M1 — validation implementation and dependency update wait

Prompt/input: Decide whether a validation rule is implemented while an existing dependency upgrade remains waiting.

Complete record:

```text
設計記録形式: 3
決定:
- 検証実装（実装）: 入力制約を現在の依存版で実装する
- 既存依存の更新（待機）: 依存更新は互換性結果まで開始しない
理由:
- 検証実装: 現行契約の欠陥を直ちに防ぐ
- 既存依存の更新: 互換性未確認の変更を混ぜない
案の処分:
- 採用 — 元候補「現行依存で検証を実装する」— 独立して提供できる
- 保留 — 元候補「依存更新と同時に行う」— 互換性測定後に再検討する
前提検査 P1:
対象: 依存更新の必要性
前提: 新しい依存版が必要である
前提を外した案: 現行依存で検証だけを実装する
既存候補との差分: 依存更新を待機軸へ分離する
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=5, dispositions=8, premise P1=11, history=17. Selected/remainder: N/A. Semantic boundary: two displayed axes do not prove that their deployment risks are independent. Human verdict: approved as a two-axis record; the waiting condition requires dependency-owner confirmation.

### M2 — input constraint and operations setting wait

Prompt/input: Decide whether an input constraint is implemented while a production operations setting is deferred.

Complete record:

```text
設計記録形式: 3
決定:
- 入力制約の実装（実装）: 禁止値を受付時に拒否する
- 運用設定の変更（待機）: 本番閾値は観測値がそろうまで変えない
理由:
- 入力制約の実装: 不正な状態を入口で防ぐ
- 運用設定の変更: 閾値変更の影響を観測してから決める
案の処分:
- 採用 — 元候補「入口で禁止値を拒否する」— 既存契約を明確にする
- 保留 — 元候補「閾値も同時に下げる」— 観測値が不足している
前提検査 P1:
対象: 閾値変更の必要性
前提: 新制約には低い閾値が必要である
前提を外した案: 閾値を変えずに制約だけを導入する
既存候補との差分: 運用設定を待機軸へ分離する
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=5, dispositions=8, premise P1=11, history=17. Selected/remainder: N/A. Semantic boundary: the structural record cannot decide whether the proposed threshold is safe. Human verdict: approved only as an independently reviewable split between code and operations.

### M3 — cache invalidation and capacity wait

Prompt/input: Decide whether cache invalidation is implemented while a capacity increase remains waiting.

Complete record:

```text
設計記録形式: 3
決定:
- キャッシュ無効化処理（実装）: 更新時に対象キーを無効化する
- キャッシュ容量変更（待機）: 容量は負荷計測まで据え置く
理由:
- キャッシュ無効化処理: 古い結果を返さない
- キャッシュ容量変更: 容量増加の費用対効果が未測定である
案の処分:
- 採用 — 元候補「更新時にキーを無効化する」— 整合性を保つ
- 保留 — 元候補「容量を同時に増やす」— 負荷計測後に再検討する
前提検査 P1:
対象: 容量増加の必要性
前提: 無効化により容量不足になる
前提を外した案: 容量を変えずに無効化だけを実装する
既存候補との差分: 容量変更を待機軸へ分離する
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=5, dispositions=8, premise P1=11, history=17. Selected/remainder: N/A. Semantic boundary: a `待機` token cannot prove capacity is adequate. Human verdict: approved as a clear current/change-later boundary subject to measured capacity review.

### M4 — audit event and retention wait

Prompt/input: Decide whether an audit event is emitted while retention extension remains waiting.

Complete record:

```text
設計記録形式: 3
決定:
- 監査ログ出力（実装）: 重要操作ごとに監査イベントを出力する
- 保存期間の延長（待機）: 期間延長は保持方針の決定まで行わない
理由:
- 監査ログ出力: 操作の追跡を可能にする
- 保存期間の延長: 法務と費用の判断が未確定である
案の処分:
- 採用 — 元候補「監査イベントを出力する」— 追跡可能性が必要
- 保留 — 元候補「保存期間を延長する」— 保持方針後に再検討する
前提検査 P1:
対象: 期間延長の必要性
前提: 既定期間では調査できない
前提を外した案: 既定期間のままイベントを出力する
既存候補との差分: 保存期間を待機軸へ分離する
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=5, dispositions=8, premise P1=11, history=17. Selected/remainder: N/A. Semantic boundary: structural compliance cannot resolve retention legality or cost. Human verdict: approved as an independent implementation with retention expressly reserved for human owners.

### M5 — error classification and retry-count wait

Prompt/input: Decide whether new error classification is added while retry-count changes remain waiting.

Complete record:

```text
設計記録形式: 3
決定:
- エラー分類の追加（実装）: 新しい失敗種別を英語の分類値で出力する
- 再試行回数の変更（待機）: 回数は失敗率の計測後に変更する
理由:
- エラー分類の追加: 利用者が失敗原因を区別できる
- 再試行回数の変更: 既存負荷への影響が未測定である
案の処分:
- 採用 — 元候補「新しい失敗種別を分類する」— 診断可能性を上げる
- 保留 — 元候補「再試行回数も増やす」— 失敗率計測後に再検討する
前提検査 P1:
対象: 再試行増加の必要性
前提: 新分類は追加再試行を必要とする
前提を外した案: 分類だけを追加し回数を保つ
既存候補との差分: 再試行を待機軸へ分離する
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=5, dispositions=8, premise P1=11, history=17. Selected/remainder: N/A. Semantic boundary: the parser cannot validate English wording, retry safety, or the truth of the waiting condition. Human verdict: approved as two independently named decisions with retry policy left to measured review.

### P1 — structural checks with semantic automation withheld

Prompt/input: Decide whether structural checks are implemented while semantic-automation design is held back.

Complete record:

```text
設計記録形式: 3
決定:
- 構造レビュー（実装）: 必須見出しと順序を機械検査する
- 意味検証（待機）: 意味評価の自動化は独立レビュー後に検討する
理由:
- 構造レビュー: 明確な欠落を早く止める
- 意味検証: 偽陽性率と責務境界が未確定である
案の処分:
- 部分採用 — 元候補「設計記録を自動評価する」— 採用部分: 必須構造の検査; 残部: 保留 — 意味自動化の方法と偽陽性率を独立レビュー後に決める
前提検査 P1:
対象: 意味自動化の必要性
前提: 構造検査だけではレビュー負荷を下げられない
前提を外した案: 構造検査だけを実装する
既存候補との差分: 意味判断を人間レビューへ残す
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=5, dispositions=8, premise P1=10, history=16. Selected/remainder: selected=`必須構造の検査`; remainder=`保留 — 意味自動化の方法と偽陽性率を独立レビュー後に決める`. Semantic boundary: a structural checker cannot determine semantic adequacy. Human verdict: approved because the withheld semantic method and measurable false-positive concern remain explicit.

### P2 — new Format 3 records with legacy review withheld

Prompt/input: Decide whether new records use Format 3 while legacy-record semantic rechecks are held back.

Complete record:

```text
設計記録形式: 3
決定:
- 新形式への移行（実装）: 新規公開記録を Format 3 で作成する
- 既存記録の扱い（待機）: 既存記録の意味再検査は担当者確認まで開始しない
理由:
- 新形式への移行: 新しい decision-first 契約を適用する
- 既存記録の扱い: 移行互換と所有者確認が必要である
案の処分:
- 部分採用 — 元候補「全記録を Format 3 に移す」— 採用部分: 新規記録を Format 3 にする; 残部: 保留 — 既存記録の意味再検査と所有者確認後に決める
前提検査 P1:
対象: 既存記録の再作成
前提: 旧記録を書き換えないと新形式を導入できない
前提を外した案: 新規記録だけを Format 3 にする
既存候補との差分: 旧形式を時点互換で読む
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=5, dispositions=8, premise P1=10, history=16. Selected/remainder: selected=`新規記録を Format 3 にする`; remainder=`保留 — 既存記録の意味再検査と所有者確認後に決める`. Semantic boundary: format selection cannot establish historical-record correctness. Human verdict: approved only for forward use, with legacy semantics reserved for owners.

### P3 — new CLI error classification with existing-warning impact withheld

Prompt/input: Decide whether a new CLI error class uses English wording while the impact on existing warnings remains pending.

Complete record:

```text
設計記録形式: 3
決定:
- エラー出力（実装）: 新しい分類を英語の診断として出力する
- 既存出力文言（待機）: 既存 warning の変更は利用者影響を調べてから決める
理由:
- エラー出力: 新しい失敗を識別可能にする
- 既存出力文言: 文言変更の互換性が未確認である
案の処分:
- 部分採用 — 元候補「すべての診断文言を改訂する」— 採用部分: 新しいエラー分類を英語で出力する; 残部: 保留 — 既存 warning への影響分析後に決める
前提検査 P1:
対象: 既存 warning の改訂
前提: 新分類には既存文言の変更が必要である
前提を外した案: 新しい分類だけを追加する
既存候補との差分: 既存文言を変更しない
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=5, dispositions=8, premise P1=10, history=16. Selected/remainder: selected=`新しいエラー分類を英語で出力する`; remainder=`保留 — 既存 warning への影響分析後に決める`. Semantic boundary: an English-format record cannot prove wording compatibility. Human verdict: approved with existing warning behavior deliberately outside the current decision.

### P4 — canonical-source change with delivery inspection withheld

Prompt/input: Decide whether the canonical source changes while generated-result and delivery-path inspection remains pending.

Complete record:

```text
設計記録形式: 3
決定:
- 正規ソース（実装）: canonical source の契約を更新する
- 配布ミラー（待機）: 配布物の内容検査は生成後に行う
理由:
- 正規ソース: 一つの一次契約を維持する
- 配布ミラー: 生成結果と配布経路を独立に確認する必要がある
案の処分:
- 部分採用 — 元候補「source と mirror を同時に変更する」— 採用部分: canonical source の変更; 残部: 保留 — generated result と delivery path の検査後に決める
前提検査 P1:
対象: mirror の同時変更
前提: source 更新だけでは配布契約を満たせない
前提を外した案: source を更新して生成検査を別工程にする
既存候補との差分: mirror 検査を独立境界に置く
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=5, dispositions=8, premise P1=10, history=16. Selected/remainder: selected=`canonical source の変更`; remainder=`保留 — generated result と delivery path の検査後に決める`. Semantic boundary: a source-level structural PASS cannot establish mirror or bundle identity. Human verdict: approved only when independent generated-output inspection is performed.

### P5 — self structural review with independent review environment withheld

Prompt/input: Decide whether self structural-diff review is implemented while a runnable independent-review environment remains pending.

Complete record:

```text
設計記録形式: 3
決定:
- 構造レビュー（実装）: 自己差分に構造検査を適用する
- 独立レビュー（待機）: 実行可能な独立環境での確認は準備後に行う
理由:
- 構造レビュー: 明確な欠落を早期に見つける
- 独立レビュー: 同一環境の自己確認だけでは偏りを除けない
案の処分:
- 部分採用 — 元候補「自動レビューだけで受け入れる」— 採用部分: self structural-diff review; 残部: 保留 — runnable independent-review environment の準備後に決める
前提検査 P1:
対象: 独立レビューの必要性
前提: 構造検査だけで受け入れられる
前提を外した案: 構造検査と独立レビューを分ける
既存候補との差分: 人間の意味レビューを保持する
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Section-order indices: marker=1, decision=2, rationale=5, dispositions=8, premise P1=10, history=16. Selected/remainder: selected=`self structural-diff review`; remainder=`保留 — runnable independent-review environment の準備後に決める`. Semantic boundary: self structural validation cannot replace independent semantic review. Human verdict: approved because the independent environment remains an explicit prerequisite, not an implied PASS.

## Human semantic review

The review examined the contract at `.claude/skills/pfd-ops/references/work-cycle.md:36-53`, the parser at `scripts/lib/gate-check.mjs:827-1062`, the template at `scripts/lib/cycle-status.mjs:209-235`, and the complete fixture plus malformed vectors at `scripts/lib/gate-check.test.mjs:1961-2201`.

| Dimension | Human verdict and evidence |
| --- | --- |
| Candidate coverage | The template requires every issue-derived candidate to be named, but expressly assigns completeness to human review (`scripts/lib/cycle-status.mjs:233`). No structural test is presented as proof of coverage. |
| Decision/disposition consistency | Every sample names its decided axes before its dispositions. Human review accepts only the stated relationship; it does not infer that matching labels alone establish a correct decision. |
| Partial-adoption clarity | Shared parsing rejects empty selected parts, remainder kinds, and remainder reasons at both original and premise call sites (`scripts/lib/gate-check.mjs:831-845`, `:975-979`, `:1038-1046`). Samples S4 and P1–P5 preserve both text portions. |
| Executable reconsideration | Each retained `保留` condition names a measurable or owner-confirmation event. The owner-dependent events remain unresolved rather than being marked as completed. |
| Valid rejection reasons | The human review distinguishes contract, compatibility, and ownership reasons from effort, size, or scope assertions. Structural acceptance is not approval of a rejection rationale. |
| Premise scope | Each P1 identifies the premise-bearing target. Review classifies the factual truth of that premise as owner-dependent where it concerns deployment, retention, compatibility, or operational authority. |
| Same-granularity alternatives | Each P1 alternative changes the same decision boundary rather than merely restating current state. The reviewer retains human judgment for whether the alternative is actually competitive. |
| Revision truthfulness | Every captured revision field must be nonempty after trimming (`scripts/lib/gate-check.mjs:847-860`), but whether a revision history is truthful remains human-reviewed. |
| Independence | M1–M5 separate currently implemented and waiting axes; P1–P5 state exactly what remains outside the selected portion. The reviewer found the boundaries explicit but does not infer real operational independence merely from two axes. |
| Machine/human boundary | The canonical contract states that structural PASS does not guarantee design validity and lists the human checks (`.claude/skills/pfd-ops/references/work-cycle.md:51-53`). Every sample verdict applies that boundary. |

Result: the parser/template has no unresolved structural defect. The nine dimensions above are human-reviewed; owner-dependent conditions are explicitly unresolved and are not presented as structural semantic proof. The historical exact gate below does not replace the current completion gate.

## Current verification evidence

RED command, run before the parser/template implementation:

```text
node --test scripts/lib/gate-check.test.mjs scripts/lib/cycle-status.test.mjs
```

RED result:

```text
tests 302
suites 56
pass 295
fail 7
```

The seven intended failures covered whitespace-only original selected part, premise selected part, premise remainder kind, premise remainder reason, revision new decision, revision reason, and revision reapproval. The pre-fix template test also failed because it did not name `検査案の処分 Pn` before `部分採用`.

GREEN command, after the minimal implementation and complete matrix:

```text
node --test scripts/lib/gate-check.test.mjs scripts/lib/cycle-status.test.mjs
```

GREEN result:

```text
tests 304
suites 56
pass 304
fail 0
cancelled 0
skipped 0
todo 0
```

## Repository-wide tests

```text
pnpm -r test
Scope: 6 of 7 workspace projects
packages/core: Test Files 24 passed (24); Tests 618 passed (618)
packages/metadata-exporter: Test Files 1 passed (1); Tests 9 passed (9)
packages/graphviz-exporter: Test Files 3 passed (3); Tests 173 passed (173)
packages/preview-engine: Test Files 1 passed (1); Tests 25 passed (25)
packages/cli: Test Files 5 passed (5); Tests 465 passed; 1 skipped (466)
packages/vscode-extension: Test Files 17 passed (17); Tests 215 passed (215)
exit 0
```

Tracked-delivery check:

```text
git check-ignore -v docs/superpowers/reports/2026-09-04-format-3-pressure-evidence.md; test $? -eq 1
exit 0 with no output; the durable report is not ignored
```

The P5 accepted record's matching-axis, partial-adoption, premise-field, section-order, and history structure was independently parsed with `parseFormat3DesignRecord`; the result was `{"status":"PASS","axes":["自己構造レビュー","独立レビュー環境"],"allNoImplementation":false}`.

## Exact issue gate and status transition

The required parent-owned command for the review-fix loop was:

```text
node scripts/gate-check.mjs --base main --artifact reader_first_design_records --issue 1076
```

The parent reran the command with the required authority and it exited 0. The following is the complete verbatim capture from `/tmp/format3-task4-authoritative-gate-c98c.txt` before the status transition.

```text
gate-check: running in linked worktree (/Users/m5/.codex/worktrees/c98c/pfdsl), branch codex/issue-1076-format3-execution
gate-check:
  ✓ PASS pfdsl check — 1 file(s)
  ✓ PASS audit-issues-flow
  ✓ PASS check-md-linebreaks
  ✓ PASS check-docs
  ✓ PASS gen-plugin identity
  ✓ PASS snapshot freshness
  ✓ PASS output artifact status update
  - SKIP vscode-extension typecheck — no vscode-extension changes
  ✓ PASS commit subject lint — 19 commit(s)
  ✓ PASS Review record — 2 record(s)
  ✓ PASS wip transition — wip found for 'reader_first_design_records'
  ✓ PASS design-selection record (#1076) — the commit side is a git author date the runner can set — evidence, not proof
  - SKIP knowledge-artifact size direction (#1076) — linked issue declares no Size-Intent: shrink

Ready-set diff (origin/main → HEAD):
  newly ready: (none)
  no longer ready: (none)

Cycle window (base commits this tree lacked, or that landed after its first commit):
  af695e99 Merge pull request #1080 from takasek/codex/issue-1073-token-fallback-docs
  b3ec658c Merge pull request #1087 from takasek/docs/equivalence-fixture-scope
  70d2cdad Merge pull request #1084 from takasek/codex/retro-1079-payoff-claim
  b9a7521e docs(retro): say which set the equivalence sweep enumerates
  0843cb08 docs: narrow PFD payoff counterfactual
  b5422c06 docs(pfd-ops): document token-only GitHub fallback
  d2364e86 Merge pull request #1079 from takasek/codex/retro-1066-pr-diagram-contract
  12b24bff Merge pull request #1071 from takasek/refactor/github-named-operations
  582eb332 docs: record PFD-enforced workflow sync
  8d9c31dc docs(pfd): make diagram delivery criteria complete
  e901c69a fix(github-ops): align open PR list limits
  861e1a7b Merge pull request #1077 from takasek/codex/issue-1066-diff-image-fallback
  1ee50cf8 docs(pfd): describe partial diagram delivery
  f988e5f4 fix(ci): tolerate unrenderable base diagrams

Changed files vs. the adopted PFDs' `location:` fields:
  modeled (confirm the PFD reflects the change):
    .agents/skills/pfd-ops/references/file-based-tracker-backend.md ← .pfdsl/pipeline.pfdsl:codex_repo_assets, .pfdsl/pipeline.pfdsl:verified_codex_repo_assets
    .agents/skills/pfd-ops/references/github-issues-backend.md ← .pfdsl/pipeline.pfdsl:codex_repo_assets, .pfdsl/pipeline.pfdsl:verified_codex_repo_assets
    .agents/skills/pfd-ops/references/work-cycle.md ← .pfdsl/pipeline.pfdsl:codex_repo_assets, .pfdsl/pipeline.pfdsl:verified_codex_repo_assets, .pfdsl/roadmap.pfdsl:reader_first_design_records
    .claude/skills/pfd-ops/references/file-based-tracker-backend.md ← .pfdsl/pipeline.pfdsl:claude_harness_sources, .pfdsl/workflow.pfdsl:ops_skill_general
    .claude/skills/pfd-ops/references/github-issues-backend.md ← .pfdsl/pipeline.pfdsl:claude_harness_sources, .pfdsl/workflow.pfdsl:ops_skill_general, .pfdsl/workflow.pfdsl:ops_skill_l3
    .claude/skills/pfd-ops/references/work-cycle.md ← .pfdsl/pipeline.pfdsl:claude_harness_sources, .pfdsl/roadmap.pfdsl:reader_first_design_records, .pfdsl/workflow.pfdsl:ops_skill_general
    .pfdsl/roadmap.pfdsl ← .pfdsl/pipeline.pfdsl:roadmap_pfdsl, .pfdsl/workflow.pfdsl:roadmap_pfdsl
    plugin/pfdsl-codex/skills/pfd-ops/references/file-based-tracker-backend.md ← .pfdsl/pipeline.pfdsl:codex_adapter_output, .pfdsl/pipeline.pfdsl:codex_plugin_dist, .pfdsl/workflow.pfdsl:codex_plugin_dist
    plugin/pfdsl-codex/skills/pfd-ops/references/github-issues-backend.md ← .pfdsl/pipeline.pfdsl:codex_adapter_output, .pfdsl/pipeline.pfdsl:codex_plugin_dist, .pfdsl/workflow.pfdsl:codex_plugin_dist
    plugin/pfdsl-codex/skills/pfd-ops/references/work-cycle.md ← .pfdsl/pipeline.pfdsl:codex_adapter_output, .pfdsl/pipeline.pfdsl:codex_plugin_dist, .pfdsl/roadmap.pfdsl:reader_first_design_records, .pfdsl/workflow.pfdsl:codex_plugin_dist
    plugin/pfdsl/.claude-plugin/bundle-manifest.json ← .pfdsl/pipeline.pfdsl:claude_plugin_dist, .pfdsl/roadmap.pfdsl:reader_first_design_records, .pfdsl/workflow.pfdsl:claude_plugin_dist
    plugin/pfdsl/skills/pfd-ops/references/file-based-tracker-backend.md ← .pfdsl/pipeline.pfdsl:claude_adapter_output, .pfdsl/pipeline.pfdsl:claude_plugin_dist, .pfdsl/workflow.pfdsl:claude_plugin_dist
    plugin/pfdsl/skills/pfd-ops/references/github-issues-backend.md ← .pfdsl/pipeline.pfdsl:claude_adapter_output, .pfdsl/pipeline.pfdsl:claude_plugin_dist, .pfdsl/workflow.pfdsl:claude_plugin_dist
    plugin/pfdsl/skills/pfd-ops/references/work-cycle.md ← .pfdsl/pipeline.pfdsl:claude_adapter_output, .pfdsl/pipeline.pfdsl:claude_plugin_dist, .pfdsl/roadmap.pfdsl:reader_first_design_records, .pfdsl/workflow.pfdsl:claude_plugin_dist
    scripts/lib/cycle-status.mjs ← .pfdsl/roadmap.pfdsl:reader_first_design_records
    scripts/lib/gate-check.mjs ← .pfdsl/roadmap.pfdsl:reader_first_design_records
  not modeled by any adopted PFD (an N/A here is out-of-scope, not a judgment):
    docs/superpowers/plans/2026-09-04-format-3-design-records.md
    docs/superpowers/specs/2026-08-30-reader-first-design-records-design.md
    scripts/lib/cycle-status-steps.test.mjs
    scripts/lib/cycle-status.test.mjs
    scripts/lib/gate-check-steps.mjs
    scripts/lib/gate-check-steps.test.mjs
    scripts/lib/gate-check.test.mjs
    scripts/lib/pfd-ops-applicability.test.mjs

MANUAL (judge and confirm each):
  MANUAL: companion（roadmap.md 等）が定義するリポ固有の追加ゲート項目を確認した（**タイミング規約があれば以降の項目より優先**）
  MANUAL: 知見を `.pfdsl/workflow.pfdsl` の sibling companion の振り分け手続きに従って振り分けた
  MANUAL: 実行中に発見した新プロセス・成果物を `.pfdsl/roadmap.pfdsl` に追記した（消費者を明示できないものは作らない）
  MANUAL: 変更した `.pfdsl` に対して `pfdsl graph io <file> --json` を実行し、`terminals`（消費者が疑わしい終端）と `externalTerminals`（`externalStakeholders` 宣言による終端 — 別枠に入る条件と見方は pfdsl スキルの「読解と点検」が一次情報）の両方を確認した。片方だけ見ると監査対象が丸ごと落ちる。今サイクルの出力 artifact が `terminals` に現れ、かつ手段（仕様・設計・計画・提案）なら、それを消費する後続プロセスがグラフに在るか確認した。無ければ todo プレースホルダで登録した（後続門番、プロトコル5(b)。真の納品物のみ終端を許す）。`externalTerminals` に現れる場合は、その宣言が妥当か（手段成果物に誤って `externalStakeholders` を付けていないか）を確認した。companion がゲート集約チェッカーを指す場合はその差分報告を使ってよい
  MANUAL: 変換コンポーネントを追加・変更・削除した場合、または成果物の格納先・生成方式・配送経路を変えた場合、それをモデル化している採用済み PFD（`.pfdsl/pipeline.pfdsl` または `.pfdsl/workflow.pfdsl` の該当箇所）へ同一 PR で反映した（該当なしもここでの確認に含める。pipeline.pfdsl 未採用は自動的に N/A にならない — workflow.pfdsl 側を確認）。**「どの PFD もモデル化していない領域を触った」という N/A と、「見て判断した結果の」N/A は、どちらも同じ「該当なし」として記録されるため、記録からは区別できない** — 変更したパスが採用済み PFD の `location:` に載っているかを先に見て、どちらの N/A かを言えるようにする。
  MANUAL: **記録先: ユーザーへの報告**: 作業中に偶発的に見つけたスコープ外の既存問題（バグ等）を、発見した時点でユーザーへ報告した（ユーザーの指摘を待たない、が指すのは発見の報告を遅らせないことであり、新しい作業項目を外部サービスへ公開する同意を省略してよい意味ではない。公開書き込みは実行環境の権限モデルによって拒否される、または確認なしに確定してしまう — いずれの場合も報告と別に、公開の可否はユーザーに諾否を仰いでから実行する）
  MANUAL: 適用点1の設計選択記録が着手前に確定され、バックエンドの移行契約が選択する形式を完全に満たす。`2026-08-31T01:30:24Z` 以降の新規記録は完全な Format 3 とし、`決定:`、`理由:`、`案の処分:`、前提検査、`改訂履歴:` を順に持つ。既存の有効な旧形式記録を書き換えないが、人間による意味的な再検査で issue が列挙した元候補の処分、採用案と競合する別クラスの実装案、却下した前提を外した案と競合実装案の理由規律を確認する。「何もしない」「現状維持」に帰着する前提否定案しか無い場合、または無効な理由で前提を外した案か競合実装案を除外している場合は、適用点1から設計検討をやり直した
  MANUAL: 症状の指標を変更前後で測った（測れない場合は測れない理由と代理指標を持つ）。作業項目が縮小を目的に掲げている場合、対象が増えていれば方向が逆である。数値の書き込み先は下の「PR 作成後」の項目
  MANUAL: コミット粒度（論理単位ごとの分割）が規約（CLAUDE.md または companion で定義）に従っている。**生成元と生成物は同一コミットに入れる** — 作業ツリー全体から再生成して staged 分と突き合わせる型の drift 検査を持つリポでは、両者を別コミットに割ると生成元だけを staged にした時点で不一致になり弾かれる。論理単位が2つ以上あってもこの境界では割れない — 割れない理由の書き込み先は下の「PR 作成後」の項目
  MANUAL: **記録先: PR 本文**: コミット前にレビューを1パス通した（レビューコマンド・チェックリスト等の具体的な手段は companion で定義。定まっていなければ最低限、差分を自分で読み直す。省略する場合はその理由を PR 本文に書く）。**レビューの重さは diff の規模に合わせる** — 数十行・1〜2ファイル中心の scoped な修正に多角度 finder × 候補ごと検証 agent のような高効度設定をかけると diff に対して過剰になる。角度を絞るか、そもそも委譲せず自分で読む。重量級の構成は大規模 diff 向け。
  MANUAL: レビューの menu を「どの手段を選ぶか」の優先順ではなく「どの観点が担保されたか」で組んだ。手段を1つに固定すると、その手段が探さない型の欠陥だけが常に無担当になる — 簡素化のみを見るレビューが findings なしを返した回に、別観点のレビューが採用案の成立根拠の不備と JSDoc の事実誤認を検出した実測がある。観点ごとにブリーフ要件を課し、その観点をどの手段で満たすかは companion が定める
  MANUAL: finding には具体的な failure scenario（入力・状態 → 誤出力・誤誘導）を伴わせ、構成できない指摘は報告しない。敵対的な指示は「何か見つけねば」という圧で false positive を量産するため、scenario を構成できることを報告の条件にする
  MANUAL: **記録先: PR 本文**: 発火した観点を軽くしてよいが、消してはならない。 観点の発火条件（何を担保するか）と、その観点にかける重さ（別主体へ委譲するか自分で読むか）は別軸である。規約が両方を1つの文で決めていると、重さを落とす判断が観点そのものを消す判断に化ける — 「小さい回は軽くてよい」と「この条件を満たす回は対象」が同時に成立する回に優先関係が書かれていないと、実行主体は軽いほうへ畳んで観点を1つも回さずに終わり、その事実はどこにも残らない。重さを落とした回は、落とした観点の名前と落とした理由を成果物（PR 本文等）へ書く — 名前を書かせない限り、軽く回した回と一度も回さなかった回は記録から区別できない
  MANUAL: 監査パターンのカタログが「対策は成果物を書く前に効く」と宣言しているものを、PR 本文を書く前に読み直した（宣言の書式と、それを列挙する手段は companion が定める。プリフライトの集約スクリプトを持つリポではその出力に並ぶ）— retro でカタログを引くのはこの後になるため、成果物を書く前にしか効かない対策はここでしか間に合わない。カタログがこの宣言を持たないリポでは該当なし
  MANUAL: 変更束を PR にまとめた（PR 作成後にローカルで追加コミットした場合、push し忘れていないか `git log origin/<branch>..<branch>` で確認する — CI は push 済みの内容にしか反応しない）
  MANUAL: バックエンドの L3 が完了契約を定義する場合、その契約と終端ゲート証拠を満たした

MANUAL, after the PR exists (its body is the destination):
  MANUAL: **PR 作成後**: 上で測った症状の指標の数値を PR 本文に書いた（測れなかった場合はその理由と代理指標を書いた）
  MANUAL: **PR 作成後**: 生成元と生成物を同一コミットに入れたために論理単位が割れなかった場合、割れない理由を PR 本文に書いた
  MANUAL: **PR 作成後**: サイクルの途中で前提が変わった箇所を、PR 本文（最初に読まれる正本）にも書き戻した。訂正を別の記録媒体へ書いた回は、その場で正本の該当箇所も直す — 正本だけを読む人は訂正の存在を知る手がかりを持たないため、両方を読んだ者にしか食い違いが見えない。サイクルの終わりにまとめて見直す形にしない（その時点では、どの文がいつ書かれたかがもう分からない）。**この項目だけは実施の時点がここではない** — 実施は訂正を書いた各時点であり、ここで確認するのはその実施の有無である。ここへ来て初めて全訂正を見直す運用にすると、項目文自身が禁じている形になる
```

## Commands and pre-transition outputs

```text
node --test scripts/lib/gate-check.test.mjs scripts/lib/gate-check-steps.test.mjs scripts/lib/cycle-status.test.mjs scripts/lib/cycle-status-steps.test.mjs scripts/lib/pfd-ops-applicability.test.mjs
tests 469
suites 81
pass 469
fail 0
cancelled 0
skipped 0
todo 0

make check-docs
exit 0
check-docs: all passed
check-doc-examples: OK
check-criteria-judgeability: all passed
check-diag-registry: OK (58 codes match)
check-forward-ref-markers: no resolved forward-ref markers found
79 pattern file(s), no violations.
check-spec-ids: no violations found
check-companion-bindings: all passed
check-distributed-prose: OK (48 file(s))
check-entry-path-headings: OK (327 file(s))
check-skill-wiring: OK

node scripts/check-generated-drift.mjs -- generated plugin .claude-plugin/marketplace.json AGENTS.md .agents .codex
exit 0 with no output

node scripts/check-generated-drift.mjs -- .claude/skills/pfd-ops/install
exit 0 with no output

node --input-type=module -e '<bundle hash check>'
{"declared":"6414b6a3615fba0c39a8902e68894ecc353d577c44c8347251afb26979732994","actual":"6414b6a3615fba0c39a8902e68894ecc353d577c44c8347251afb26979732994","match":true}

node scripts/check-md-linebreaks.mjs .superpowers/sdd/2026-09-04-format-3-design-records/task-4-report.md
check-md-linebreaks: OK

node packages/cli/dist/cli.js check .pfdsl/roadmap.pfdsl --strict
OK

node packages/cli/dist/cli.js fmt .pfdsl/roadmap.pfdsl --check
exit 0 with no output

node packages/cli/dist/cli.js meta check-links .pfdsl/roadmap.pfdsl
All location paths exist.

node packages/cli/dist/cli.js graph orphans .pfdsl/roadmap.pfdsl
(none)

node packages/cli/dist/cli.js graph io .pfdsl/roadmap.pfdsl --json
{"ok":true,"externalInputs":["spec_v006","findings_r12","toolchain","skill_gen","adrs"],"terminals":["audit_distribution","restructured_gen","pfd_ops_skill_ready","boundary_feedback","recode","published_extension","article","obsidian_plugin","spec_id_refs","spec_id_tombstones","cli_release_tolerance_query","ext_editing_release","cli_release_frontmatter_cst","cli_release_pipeline_kind"],"externalTerminals":[]}

node packages/cli/dist/cli.js graph describe .pfdsl/roadmap.pfdsl reader_first_design_records
reader_first_design_records.status: wip
predecessors (process): i1076_make_design_records_reader_first
successors (process): publish_cli_pipeline_kind
```

## Post-transition PFD and snapshot validation

```text
node packages/cli/dist/cli.js meta set .pfdsl/roadmap.pfdsl reader_first_design_records status done
newly ready: publish_cli_pipeline_kind

node packages/cli/dist/cli.js check .pfdsl/roadmap.pfdsl --strict
OK

node packages/cli/dist/cli.js fmt .pfdsl/roadmap.pfdsl --check
exit 0 with no output

node packages/cli/dist/cli.js meta check-links .pfdsl/roadmap.pfdsl
All location paths exist.

node packages/cli/dist/cli.js graph orphans .pfdsl/roadmap.pfdsl
(none)

node packages/cli/dist/cli.js graph io .pfdsl/roadmap.pfdsl --json
{"ok":true,"externalInputs":["spec_v006","findings_r12","toolchain","skill_gen","adrs"],"terminals":["audit_distribution","restructured_gen","pfd_ops_skill_ready","boundary_feedback","recode","published_extension","article","obsidian_plugin","spec_id_refs","spec_id_tombstones","cli_release_tolerance_query","ext_editing_release","cli_release_frontmatter_cst","cli_release_pipeline_kind"],"externalTerminals":[]}

node packages/cli/dist/cli.js graph describe .pfdsl/roadmap.pfdsl reader_first_design_records
reader_first_design_records.status: done
predecessors (process): i1076_make_design_records_reader_first
successors (process): publish_cli_pipeline_kind

pnpm --filter @pfdsl/core exec vitest run
Test Files  24 passed (24)
Tests  618 passed (618)
```
