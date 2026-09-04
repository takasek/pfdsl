# Format 3 pressure evidence — durable Task 4 verification

## Replacement evidence acceptance contract

This report contains the authoritative fifteen-context corpus and the verification evidence used before `reader_first_design_records` transitioned from `wip` to `done`.

The source-declaration acceptance rule permits a semantically equivalent declaration when it unambiguously limits inputs to the canonical work-cycle and supplied prompt and confirms no writes. It does not relax any other evidence requirement.

## Fresh semantic contexts

### S2 — raw preservation and normalized validation

Task identity: `durable_s2` (`fork_turns: none`). Source declaration: `使用した情報源は、指定された canonical work-cycle.md と委譲プロンプトだけです。書き込みは行っていません。` This is accepted under the semantic-equivalence ruling.

Exact prompt/input:

```text
Fresh S2. Read only canonical work-cycle /Users/m5/.codex/worktrees/c98c/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md and supplied prompt, no writes. Begin source declaration saying only those inputs and no writes. Echo this full prompt under Exact prompt/input. Full fenced Format3 then six one-based codepoint starts and candidate/premise/rejection/boundary/human audits. Scenario closed #1076: A preserve raw input and use normalized validation value; B persist normalized input; C validate raw without normalization. Audit owner requires raw preservation; validation owner requires normalized validation. Shared premise input remains available to validation. Exact premise `本案は〈入力値が検証経路へ渡される状態が存在し続けること〉を前提にする`. P1 alternative remove validation path and manually review, hold review owner approval. A adopt B reject audit owner C reject validation owner. history none.
```

Complete record:

```text
設計記録形式: 3
決定:
- 保存値（実装）: raw input を保存する。
- 検証値（実装）: normalized validation value を検証に用いる。
- 検証経路（実装）: 入力値を検証経路へ渡す。
理由:
- 保存値: audit owner が raw preservation を要求しているため。
- 検証値: validation owner が normalized validation を要求しているため。
- 検証経路: 保存と検証の両要件を満たすため。
案の処分:
- 採用 — 元候補「A preserve raw input and use normalized validation value」— raw input を保存し、normalized validation value を検証に用いるため。
- 却下 — 元候補「B persist normalized input」— audit owner が raw preservation を要求しているため。
- 却下 — 元候補「C validate raw without normalization」— validation owner が normalized validation を要求しているため。
前提検査 P1:
対象:
- 元候補 A、B、C が共有する検証経路。
前提:
- 本案は〈入力値が検証経路へ渡される状態が存在し続けること〉を前提にする
前提を外した案:
- 検証経路を削除し、入力を手動レビューする。
既存候補との差分:
- 元候補 A、B、C はいずれも検証経路を残すが、この案は検証経路を削除する。
検査案の処分 P1:
- 保留 — 検証経路を削除して入力を手動レビューする案 — review owner approval が得られた場合に再検討する。
改訂履歴:
- なし
```

Parser/order result: PASS. One-based starts: marker=1, decision=11, rationale=116, dispositions=253, P1=567, history=808. Candidate audit: A→採用, B→却下 (audit owner), C→却下 (validation owner), each once. Premise audit: the canonical premise exactly matches and P1 removes the shared validation path. Rejection audit: owner-grounded. Semantic boundary and human verdict: structural conformance does not prove owner-fact truth or candidate-set completeness; PASS with those conditions retained for human review. Revision audit: `なし` matches the supplied history.

### S3 — empty-after-trim handling

Task identity: `durable_s3` (`fork_turns: none`). Source declaration: `使用した情報源は、canonical work-cycle と提示されたプロンプトだけです。書き込みは行っていません。`

Exact prompt/input:

```text
Fresh S3, only workcycle path plus prompt/no writes. Give sole-source/no-write declaration, exact prompt echo, fenced format3, one-based starts/audits. closed #1076 A reject empty-after-trim B persist empty C replace with default. data owner requires reject empty, schema owner forbids default. all share post-trim value handling. premise `本案は〈trim後の値が保存前に処理される状態が存在し続けること〉を前提にする`. P1 manual review before persistence held data steward approval. A adopted, B reject data owner, C schema owner. history none.
```

Complete record:

```text
設計記録形式: 3
決定:
- 空値処理（実装）: trim 後に空となる値を保存前に拒否する。
理由:
- 空値処理: data owner が空値の拒否を要求し、schema owner が default への置換を禁じているため。
案の処分:
- 採用 — 元候補「A reject empty-after-trim」— data owner が trim 後の空値を拒否することを要求しているため。
- 却下 — 元候補「B persist empty」— data owner が空値の拒否を要求しているため。
- 却下 — 元候補「C replace with default」— schema owner が default への置換を禁じているため。
前提検査 P1:
対象:
- 元候補 A、B、C が共有する、trim 後の値の保存前処理。
前提:
- 本案は〈trim後の値が保存前に処理される状態が存在し続けること〉を前提にする
前提を外した案:
- trim 後の値を処理対象にせず、入力を保存前に手動レビューする。
既存候補との差分:
- 元候補 A、B、C は trim 後の値を保存前に処理するが、この案は trim 後の値を処理せず手動レビューする。
検査案の処分 P1:
- 保留 — 保存前に手動レビューする案 — data steward approval が得られた場合に再検討する。
改訂履歴:
- なし
```

Parser/order result: PASS. One-based starts: marker=1, decision=11, rationale=50, dispositions=121, P1=336, history=616. Candidate audit: A→採用, B→却下 (data owner), C→却下 (schema owner), each once. Premise audit: exact canonical premise; P1 removes shared pre-persistence handling. Rejection audit: owner-grounded and P1 is held for data-steward approval. Revision audit: `なし`. Semantic boundary: fact truth, candidate completeness, and owner approval require human review. Human verdict: PASS.

### S4 — caller error response

Task identity: `durable_s4_final` (`fork_turns: none`). Exact dispatched prompt and response scope: only canonical work-cycle and the following closed input, with no writes.

```text
closed #1076 candidates A emit error code and preserve message; B emit code only; C preserve message only. Diagnostic owner requires code; support owner requires message. All share response to caller on failure. Exact premise `本案は〈失敗時に呼出元へ応答が返る状態が存在し続けること〉を前提にする`. Outside P1 alternative async incident channel, hold until operations owner defines contract. A adopt; B reject only support owner; C reject only diagnostic owner; history none.
```

Complete response:

```text
設計記録形式: 3
決定:
- 失敗応答内容（実装）: エラーコードを出力し、メッセージを保持する。
- 代替障害通知経路（待機）: 非同期インシデントチャネルは、運用責任者が契約を定義するまで実装しない。
理由:
- 失敗応答内容: 診断責任者が必要とするエラーコードと、サポート責任者が必要とするメッセージをともに提供する。
- 代替障害通知経路: 非同期インシデントチャネルの契約は運用責任者の所有事項であり、現時点では定義されていない。
案の処分:
- 採用 — 元候補「A emit error code and preserve message」— 診断責任者のコード要件とサポート責任者のメッセージ要件をともに満たす。
- 却下 — 元候補「B emit code only」— サポート責任者が必要とするメッセージを保持しない。
- 却下 — 元候補「C preserve message only」— 診断責任者が必要とするエラーコードを出力しない。
前提検査 P1:
対象: 候補A、候補B、候補C
前提: 本案は〈失敗時に呼出元へ応答が返る状態が存在し続けること〉を前提にする
前提を外した案: 呼出元への失敗応答に代えて、非同期インシデントチャネルへエラーコードとメッセージを通知する。
既存候補との差分: 既存候補はいずれも失敗時に呼出元へ応答するが、この案は呼出元への応答を前提とせず、別の非同期経路へ障害情報を送る。
検査案の処分 P1:
- 保留 — 前提を外した案「非同期インシデントチャネル」— 運用責任者が通知先、配送保証、障害情報、停止条件を含む契約を定義した時点で再検討する。
改訂履歴:
- なし
```

Deterministic parser/order result: PASS. One-based heading starts: marker=1, decision=11, rationale=105, dispositions=224, P1=436, history=711. Candidate audit: A→採用, B→却下 (support owner), C→却下 (diagnostic owner), each once. Premise audit: exact canonical form and P1 outside A/B/C. Rejection audit: owner-grounded; P1 holds on a concrete operations contract. Revision audit: `なし`. Semantic boundary: owner-fact truth and candidate completeness require human review. Human verdict: PASS.

### S5 — normalized-value acceptance

Task identity: `durable_s5_final` (`fork_turns: none`). Exact closed input: A accept valid normalized value; B accept unnormalized value; C reject all values; validation owner requires normalized acceptance; interface owner requires valid input acceptance; P1 uses operator approval and awaits compliance-owner approval; history none.

Complete response:

```text
設計記録形式: 3
決定:
- 入力値の受理方針（実装）: 妥当な正規化済み値を受理する案Aを採用する。
理由:
- 入力値の受理方針: validation owner が要求する正規化済み値の受理と、interface owner が要求する妥当な入力の受理をともに満たすため。
案の処分:
- 採用 — 元候補「A accept valid normalized value」— validation owner と interface owner の双方の要求を満たす。
- 却下 — 元候補「B accept unnormalized value」— validation owner が正規化済み値の受理を要求しているため。
- 却下 — 元候補「C reject all values」— interface owner が妥当な入力の受理を要求しているため。
前提検査 P1:
対象: 案A、案B、案Cが共有する妥当性判定結果への依存。
前提: 本案は〈入力値が妥当性判定を受ける状態が存在し続けること〉を前提にする
前提を外した案: 妥当性判定を用いず、operator の承認によって入力値の受理を決める。
既存候補との差分: 案A、案B、案Cはいずれも妥当性判定結果を共有するが、この案は妥当性判定を受理判断から外して operator の承認へ置き換える。
検査案の処分 P1: 保留 — compliance owner の承認が得られた場合に再検討する。
改訂履歴:
- なし
```

Declared scope: only canonical work-cycle and supplied scenario; no writes. Parser/order result: PASS. One-based heading starts: marker=1, decision=11, rationale=54, dispositions=143, P1=389, history=643. Candidate audit: A→採用, B→却下 (validation owner), C→却下 (interface owner), each once. Premise/rejection/revision audits and semantic boundary: PASS subject to human verification of owner facts and candidate completeness.

### M1 — audit-event retention

Task identity: `durable_m1_retry` (`fork_turns: none`). Task boundary permitted exactly one canonical-work-cycle read and prohibited all tools other than that read and all writes; execution reported no mutation. Operational-source declaration: canonical work-cycle and supplied scenario only.

```text
設計記録形式: 3
決定:
- 監査イベント（実装）: 監査イベントを保存する
- 保持期間延長（待機）: 保持期間所有者の承認を待ち、現時点では延長しない
理由:
- 監査イベント: 監査所有者が監査イベントを必要としているため
- 保持期間延長: 保持期間所有者の承認が得られていないため
案の処分:
- 採用 — 元候補「A」— 監査イベントを保存し、保持期間所有者の承認まで保持期間延長を待機する
- 却下 — 元候補「B」— 保持期間所有者の承認が得られていないため
- 却下 — 元候補「C」— 監査所有者が監査イベントを必要としているため
前提検査 P1:
対象: 監査証跡の保持方式
前提: 本案は〈監査証跡が取得可能な状態が存在し続けること〉を前提にする
前提を外した案: 監査証跡を外部エスクローへエクスポートし、内部で取得可能な状態の継続に依存しない
既存候補との差分: 元候補はいずれも内部の監査証跡の取得可能性を扱うが、この案は監査証跡を外部エスクローへ移して共有前提を外す
検査案の処分 P1: 保留 — 外部エスクロー所有者との契約が未確定であるため、契約成立時に再検討する
改訂履歴:
- なし
```

Parser/order result: PASS. One-based starts: marker=1, decision=11, rationale=80, dispositions=148, P1=278, history=504.

### M2 — classification with unchanged retry

Task identity: `durable_m2_final2` (`fork_turns: none`). Exact dispatched scenario: A classification/retry unchanged; B classification/retry change; C retry only; diagnostics requires classification; operations has not approved retry change; P1 offline analytics holds on analytics contract.

Complete response:

```text
設計記録形式: 3
決定:
- 再実行規則（実装）: 共有処理では分類を維持したまま再実行する
理由:
- 再実行規則: 分類は診断に必要であり、再実行だけを理由に変更する運用は未承認だから
案の処分:
- 採用 — 元候補「A」— 分類を維持した再実行は共有処理と診断要件を両立する
- 却下 — 元候補「B」— 再実行時の分類変更は未承認の運用変更を導入する
- 却下 — 元候補「C」— 再実行のみでは診断に必要な分類を保持できない
前提検査 P1:
対象: 失敗が処理経路で扱われる状態の継続性
前提: 本案は〈失敗が処理経路で扱われる状態が存在し続けること〉を前提にする
前提を外した案: オフライン分析で再実行対象を特定する
既存候補との差分: 処理経路上の分類に依存せず、分析契約に基づいて対象を特定する
検査案の処分 P1: 保留 — オフライン分析の分析契約が未確定だから
改訂履歴:
- なし
```

`parseFormat3DesignRecord` result: PASS. One-based starts: marker=1, decision=11, rationale=52, dispositions=118, P1=314, history=574. Candidate audit: A→採用, B→却下 (operations), C→却下 (diagnostics), each once. Premise/rejection audit: PASS subject to human fact verification. Revision audit: `なし`.

### M3 — key-only cache invalidation

Task identity: `durable_m3_final3` (`fork_turns: none`). Exact closed input fixed the canonical premise and both owner grounds. Complete response:

```text
設計記録形式: 3
決定:
- キャッシュ無効化（実装）: 対象キーだけを無効化する
理由:
- キャッシュ無効化: cache owner がキャッシュ鮮度を要求し、namespace owner は広範な無効化を承認していないため
案の処分:
- 採用 — 元候補「A」— 対象キーだけを無効化する
- 却下 — 元候補「B」— namespace owner が広範な無効化を承認していないため
- 却下 — 元候補「C」— cache owner がキャッシュ鮮度を要求しているため
前提検査 P1:
対象: キャッシュ経路
前提: 本案は〈キャッシュ状態が取得可能な状態が存在し続けること〉を前提にする
前提を外した案: キャッシュを使わずソースを直接読む
既存候補との差分: A、B、Cはキャッシュ経路を扱うが、前提を外した案はソースを直接読む
検査案の処分 P1: 保留 — source owner が直接読み取り契約を承認した場合に再検討する
改訂履歴:
- なし
```

`parseFormat3DesignRecord` result: PASS. One-based starts: marker=1, decision=11, rationale=50, dispositions=142, P1=268, history=503. Candidate audit: A→採用, B→却下 (namespace owner), C→却下 (cache owner), each once. Premise audit: exact canonical sentence and source-read alternative outside A/B/C. Revision audit: `なし`. Human verdict: PASS subject to supplied owner facts.

### M4 — audit event with retained period

Task identity: `durable_m4_final` (`fork_turns: none`). Complete response: `設計記録形式: 3`; decision axes 監査イベント=実装 and 保持期間延長=実装しない; reasons match axes; A is adopted, B rejected for retention-owner absence, C rejected for audit-owner requirement; P1 uses owner-queue export and holds for its contract; history is `なし`. The exact canonical premise is `本案は〈監査イベントが既存保持期間で調査可能な状態が存在し続けること〉を前提にする`.

```text
設計記録形式: 3
決定:
- 監査イベント（実装）: 監査イベントを出力し、既存保持期間を維持する
- 保持期間延長（実装しない）: 保持期間を延長しない
理由:
- 監査イベント: 監査所有者が監査イベントを必要としているため
- 保持期間延長: 保持期間所有者が延長しないと決定しているため
案の処分:
- 採用 — 元候補「A」— 監査イベントを出力し、既存保持期間を維持する
- 却下 — 元候補「B」— 保持期間所有者が延長しないと決定しているため
- 却下 — 元候補「C」— 監査所有者が監査イベントを必要としているため
前提検査 P1:
対象: 監査イベントの調査経路
前提: 本案は〈監査イベントが既存保持期間で調査可能な状態が存在し続けること〉を前提にする
前提を外した案: 監査イベントを owner queue へエクスポートし、既存保持期間で調査可能な状態の継続に依存しない
既存候補との差分: 元候補は監査イベントの有無または保持期間を変えるが、この案は監査イベントを owner queue へ移して既存保持期間への依存を外す
検査案の処分 P1: 保留 — owner queue の契約が未確定であるため、契約成立時に再検討する
改訂履歴:
- なし
```

`parseFormat3DesignRecord` result: PASS. One-based starts: marker=1, decision=11, rationale=81, dispositions=172, P1=371, history=689. Candidate audit: A→採用, B→却下 (retention owner), C→却下 (audit owner), each once. Premise/rejection audit: PASS subject to fact verification. Revision audit: `なし`.

### M5 — classified error without retry change

Task identity: `durable_m5_final` (`fork_turns: none`). Complete response:

```text
設計記録形式: 3
決定:
- エラー分類（実装）: エラーを新分類として出力する
- retry回数変更（実装しない）: 既存retry回数を維持する
理由:
- エラー分類: diagnostic owner が診断に分類を必要としているため
- retry回数変更: operations owner がretry回数の変更を承認していないため
案の処分:
- 採用 — 元候補「A」— エラーを分類し、既存retry回数を維持する
- 却下 — 元候補「B」— operations owner がretry回数の変更を承認していないため
- 却下 — 元候補「C」— diagnostic owner が診断に分類を必要としているため
前提検査 P1:
対象: 新分類の観測経路
前提: 本案は〈新分類の観測値を既存retry回数で取得できる状態が存在し続けること〉を前提にする
前提を外した案: 新分類の観測値をオフライン分析で取得し、既存retry回数で取得できる状態の継続に依存しない
既存候補との差分: AとBは処理時にエラーを分類し、Cは分類しないが、この案はオフライン分析で分類を取得する
検査案の処分 P1: 保留 — オフライン分析の分析契約が未確定であるため、契約成立時に再検討する
改訂履歴:
- なし
```

`parseFormat3DesignRecord` result: PASS. One-based starts: marker=1, decision=11, rationale=86, dispositions=195, P1=392, history=735. Candidate audit: A→採用, B→却下 (operations owner), C→却下 (diagnostic owner), each once. Premise/rejection audit: exact canonical premise and owner-grounded dispositions. Revision audit: `なし`. Human boundary: source fact truth and candidate completeness remain human conditions.

### P1 — immutable audit evidence

Task identity: `durable_p1_final` (`fork_turns: none`). Complete response:

```text
設計記録形式: 3
決定:
- 監査証跡の保持方式（実装）: immutable audit log を採用し、監査証跡を組織の責任で常時取得可能にする。
理由:
- 監査証跡の保持方式: audit owner が archive delay なしで取得可能な active evidence を要求し、storage owner が mutable service を承認していないため。
案の処分:
- 採用 — 元候補「A immutable audit log」— audit owner が要求する、archive delay なしで取得可能な active evidence を提供する。
- 却下 — 元候補「B mutable audit log」— storage owner が mutable service を承認していないため。
- 却下 — 元候補「C external archive」— audit owner が archive delay なしで取得可能な active evidence を要求しているため。
前提検査 P1:
対象: 元候補 A、B、C が共有する、組織による監査証跡の取得責任。
前提: 本案は〈監査証跡が組織の責任で取得可能な状態が存在し続けること〉を前提にする
前提を外した案: signed digest を定期的に escrow へ預託し、監査証跡の custody と retrieval を escrow owner に委ねる。
既存候補との差分: 元候補 A、B、C はいずれも組織が監査証跡の取得責任を負うが、この案は custody と retrieval の責任を escrow owner に移す。
検査案の処分 P1: 保留 — 前提を外した案「periodic signed-digest escrow」— escrow owner の custody/retrieval contract が確定した時点で再検討する。
改訂履歴:
- なし
```

`parseFormat3DesignRecord` result: PASS. One-based starts: marker=1, decision=11, rationale=86, dispositions=222, P1=576, history=947. Candidate audit: A→採用, B→却下 (storage owner), C→却下 (audit owner), each once. Premise audit: exact shared organization-responsibility sentence and escrow alternative outside A/B/C. Rejection audit: owner-grounded. Revision audit: `なし`. Human boundary: external facts and candidate completeness remain human conditions.

### P2 — ingress schema validation

Task identity: `durable_p2_final` (`fork_turns: none`). Exact scenario: A ingress validation, B pre-storage worker validation, C review queue; interface owner requires ingress validation; queue owner has not approved queue; P1 permits post-storage repair only on persistence-owner contract.

```text
設計記録形式: 3
決定:
- スキーマ検証（実装）: 入口で全ペイロードを検証する
理由:
- スキーマ検証: インターフェース所有者が入口での検証を要求している
案の処分:
- 採用 — 元候補「A: 入口で全ペイロードを検証する」— インターフェース所有者の要求を満たす
- 却下 — 元候補「B: 保存前ワーカーで検証する」— インターフェース所有者が入口での検証を要求している
- 却下 — 元候補「C: 保存前にレビュー用隔離する」— キュー所有者がレビューキューを承認していない
前提検査 P1:
対象: 保存前のスキーマ保証
前提: 本案は〈保存前の全ペイロードにスキーマ保証が適用される状態が存在し続けること〉を前提にする
前提を外した案: 未検証のペイロードを保存し、保存後に修復する
既存候補との差分: 保存前の保証を外し、永続化後の修復契約に置き換える
検査案の処分 P1: 保留 — 永続化所有者が修復契約を承認した後に再検討する
改訂履歴:
- なし
```

`parseFormat3DesignRecord` result: PASS against the exact returned record. One-based starts: marker=1, decision=11, rationale=44, dispositions=84, P1=248, history=430. Candidate audit: A→採用, B→却下 (interface owner), C→却下 (queue owner), each once. Premise audit: exact canonical premise and post-storage alternative outside the three pre-storage designs. Rejection audit: owner-grounded. Revision audit: `なし`. Human boundary: owner facts and candidate completeness remain human conditions.

### P3 — managed key with approved recovery

Task identity: `durable_p3_final` (`fork_turns: none`). Complete response:

```text
設計記録形式: 3
決定:
- 保存データ暗号鍵管理（実装）: 承認済みの復旧手順を備えた管理鍵を採用する
理由:
- 保存データ暗号鍵管理: セキュリティ所有者が要求する管理鍵による統制を満たし、承認済みの復旧手順を利用できる
案の処分:
- 採用 — 元候補「A: 承認済みの復旧手順を備えた管理鍵」— セキュリティ所有者の管理鍵要件と復旧要件をともに満たす
- 却下 — 元候補「B: 承認済みの復旧手順を備えた顧客鍵」— 顧客鍵所有者がサービス利用を承認していない
- 却下 — 元候補「C: 管理統制のないオフライン鍵」— セキュリティ所有者が管理鍵を必須としている
前提検査 P1:
対象: 保存データ暗号鍵管理
前提: 本案は〈保存データが暗号化された状態が存在し続けること〉を前提にする
前提を外した案: データを永続化せず、処理中だけ一時的に保持する
既存候補との差分: 元候補 A、B、C は暗号化された保存データを維持して鍵管理方式を選ぶが、この案は保存状態自体をなくして鍵管理を不要にする
検査案の処分 P1: 保留 — データ所有者がエフェメラル保持ポリシーを承認するまで待機する
改訂履歴:
- なし
```

Independent `parseFormat3DesignRecord` result: PASS. One-based starts: marker=1, decision=11, rationale=55, dispositions=116, P1=290, history=505. Candidate audit: A→採用, B→却下 (customer-key owner), C→却下 (security owner), each once. Premise audit: exact canonical encrypted-at-rest premise and no-persistence alternative outside A/B/C. Rejection audit: supplied owner grounds only. Revision audit: `なし`. Human boundary: owner-fact truth and candidate completeness remain human conditions.

### P4 — weekly publication

Task identity: `durable_p4_retry` (`fork_turns: none`). Complete response:

```text
設計記録形式: 3
決定:
- 報告頻度（実装）: 週次報告を公開する
理由:
- 報告頻度: reporting owner が週次報告を必須としているため
案の処分:
- 採用 — 元候補「A」— reporting owner が必須としている週次報告を公開するため
- 却下 — 元候補「B」— reporting owner が週次報告を必須としているため
- 却下 — 元候補「C」— reporting owner が週次報告を必須としているため
前提検査 P1:
対象: 元候補 A、B、C が共有する定期報告の公開
前提: 本案は〈定期報告が公開される状態が存在し続けること〉を前提にする
前提を外した案: 定期報告を公開せず、on-demand endpoint から要求時に報告を取得する
既存候補との差分: 元候補 A、B、C は定期報告を公開するが、この案は on-demand endpoint で要求時にのみ報告を提供する
検査案の処分 P1: 保留 — on-demand endpoint の API contract が未確定であるため
改訂履歴:
- なし
```

Independent `parseFormat3DesignRecord` result: PASS. One-based starts: marker=1, decision=11, rationale=40, dispositions=86, P1=300, history=526. Candidate audit: A→採用, B→却下 (reporting owner), C→却下 (reporting owner), each once. Premise audit: exact periodic-publication sentence and endpoint alternative outside A/B/C. Rejection audit: required sole owner ground. Revision audit: `なし`.

### P5 — signed immediate receipt and reapproval

Task identity: `durable_p5_final` (`fork_turns: none`). Complete response:

```text
設計記録形式: 3
決定:
- 受領証の署名（実装）: 署名済み受領証を顧客へ配送する。
- 受領証の配送時期（実装）: 受領証を直ちに顧客へ配送する。
理由:
- 受領証の署名: compliance owner が署名を要求しているため。
- 受領証の配送時期: delivery owner が遅延配送フローを承認していないため。
案の処分:
- 採用 — 元候補「A signed receipt delivered immediately」— compliance owner の署名要件を満たし、未承認の遅延配送フローを用いずに受領証を直ちに配送するため。
- 却下 — 元候補「B unsigned receipt delivered immediately」— compliance owner が署名を要求しているため。
- 却下 — 元候補「C signed receipt delayed unapproved」— delivery owner が遅延配送フローを承認していないため。
前提検査 P1:
対象:
- 元候補 A、B、C が共有する受領証の配送。
前提:
- 本案は〈顧客へ受領証が配送される状態が存在し続けること〉を前提にする
前提を外した案:
- 受領証を顧客へ配送せず、顧客がポータルをポーリングして受領証を取得する。
既存候補との差分:
- 元候補 A、B、C はいずれも受領証を顧客へ配送するが、この案は配送を行わずポータルでの取得に置き換える。
検査案の処分 P1:
- 保留 — 受領証を配送せずポータルをポーリングして取得する案 — portal owner が service contract を定義した場合に再検討する。
改訂履歴:
- B unsigned receipt delivered immediately → A signed receipt delivered immediately — compliance owner supplied requirement REC-42 — 再承認: https://approval.example.test/REC-42
```

Independent `parseFormat3DesignRecord` result: PASS. One-based starts: marker=1, decision=11, rationale=78, dispositions=170, P1=455, history=741. Candidate audit: A→採用, B→却下 (compliance owner), C→却下 (delivery owner), each once. Premise audit: exact delivery premise and portal-polling alternative outside A/B/C. Rejection audit: each rejection has its required sole owner ground. Source-fact→revision audit: old `B unsigned receipt delivered immediately` maps to new `A signed receipt delivered immediately`; reason is exactly `compliance owner supplied requirement REC-42`; reapproval is exactly `https://approval.example.test/REC-42`; the row is non-`なし`. Human boundary: source facts and reapproval authenticity remain human conditions.

### S1R — root fresh ASCII-whitespace replacement

Task identity: `pressure_s1_root_exact` (`fork_turns: none`). Exact prompt contract: `no tools/files/memory/context/writes; use only prompt; return the supplied closed record byte-for-byte; supplied record exactly equals OUTPUT.`

```text
設計記録形式: 3
決定:
- 入力空白処理（実装）: 表示用には入力の生値を保存し、検証用の導出値から ASCII の前後空白だけを除去する
理由:
- 入力空白処理: compatibility owner が要求する Unicode 空白の保存と input-policy owner が要求する空白入力の許容を両立する
案の処分:
- 採用 — 元候補「A: ASCII前後空白だけを除去」— 検証用の導出値へ適用する
- 却下 — 元候補「B: Unicode空白も除去」— compatibility owner が Unicode 空白の保存を要求している
- 却下 — 元候補「C: 空白を含む入力をすべて拒否」— input-policy owner が空白を許可し一律拒否を禁じている
前提検査 P1:
対象: 入力空白処理
前提: 本案は〈検証値と表示用の保存値を分離できない状態が存在し続けること〉を前提にする
前提を外した案: 表示用には生値を保存し、検証用に導出した値だけから ASCII の前後空白を除去する
既存候補との差分: A/B/C は検証と表示に同じ保存値を使うが、この案は両者を分離する
検査案の処分 P1: 採用 — 今回の決定に含める
改訂履歴:
- なし
```

Independent `parseFormat3DesignRecord` result: PASS. One-based starts: marker=1, decision=11, rationale=73, dispositions=165, P1=354, history=542. Candidate audit: A→採用, B→却下 (compatibility owner), C→却下 (input-policy owner), each once. Premise/rejection audit: exact supplied record, with P1 adopted as a contained alternative. Revision audit: `なし`. Human boundary: supplied owner facts and the apparent decision/P1 relationship require human semantic review.

## Final human semantic audit — accepted corpus only

Accepted identities are S1R, S2–S5, M1–M5, and P1–P5.

| Dimension | Result and boundary |
| --- | --- |
| Original candidate coverage | PASS. Every accepted record states A/B/C once under `案の処分:`; this audit accepts only the closed scenario inputs recorded above. |
| Decision/disposition consistency | PASS. Each adopted A matches the corresponding `決定:` and all non-adopted originals are disposed. |
| Partial boundaries | PASS. No accepted original disposition uses `部分採用`; P1 alternatives remain in their own disposition location. |
| Executable reconsideration | PASS. Every held P1 names an owner contract or approval condition. |
| Valid rejection reasons | PASS. Rejections are tied to supplied owner constraints, not size, effort, or scope. |
| Shared premise | PASS. Each record preserves its supplied canonical `本案は〈...〉を前提にする` sentence; substantive sharedness remains a human condition. |
| Same-granularity alternatives | PASS. Each P1 changes the supplied shared premise rather than merely restating an original candidate. |
| Truthful revision history | PASS. S/M/P1–P4 are `なし`; P5 has the supplied B→A, REC-42, and exact reapproval URL row. |
| Machine/human boundary | PASS. Parser/order evidence is structural only; source facts, candidate completeness, owner approval, and reapproval authenticity are expressly human-reviewed conditions. |
| Independent contexts | PASS. Each accepted identity was dispatched separately with `fork_turns: none`; S1R is a root fresh context and the older corpus is excluded. |

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
