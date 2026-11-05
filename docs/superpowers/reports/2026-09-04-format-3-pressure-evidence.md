# Format 3 pressure evidence — durable Task 4 verification

## Replacement evidence acceptance contract

This report contains the authoritative fifteen-context shape-coverage corpus and the verification evidence used before `reader_first_design_records` transitioned from `wip` to `done`.

These 15 independent samples verify representative Format 3 expression shapes and do not constitute a before/after comparison.
The controlled same-prompt ordering comparison is recorded separately in `docs/superpowers/reports/2026-09-05-format-3-controlled-comparison.md`.
That comparison is retrospective remediation assembled after this artifact transitioned to `done`; it was not evidence for the earlier transition or the resulting downstream readiness.

The source-declaration acceptance rule permits a semantically equivalent declaration when it unambiguously limits inputs to the canonical work-cycle and supplied prompt and confirms no writes. It does not relax any other evidence requirement.

## Rebuilt accepted corpus

### S1 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_s1_retry5`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record for the scenario below, without a code fence or commentary.

Scenario class: a bounded single-axis change with exactly one current implementation decision and no other current decision. Closed original candidates: A = "trim ASCII outer whitespace"; B = "trim all Unicode whitespace"; C = "reject every input containing whitespace". The input-policy owner requires ASCII outer-whitespace cleanup. The compatibility owner requires Unicode whitespace preservation. The exact shared premise is 「本案は〈入力値が検証前に正規化される状態が存在し続けること〉を前提にする」. The P1 alternative is validating raw input without normalization; it is outside the current decision and remains pending until the validation owner approves the raw-validation contract. There is no revision history.
```

Full response:

```text
設計記録形式: 3
決定:
- 入力正規化（実装）: ASCII の外側空白だけを除去し、Unicode 空白はそのまま保持する。
理由:
- 入力正規化: 入力ポリシー所有者が要求する ASCII 外側空白の除去と、互換性所有者が要求する Unicode 空白の保持を両立する。
案の処分:
- 採用 — 元候補「trim ASCII outer whitespace」— 入力ポリシー所有者の要求を満たし、Unicode 空白を保持する。
- 却下 — 元候補「trim all Unicode whitespace」— 互換性所有者が要求する Unicode 空白の保持に反する。
- 却下 — 元候補「reject every input containing whitespace」— 入力ポリシー所有者が要求する ASCII 外側空白の除去ではなく拒否となる。
前提検査 P1:
- 対象: 入力正規化。
- 前提: 本案は〈入力値が検証前に正規化される状態が存在し続けること〉を前提にする。
- 前提を外した案: 正規化せず、生の入力値を検証する。
- 既存候補との差分: 元候補 A、B、C はいずれも検証前に入力値を正規化する前提に立つのに対し、この案は正規化を行わずに検証する。
- 検査案の処分 P1: 保留 — 検証所有者が生入力検証契約を承認するまで保留する。
改訂履歴:
- なし
```

Independent parser result: PASS. One-based section starts: `1, 11, 67, 142, 388, 595`.

### S2 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_s2`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record for the scenario below, without a code fence or commentary.

Scenario class: a bounded single-axis change with exactly one current implementation decision and no other current decision. Closed original candidates: A = "preserve raw input and validate a normalized derivative"; B = "persist normalized input"; C = "validate raw input without normalization". The audit owner requires preservation of raw input. The validation owner requires validation of normalized data. The exact shared premise is 「本案は〈入力値が検証経路へ渡される状態が存在し続けること〉を前提にする」. The P1 alternative removes automated validation and uses manual input review; it is outside the current decision and remains pending until the review owner approves the manual-review contract. There is no revision history.
```

Full response:

```text
設計記録形式: 3

決定:
- 入力保持と検証（実装）: 生入力を保持し、正規化した派生値を自動検証する。

理由:
- 入力保持と検証: 監査所有者が求める生入力の保持と、検証所有者が求める正規化データの検証を両立する。

案の処分:
- 採用 — 元候補「preserve raw input and validate a normalized derivative」— 生入力の保持と正規化データの自動検証を両立する。
- 却下 — 元候補「persist normalized input」— 監査所有者が求める生入力の保持を満たさない。
- 却下 — 元候補「validate raw input without normalization」— 検証所有者が求める正規化データの検証を満たさない。

前提検査 P1:
- 対象: 入力保持と検証。
- 前提: 本案は〈入力値が検証経路へ渡される状態が存在し続けること〉を前提にする。
- 前提を外した案: 自動検証を廃止し、手動入力レビューで確認する。
- 既存候補との差分: 元候補A、B、Cはいずれも入力値を自動検証経路で扱うのに対し、この案は自動検証経路を持たない。
- 検査案の処分 P1: 保留 — レビュー所有者が手動レビュー契約を承認するまで実施しない。

改訂履歴:
- なし
```

Independent parser result: PASS. One-based section starts: `1, 12, 57, 115, 357, 568`.

### S3 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_s3`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record for the scenario below, without a code fence or commentary.

Scenario class: a bounded single-axis change with exactly one current implementation decision and no other current decision. Closed original candidates: A = "emit an error code and preserve a support message"; B = "emit an error code only"; C = "preserve a support message only". The diagnostics owner requires an error code. The support owner requires a message. The exact shared premise is 「本案は〈失敗時に呼出元へ応答が返る状態が存在し続けること〉を前提にする」. The P1 alternative sends failure information only to an asynchronous incident channel; it is outside the current decision and remains pending until the operations owner approves the notification contract. There is no revision history.
```

Full response:

```text
設計記録形式: 3

決定:
- 失敗時応答（実装）: エラーコードとサポートメッセージを呼出元へ返す。

理由:
- 失敗時応答: diagnostics owner のエラーコード要件と support owner のメッセージ要件を同時に満たす。

案の処分:
- 採用 — 元候補「A = emit an error code and preserve a support message」— 両所有者の要件を満たす。
- 却下 — 元候補「B = emit an error code only」— support owner が要求するメッセージを満たさない。
- 却下 — 元候補「C = preserve a support message only」— diagnostics owner が要求するエラーコードを満たさない。

前提検査 P1:
- 対象: 失敗時の情報伝達。
- 前提: 本案は〈失敗時に呼出元へ応答が返る状態が存在し続けること〉を前提にする。
- 前提を外した案: 失敗情報を非同期インシデントチャネルにだけ送る。
- 既存候補との差分: 元候補 A、B、C はいずれも呼出元への応答内容を選ぶ案であるのに対し、この案は呼出元へ失敗情報を返さず非同期チャネルだけへ送る。
- 検査案の処分 P1: 保留 — operations owner が通知契約を承認するまで現在の決定には含めない。

改訂履歴:
- なし
```

Independent parser result: PASS. One-based section starts: `1, 12, 55, 129, 375, 618`.

### S4 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_s4`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record for the scenario below, without a code fence or commentary.

Scenario class: a bounded single-axis change with exactly one current implementation decision and no other current decision. Closed original candidates: A = "store timestamps in UTC and render them in the requester timezone"; B = "store timestamps in the requester timezone"; C = "reject requests without a timezone". The storage owner requires a single comparable timestamp basis. The interface owner requires rendering in the requester timezone. The exact shared premise is 「本案は〈時刻値が保存後に表示経路へ渡される状態が存在し続けること〉を前提にする」. The P1 alternative sends raw timestamps to the requester without any rendering; it is outside the current decision and remains pending until the locale owner approves the raw-timestamp display contract. There is no revision history.
```

Full response:

```text
設計記録形式: 3

決定:
- 時刻基準（実装）: タイムスタンプはUTCで保存し、表示時に要求者のタイムゾーンで描画する。

理由:
- 時刻基準: 保存所有者が求める単一で比較可能な時刻基準と、インターフェース所有者が求める要求者タイムゾーンでの表示を両立する。

案の処分:
- 採用 — 元候補「store timestamps in UTC and render them in the requester timezone」— 単一で比較可能な保存基準を維持しつつ、要求者のタイムゾーンで表示できる。
- 却下 — 元候補「store timestamps in the requester timezone」— 保存所有者が要求する単一で比較可能なタイムスタンプ基準を満たさない。
- 却下 — 元候補「reject requests without a timezone」— タイムゾーンの有無を拒否条件にしても、保存値を単一で比較可能な基準にする要件を満たさず、要求者タイムゾーンで描画するインターフェース所有者の要件にもならない。

前提検査 P1:
- 対象: 時刻基準。
- 前提: 本案は〈時刻値が保存後に表示経路へ渡される状態が存在し続けること〉を前提にする。
- 前提を外した案: 生のタイムスタンプを要求者へ送信し、描画しない。
- 既存候補との差分: 既存候補はいずれも保存後の時刻値を要求者タイムゾーンで描画するか、タイムゾーンがない要求を拒否するものであり、生のタイムスタンプを描画せず送信する経路は含まない。
- 検査案の処分 P1: 保留 — ロケール所有者が生タイムスタンプ表示契約を承認するまで実装しない。

改訂履歴:
- なし
```

Independent parser result: PASS. One-based section starts: `1, 12, 66, 137, 479, 730`.

### S5 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_s5`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record for the scenario below, without a code fence or commentary.

Scenario class: a bounded single-axis change with exactly one current implementation decision and no other current decision. Closed original candidates: A = "accept a valid normalized value"; B = "accept an unnormalized value"; C = "reject every value". The validation owner requires normalized acceptance. The interface owner requires acceptance of valid input. The exact shared premise is 「本案は〈入力値が妥当性判定を受ける状態が存在し続けること〉を前提にする」. The P1 alternative uses operator approval instead of validation; it is outside the current decision and remains pending until the compliance owner approves the operator-approval contract. There is no revision history.
```

Full response:

```text
設計記録形式: 3

決定:
- 入力受理（実装）: 妥当な正規化済み値を受理する。

理由:
- 入力受理: 検証所有者が正規化済みの受理を要求し、インターフェース所有者が妥当な入力の受理を要求する。

案の処分:
- 採用 — 元候補「A = accept a valid normalized value」— 両所有者の要求を満たす。
- 却下 — 元候補「B = accept an unnormalized value」— 検証所有者の正規化済み受理要求に反する。
- 却下 — 元候補「C = reject every value」— インターフェース所有者の妥当な入力を受理する要求に反する。

前提検査 P1:
- 対象: 入力受理。
- 前提: 本案は〈入力値が妥当性判定を受ける状態が存在し続けること〉を前提にする。
- 前提を外した案: 妥当性判定の代わりにオペレーター承認で入力を受理する。
- 既存候補との差分: 既存候補A・B・Cはいずれも入力値の妥当性判定を前提にした受理または拒否であり、オペレーター承認による受理は列挙済み候補と一致しない。
- 検査案の処分 P1: 保留 — オペレーター承認契約をコンプライアンス所有者が承認するまで、今回の入力受理決定の対象外として待機する。

改訂履歴:
- なし
```

Independent parser result: PASS. One-based section starts: `1, 12, 45, 104, 306, 560`.

### M1 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_m1_final`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record, without a code fence or commentary.

Scenario class: two current decision axes, exactly one implementation and exactly one wait. The full selected original candidate is A = "emit an audit event while retaining the current retention period"; it is not a partial adoption. Closed alternatives are B = "extend retention now" and C = "emit no audit event". The audit owner requires an event. The retention owner has not approved an extension. The exact shared premise is 「本案は〈監査証跡が既存保持期間で取得可能な状態が存在し続けること〉を前提にする」. The P1 alternative exports evidence to external escrow; it is outside the current decision and remains pending until the escrow owner approves the custody-and-retrieval contract. There is no revision history.
```

Full response:

```text
設計記録形式: 3

決定:
- 監査イベント（実装）: 既存保持期間を維持したまま監査イベントを出力する。
- 保持期間（待機）: 保持期間の延長は、保持期間所有者が延長を承認するまで実施しない。

理由:
- 監査イベント: 監査所有者が要求する監査証跡を取得可能にする。
- 保持期間: 所有者の承認なしに保持期間を変更しない。

案の処分:
- 採用 — 元候補「emit an audit event while retaining the current retention period」— 監査イベントを出力し、既存保持期間を維持する全体を採用する。
- 却下 — 元候補「extend retention now」— 保持期間所有者が延長を承認していない。
- 却下 — 元候補「emit no audit event」— 監査所有者が監査イベントを要求している。

前提検査 P1:
- 対象: 監査イベントの出力と保持期間の扱い。
- 前提: 本案は〈監査証跡が既存保持期間で取得可能な状態が存在し続けること〉を前提にする。
- 前提を外した案: 監査証跡を外部エスクローへ出力し、既存保持期間内で取得可能な状態に依存しない。
- 既存候補との差分: 外部エスクローの保管・取得経路を新設する案であり、保持期間を延長するBとも、監査イベントを出力しないCとも異なる。
- 検査案の処分 P1: 保留 — 外部エスクロー所有者が保管および取得契約を承認するまで保留する。

改訂履歴:
- なし
```

### M3 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_m3_retry`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record, without a code fence or commentary.

Scenario class: two current decision axes, exactly one implementation and exactly one wait. Closed original candidates: A = "invalidate the leaked key"; B = "invalidate the namespace"; C = "perform no invalidation". The cache owner requires freshness by invalidating the leaked key. The namespace owner has not approved broad invalidation. The exact shared premise is 「本案は〈キャッシュ状態が取得可能な状態が存在し続けること〉を前提にする」. The P1 alternative reads directly from the source; it is outside the current decision and remains pending until the source owner approves the direct-read contract. There is no revision history.
```

Full response:

```text
設計記録形式: 3
決定:
- 漏えいキーの無効化（実装）: 漏えいしたキーを無効化する。
- 名前空間全体の無効化（待機）: 名前空間所有者が広範な無効化を承認するまで実行しない。
理由:
- 漏えいキーの無効化: キャッシュ所有者が、漏えいキーを無効化して鮮度を満たすことを要求している。
- 名前空間全体の無効化: 広範な無効化には名前空間所有者の承認が必要であり、未承認である。
案の処分:
- 採用 — 元候補「invalidate the leaked key」— キャッシュ所有者の鮮度要件を満たす。
- 保留 — 元候補「invalidate the namespace」— 名前空間所有者が広範な無効化を承認した場合に再検討する。
- 却下 — 元候補「perform no invalidation」— キャッシュ所有者が漏えいキーの無効化による鮮度確保を要求している。
前提検査 P1:
- 対象: 漏えいキーの無効化と名前空間全体の無効化。
- 前提: 本案は〈キャッシュ状態が取得可能な状態が存在し続けること〉を前提にする。
- 前提を外した案: キャッシュを参照せず、ソースから直接読み取る。
- 既存候補との差分: 元候補はいずれもキャッシュ状態への無効化またはその不実施であり、ソース直接読取は列挙されていない別クラスの案である。
- 検査案の処分 P1: 保留 — ソース所有者が直接読取契約を承認した場合に再検討する。
改訂履歴:
- なし
```

Independent parser result: PASS. Human audit: two axes, waits, candidate ownership, premise, and P1 boundary are satisfied.

### M4 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_m4`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record, without a code fence or commentary.

Scenario class: two current decision axes, exactly one implementation and exactly one wait. Closed original candidates: A = "emit a consent log"; B = "share consent data with a partner"; C = "emit no consent log". The compliance owner requires a consent log. The partnership owner has not approved partner sharing. The exact shared premise is 「本案は〈同意記録が内部監査経路で取得可能な状態が存在し続けること〉を前提にする」. The P1 alternative stores consent proof with an external notary; it is outside the current decision and remains pending until the notary owner approves the custody contract. There is no revision history.
```

Full response:

```text
設計記録形式: 3
決定:
- 同意記録（実装）: 同意記録を内部監査経路で取得可能な状態として残す。
- パートナー共有（待機）: パートナーへの同意データ共有は、パートナーシップ責任者が共有を承認するまで行わない。
理由:
- 同意記録: コンプライアンス責任者が求める同意記録を満たす。
- パートナー共有: パートナーシップ責任者の承認なく同意データを共有しない。
案の処分:
- 採用 — 元候補「emit a consent log」— 同意記録を内部監査経路で取得可能にし、コンプライアンス責任者の要求を満たす。
- 保留 — 元候補「share consent data with a partner」— パートナーシップ責任者が共有を承認するまで再検討しない。
- 却下 — 元候補「emit no consent log」— コンプライアンス責任者が同意記録を要求しているため採れない。
前提検査 P1:
- 対象: 同意記録。
- 前提: 本案は〈同意記録が内部監査経路で取得可能な状態が存在し続けること〉を前提にする。
- 前提を外した案: 同意証跡を内部監査経路に残さず、外部公証人が保管する。
- 既存候補との差分: 既存候補は同意記録の出力有無またはパートナー共有を扱い、外部公証人による証跡保管は扱わない。
- 検査案の処分 P1: 保留 — 外部公証人の保管契約を承認するのは公証人の責任者であり、その承認が得られるまで採用しない。
改訂履歴:
- なし
```

Independent parser result: PASS. Human audit: two axes, waits, candidate ownership, premise, and P1 boundary are satisfied.

### M2 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_m2_final`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record, without a code fence or commentary.

Scenario class: two current decision axes, exactly one implementation and exactly one wait. The full selected original candidate is A = "classify errors while retaining the current retry count"; it is not a partial adoption. Closed alternatives are B = "change the retry count" and C = "continue without classification". The diagnostics owner requires error classification. The operations owner has not approved changing retries. The exact shared premise is 「本案は〈新しい分類の観測値を既存retry回数で取得できる状態が存在し続けること〉を前提にする」. The P1 alternative exports offline analytics; it is outside the current decision and remains pending until the analytics owner approves the analytics contract. There is no revision history.
```

Full response:

```text
設計記録形式: 3

決定:
- エラー分類（実装）: retry回数を現行のまま保持して、エラーを分類する。
- retry回数（待機）: operations ownerがretry回数の変更を承認するまで、現行retry回数を変更しない。

理由:
- エラー分類: diagnostics ownerが要求するエラー分類を満たす。
- retry回数: operations ownerの承認なくretry回数を変更しない。

案の処分:
- 採用 — 元候補「A = classify errors while retaining the current retry count」— 全体を採用し、エラー分類と現行retry回数の維持を一体として実装する。
- 保留 — 元候補「B = change the retry count」— operations ownerがretry回数の変更を承認した時点で再検討する。
- 却下 — 元候補「C = continue without classification」— diagnostics ownerがエラー分類を要求している。

前提検査 P1:
対象: エラー分類とretry回数を現行のまま保持する決定。
前提: 本案は〈新しい分類の観測値を既存retry回数で取得できる状態が存在し続けること〉を前提にする。
前提を外した案: 分類の観測値を既存retry回数で取得する状態に依存せず、offline analyticsへエクスポートする。
既存候補との差分: 元候補AからCは実行時の分類またはretry回数の扱いを対象とし、offline analyticsのエクスポート契約は対象にしない。
検査案の処分 P1: 保留 — analytics ownerがanalytics contractを承認した時点で再検討する。

改訂履歴:
- なし
```

Independent parser result: PASS. Human audit: A is fully adopted, B is executable owner-wait, and C is owner-grounded rejection.

### M5 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_m5`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record, without a code fence or commentary.

Scenario class: two current decision axes, exactly one implementation and exactly one wait. Closed original candidates: A = "emit a latency metric"; B = "change the alert threshold"; C = "emit no latency metric". The observability owner requires the latency metric. The on-call owner has not approved an alert-threshold change. The exact shared premise is 「本案は〈遅延観測値が既存警報閾値で取得可能な状態が存在し続けること〉を前提にする」. The P1 alternative exports latency observations to an external analytics service; it is outside the current decision and remains pending until the analytics owner approves the export contract. There is no revision history.
```

Full response:

```text
設計記録形式: 3

決定:
- 遅延観測（実装）: latency metric を出力する。
- 警報閾値（待機）: alert threshold は変更せず、on-call owner が変更を承認するまで待機する。

理由:
- 遅延観測: observability owner が要求する遅延観測値を提供する。
- 警報閾値: on-call owner による alert-threshold change の承認が未了である。

案の処分:
- 採用 — 元候補「emit a latency metric」— observability owner の要求を満たす。
- 保留 — 元候補「change the alert threshold」— on-call owner による変更承認後に再検討する。
- 却下 — 元候補「emit no latency metric」— observability owner が latency metric を要求している。

前提検査 P1:
- 対象: 遅延観測と警報閾値。
- 前提: 本案は〈遅延観測値が既存警報閾値で取得可能な状態が存在し続けること〉を前提にする。
- 前提を外した案: latency observations を外部 analytics service へ export する。
- 既存候補との差分: 元候補は latency metric の出力、alert threshold の変更、または latency metric を出力しない案であり、外部 analytics service への export contract を含まない。
- 検査案の処分 P1: 保留 — analytics owner が export contract を承認するまで現在の決定の対象外とする。

改訂履歴:
- なし
```

Independent parser result: PASS. Human audit: two axes, executable wait, candidate ownership, premise, and P1 boundary are satisfied.

### P1 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_p1_final`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record, without a code fence or commentary.

Scenario class: a genuine composite-original partial adoption. Closed original candidates: A = "write an immutable audit log and extend retention for seven years"; B = "write an immutable audit log only"; C = "write no audit log". From A, immutable logging is selected; the seven-year extension remains pending until the retention owner approves it. The audit owner requires both an immutable log and an explicit retention decision for its evidence. B is owner-incompatible because it omits the retention owner's pending decision; reject B. C is owner-incompatible because it omits immutable logging required by the audit owner; reject C. The exact shared premise is 「本案は〈監査証跡が内部保持先から取得可能な状態が存在し続けること〉を前提にする」. The P1 alternative exports evidence to external escrow; it remains pending until the escrow owner approves the custody-and-retrieval contract. There is no revision history.
```

Full response:

```text
設計記録形式: 3

決定:
- 監査ログ（実装）: immutable audit log を書き込む。
- 保持期間（待機）: 7年間への保持期間延長は、保持期間所有者の承認による明示的な決定まで保留する。

理由:
- 監査ログ: 監査所有者が要求する改変不能な監査証跡を提供する。
- 保持期間: 監査証跡の根拠には immutable audit log と保持期間についての明示的な決定の両方が必要であり、保持期間所有者の承認前に延長を確定できない。

案の処分:
- 部分採用 — 元候補「write an immutable audit log and extend retention for seven years」— 採用部分: immutable audit log の書き込み; 残部: 保留 — 保持期間所有者が7年間への延長を承認するまで。
- 却下 — 元候補「write an immutable audit log only」— 保持期間所有者による保留中の明示的な決定を欠き、監査所有者の証跡要件と両立しない。
- 却下 — 元候補「write no audit log」— 監査所有者が要求する immutable audit log を欠き、所有者要件と両立しない。

前提検査 P1:
- 対象: 監査証跡の保管経路。
- 前提: 本案は〈監査証跡が内部保持先から取得可能な状態が存在し続けること〉を前提にする。
- 前提を外した案: 監査証跡を外部エスクローへ出力し、custody-and-retrieval contract により取得可能性を確保する。
- 既存候補との差分: A、B、C はいずれも監査証跡の取得可能性を内部保持先に置くため、外部エスクローへ出力する本案は列挙済み候補と一致せず、この共有前提を外す。
- 検査案の処分 P1: 保留 — 外部エスクロー所有者が custody-and-retrieval contract を承認するまで。

改訂履歴:
- なし
```

Independent parser result: PASS. Human audit: composite A preserves its selected and owner-controlled remainder; B/C are owner-grounded rejections.

### P2 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_p2_retry`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record, without a code fence or commentary.

Scenario class: a genuine composite-original partial adoption with exactly two current decision axes: ingress validation is implementation, and metadata enrichment is waiting. Closed original candidates: A = "validate ingress data and enrich metrics with request metadata"; B = "enrich metrics with request metadata without validation"; C = "accept ingress without validation or enrichment". From A, ingress validation is selected; metadata enrichment remains pending until the interface owner approves it. B and C are owner-incompatible and rejected because the validation owner requires ingress validation. The exact shared premise is 「本案は〈入力値が検証後に内部メトリクス経路へ渡される状態が存在し続けること〉を前提にする」. The P1 alternative uses manual review before metrics and is outside the current decision; it remains pending until the review owner approves the review contract. There is no revision history.
```

Full response:

```text
設計記録形式: 3
決定:
- ingress validation（実装）: 入力値を検証してから内部メトリクス経路へ渡す。
- metadata enrichment（待機）: request metadata によるメトリクス拡充は、interface owner の承認まで実装しない。
理由:
- ingress validation: validation owner が要求する入力値の検証を満たす。
- metadata enrichment: interface owner が所有する interface の承認前に metadata enrichment を導入しない。
案の処分:
- 部分採用 — 元候補「validate ingress data and enrich metrics with request metadata」— 採用部分: ingress validation; 残部: 保留 — metadata enrichment は interface owner の承認後に再検討する。
- 却下 — 元候補「enrich metrics with request metadata without validation」— validation owner が ingress validation を要求するため owner-incompatible である。
- 却下 — 元候補「accept ingress without validation or enrichment」— validation owner が ingress validation を要求するため owner-incompatible である。
前提検査 P1:
- 対象: ingress validation と metadata enrichment の現在の決定。
- 前提: 本案は〈入力値が検証後に内部メトリクス経路へ渡される状態が存在し続けること〉を前提にする。
- 前提を外した案: メトリクス経路へ渡す前に手動レビューを行い、検証後に内部メトリクス経路へ渡す状態を前提にしない。
- 既存候補との差分: 既存候補 A、B、C はいずれも入力値を検証後に内部メトリクス経路へ渡す状態を前提にしており、手動レビュー契約を導入する本案は列挙済み候補にない。
- 検査案の処分 P1: 保留 — manual review before metrics は現在の決定外であり、review owner が review contract を承認した後に再検討する。
改訂履歴:
- なし
```

### P3 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_p3`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record, without a code fence or commentary.

Scenario class: a genuine composite-original partial adoption. Closed original candidates: A = "encrypt backup data with managed keys and rotate historical key material"; B = "rotate historical key material without managed-key encryption"; C = "leave backups unencrypted". From A, managed-key encryption is selected; historical key rotation remains pending until the security owner approves it. B and C are owner-incompatible and rejected because the security owner requires managed-key encryption. The exact shared premise is 「本案は〈バックアップ復元時に鍵管理サービスへ到達できる状態が存在し続けること〉を前提にする」. The P1 alternative uses locally managed keys; it remains pending until the key-custody owner approves the custody contract. There is no revision history.
```

Full response:

```text
設計記録形式: 3
決定:
- バックアップデータ暗号化（実装）: managed keys による暗号化を導入する。
- 過去鍵材料のローテーション（待機）: security owner が承認するまで実施しない。
理由:
- バックアップデータ暗号化: security owner が managed-key encryption を要求している。
- 過去鍵材料のローテーション: 承認前に履歴鍵材料を変更しない。
案の処分:
- 部分採用 — 元候補「encrypt backup data with managed keys and rotate historical key material」— 採用部分: managed keys によるバックアップデータ暗号化; 残部: 保留 — security owner による過去鍵材料ローテーションの承認後に再検討する。
- 却下 — 元候補「rotate historical key material without managed-key encryption」— security owner が managed-key encryption を要求しており、所有者要件と両立しない。
- 却下 — 元候補「leave backups unencrypted」— security owner が managed-key encryption を要求しており、所有者要件と両立しない。
前提検査 P1:
- 対象: managed keys によるバックアップデータ暗号化。
- 前提: 本案は〈バックアップ復元時に鍵管理サービスへ到達できる状態が存在し続けること〉を前提にする。
- 前提を外した案: locally managed keys によりバックアップデータを暗号化する。
- 既存候補との差分: 既存候補には locally managed keys を用いる案がなく、この案は鍵管理サービスへの到達性を前提とせず、鍵保管責任を key-custody owner へ移す。
- 検査案の処分 P1: 保留 — key-custody owner が custody contract を承認した後に再検討する。
改訂履歴:
- なし
```

### P4 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_p4`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record, without a code fence or commentary.

Scenario class: a genuine composite-original partial adoption. Closed original candidates: A = "persist a detailed trace and publish a public audit digest"; B = "publish a public audit digest without a detailed trace"; C = "retain neither trace nor digest". From A, the detailed trace is selected; publication remains pending until the privacy owner approves it. B and C are owner-incompatible and rejected because the audit owner requires a detailed trace. The exact shared premise is 「本案は〈監査詳細が内部調査経路から取得可能な状態が存在し続けること〉を前提にする」. The P1 alternative stores the trace with an external auditor; it remains pending until the auditor owner approves the custody contract. There is no revision history.
```

Full response:

```text
設計記録形式: 3
決定:
- 監査詳細（実装）: 詳細トレースを保持する。
- 公開監査要約（待機）: プライバシー所有者が公開を承認するまで公開しない。
理由:
- 監査詳細: 監査所有者が詳細トレースを必要としている。
- 公開監査要約: 公開はプライバシー所有者の承認を必要とする。
案の処分:
- 部分採用 — 元候補「persist a detailed trace and publish a public audit digest」— 採用部分: 詳細トレースの保持; 残部: 保留 — プライバシー所有者が公開を承認した時点で再検討する。
- 却下 — 元候補「publish a public audit digest without a detailed trace」— 監査所有者が詳細トレースを要求しており、所有者要件と両立しない。
- 却下 — 元候補「retain neither trace nor digest」— 監査所有者が詳細トレースを要求しており、所有者要件と両立しない。
前提検査 P1:
- 対象: 詳細トレースの保管先。
- 前提: 本案は〈監査詳細が内部調査経路から取得可能な状態が存在し続けること〉を前提にする。
- 前提を外した案: 詳細トレースを外部監査人に保管させる。
- 既存候補との差分: 元候補は詳細トレースの有無と公開監査要約の有無を扱うが、外部監査人への保管と内部調査経路からの取得不能を扱わない。
- 検査案の処分 P1: 保留 — 外部監査人の所有者が保管契約を承認した時点で再検討する。
改訂履歴:
- なし
```

### P5 accepted sample

Task identity: `/root/format3_pressure_rebuild/format3_p5`.

Prompt:

```text
You are one independent fresh pressure context. First use a read-only tool to read only `/Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not edit files, perform git operations, or use other operational sources. Then return only the complete Format 3 design record, without a code fence or commentary.

Scenario class: a genuine composite-original partial adoption. Closed original candidates: A = "encrypt backups and rotate all historical key material"; B = "rotate historical key material without encrypting backups"; C = "leave backups unencrypted". From A, backup encryption is selected; historical-key rotation remains pending until the key owner approves an impact assessment. B and C are owner-incompatible and rejected because the security owner requires backup encryption. The exact shared premise is 「本案は〈復元時に現在の鍵材料が利用可能な状態が存在し続けること〉を前提にする」. The P1 alternative uses a separately escrowed recovery key; it remains pending until the recovery owner approves the escrow contract. Before implementation, the earlier decision was "encrypt backups and rotate all historical key material immediately"; it changed to the current selected-and-pending decision because the key inventory showed rotation impact; reapproval is `https://example.test/format3/p5-reapproval`.
```

Full response:

```text
設計記録形式: 3
決定:
- バックアップ暗号化（実装）: バックアップを暗号化する。
- 過去の鍵材料ローテーション（待機）: 鍵所有者が影響評価を承認するまで、過去の鍵材料をローテーションしない。
理由:
- バックアップ暗号化: セキュリティ所有者が要求するバックアップ暗号化を満たす。
- 過去の鍵材料ローテーション: 鍵インベントリで判明したローテーション影響を、鍵所有者の承認済み影響評価で判断する。
案の処分:
- 部分採用 — 元候補「encrypt backups and rotate all historical key material」— 採用部分: バックアップを暗号化する; 残部: 保留 — 鍵所有者が影響評価を承認するまで過去の鍵材料ローテーションを待機する。
- 却下 — 元候補「rotate historical key material without encrypting backups」— セキュリティ所有者がバックアップ暗号化を要求しており、所有者要件と両立しない。
- 却下 — 元候補「leave backups unencrypted」— セキュリティ所有者がバックアップ暗号化を要求しており、所有者要件と両立しない。
前提検査 P1:
- 対象: 復元鍵の可用性。
- 前提: 本案は〈復元時に現在の鍵材料が利用可能な状態が存在し続けること〉を前提にする。
- 前提を外した案: 現在の鍵材料に依存せず、別途エスクローした復元鍵を使用する。
- 既存候補との差分: 既存候補はいずれも復元時に現在の鍵材料が利用可能であることに依存し、別途エスクローした復元鍵を使用しない。
- 検査案の処分 P1: 保留 — 復元鍵所有者がエスクロー契約を承認するまで待機する。
改訂履歴:
- encrypt backups and rotate all historical key material immediately → バックアップを暗号化し、過去の鍵材料ローテーションは鍵所有者の影響評価承認まで待機する — 鍵インベントリでローテーション影響が判明したため — 再承認: https://example.test/format3/p5-reapproval
```

## Final human semantic audit — accepted corpus only

Each response was independently passed to `parseFormat3DesignRecord`. The ordered one-based starts are marker, decision, rationale, dispositions, P1, and history.

| ID | Parser | Starts |
| --- | --- | --- |
| S1 | PASS | 1, 11, 67, 142, 388, 595 |
| S2 | PASS | 1, 12, 57, 115, 357, 568 |
| S3 | PASS | 1, 12, 55, 129, 375, 618 |
| S4 | PASS | 1, 12, 66, 137, 479, 730 |
| S5 | PASS | 1, 12, 45, 104, 306, 560 |
| M1 | PASS | 1, 12, 102, 170, 394, 648 |
| M2 | PASS | 1, 12, 125, 219, 499, 802 |
| M3 | PASS | 1, 11, 93, 195, 397, 629 |
| M4 | PASS | 1, 11, 111, 188, 405, 635 |
| M5 | PASS | 1, 12, 115, 225, 448, 796 |
| P1 | PASS | 1, 12, 108, 234, 557, 858 |
| P2 | PASS | 1, 11, 149, 298, 737, 1102 |
| P3 | PASS | 1, 11, 111, 214, 631, 952 |
| P4 | PASS | 1, 11, 80, 147, 459, 682 |
| P5 | PASS | 1, 11, 103, 209, 540, 763 |

Human audit: S1–S5 are each one bounded implementation axis. M1–M5 have exactly one implementation and one executable owner-controlled wait. P1–P5 preserve the selected and remaining portions of composite original A, reject B and C on owner-grounded facts, and keep P1 outside current decisions. P5 alone contains the supplied pre-implementation revision and reapproval. Structural PASS is not a claim that this human semantic audit is automated.

## Current final validation

All 15 accepted records parsed successfully with `parseFormat3DesignRecord`. `pnpm -r test` exited 0. `check-md-linebreaks` reported OK. Roadmap strict validation reported OK, format check exited 0, all location paths existed, graph orphans returned none, and graph I/O returned `ok: true`.

After `reader_first_design_records` transitioned to `done`, strict validation, format check, link validation, and orphan validation passed again. The transition made `publish_cli_pipeline_kind` newly ready.

## Current verification evidence

Historical RED evidence, run before the parser/template implementation:

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

The former GREEN count is intentionally omitted: it was an implementation-time snapshot and is not the current focused-test total. Current focused-test evidence belongs to the current verification run, whose observed total is 387.

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

P5 was independently parsed with `parseFormat3DesignRecord`; its original partial-adoption fields, premise block, section order, and input-backed B→A REC-42 revision row all passed.

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
Historical focused-test command output omitted; its former count is not current evidence. The current focused-test total is 387.

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

Current post-transition validation: the immediate-fenced-block extractor returned `PASS` for S1–S5, M1–M5, and P1–P5. `check-md-linebreaks` returned `OK`; roadmap strict check returned `OK`; format check passed; location links existed; graph orphans returned `(none)`; and `reader_first_design_records.status` read back as `done`.

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
