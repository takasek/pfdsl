# retro-pattern カタログ 全件意味監査（2026-08-30）

前回記録からの追加件数が閾値へ達する前に、PR #1040 で実測した誤所属を契機として明示的な全件意味監査を実施した。
監査開始時のカタログは70件、修正後は77件。
独立 reviewer 3名が前半35件・後半35件・全件横断を分担し、定義・所属・検出・対策・境界・タグ・時点・証拠・肥大の9観点を確認した。
finding は concrete failure scenario と file:line を条件に採用し、分割・統合・改訂後に同じ reviewer が再検証した。

## 発火間隔の実測

前回記録は 2026-08-13 で、本日まで17日。
記録 commit 以降の追加は11件で、統合・削除を含む開始時の純増は8件（62件から70件）。
この増加率では閾値20への到達は約31日で、意図する数週間単位の範囲に収まるため閾値20は据え置く。
今回は閾値発火ではなく、意味上の誤分類という実測に基づく明示全件監査である。

## 工程1 — 機械化により廃止できるパターン

廃止0件。
前回以降の scripts・hooks・設定変更を起点に既存パターンを照合したが、対策が機械化され trap が構造的に不可能になったものは無かった。
guard や gate が一部経路を塞ぐパターンは残るが、許可分岐・対象外コマンド・人手判断・古い実体を読む経路が残るため、部分機械化を廃止根拠にしなかった。

## 工程2 — 近接ペアの統合

`duplicate-self-check-tool` の空間的な二重実体は、名前・番号が実体の判別子にならないという問いと対策が `duplicate-name-not-a-discriminator` と一致するため統合した。
`duplicate-self-check-tool` に混在していた着手時の古い checkout と作業中の base 進行は時間軸と最終有効時点が異なるため、`stale-checkout-runs-old-checker` と `base-advance-stales-late-checker` へ分割した。
`parallel-delegation-seam` は並行委譲と rebase に共通する unit 間契約を `independent-units-fail-at-seam` へ改称し、外側の記法を例示が閉じる単独編集の failure を `embedded-example-breaks-container-syntax` へ分離した。

## 工程3 — `具体例:` が参照する機構の実在

全件の具体例と名指しされた issue・PR・コマンド・ファイルを監査し、消滅した機構を現在も実在するものとして扱う参照は0件だった。
`cross-issue-enumeration-drift` は導入履歴と issue #650/#654、PR #655 を突合しても実際の drift や誤判断を観測した記録がなく、予防策を入れた実例しか確認できなかったため廃止した。
削除した `duplicate-self-check-tool` への現行ポインタ2件は、具体例の移動先へ更新した。

## 工程4 — `phase: pre-artifact` の宣言

`claim-form-invites-restaleness` は本文自身が retro で事後修正できた実績を持つため宣言を外した。
旧 `duplicate-self-check-tool` の一括宣言は分割し、着手前の checkout 確認だけに付与した。終盤の base 確認は retro 時点でも有効なため宣言を外した。
新規分割では、外部 write の許可、条件付き委譲許可、target 撤去など成果物前にしか間に合わない対策だけへ宣言し、レビュー・実装後にも修正できる重なりテストや表示情報の修正には付与しなかった。

## 工程5 — タグ語彙

`catalog-consulted-after-the-artifact` は具体例由来の `method:count` / `context:stale-tool` を外し、工程配置として常に読む `always` へ変更した。
`verification-scope-misses-symptom` は委譲結果の判断検証にも発火するため `method:delegate` を追加した。
`independent-units-fail-at-seam` は並行委譲と rebase 統合の双方へ届くよう `method:delegate` / `method:unify` / `context:parallel-work` とした。
`removing-target-drops-hidden-role` から trap 自体を表す `context:hidden-dependency` を除き、実施行為である `method:remove` だけを残した。

## 工程6 — 所属と内部論理

| 旧対象 | 該当観点 | finding | 処置 |
|---|---|---|---|
| `brief-assumes-unverified-data-shape` | 所属・肥大 | 未検証のブリーフ仕様と、集合拡張時の A∩B 未検証が混在 | 後者を `expanded-input-set-skips-overlap-case` へ分離 |
| `cross-issue-enumeration-drift` | 証拠 | 具体例がなく観測済み知見か判定不能 | 一次記録にも実際の drift がないため廃止 |
| `catalog-consulted-after-the-artifact` | タグ | タグが発火条件でなく具体例由来 | `always` へ変更 |
| `claim-form-invites-restaleness` | 時点 | retro で修正可能なのに pre-artifact | phase を削除 |
| `duplicate-name-not-a-discriminator` / `duplicate-self-check-tool` | 所属・境界・時点・肥大 | 同一問いの重複と、空間・時間の3 failure 混在 | 空間軸を統合し時間軸を2件へ分割し、終盤の base 確認から phase を外した |
| `flag-scope-bundling` | 所属・肥大 | フラグ束ねと target 撤去時の隠れた役目が混在 | 後者を `removing-target-drops-hidden-role` へ分離 |
| `parallel-delegation-seam` | 所属・肥大 | unit 接合と単独の記法衝突が混在 | `independent-units-fail-at-seam` と `embedded-example-breaks-container-syntax` へ分離 |
| `unmatched-vocabulary-defaults-to-pass` | 所属・肥大 | catch-all の既定と減算表示の情報消失が混在 | 後者を `subtracted-count-hides-its-minuend` へ分離 |
| `unusable-named-means` | 所属・肥大 | 起動不能、条件付き許可、外部 write 権限、成功したが無効が混在 | 元を委譲固有担保へ限定し、残り3 failure を独立化 |
| `verification-scope-misses-symptom` | タグ | 委譲例へ発火するタグがない | `method:delegate` を追加 |

`absence-search-scope`、`meta-item-hides-subitems` など長いパターンは、追加された各例が同じ検出質問と対策へ戻ることを確認し、肥大だけを理由に分割しなかった。

## 全件判定表

表の各列は工程6の9観点に対応し、「妥当」は finding なし、「修正後妥当」は上の表でその観点に記録した finding を処置した後に再検証したことを表す。
分割・統合では旧対象の finding を、その観点の処置に関与した現行パターンへ引き継いで記録し、影響しなかった観点は「妥当」とする。

| pattern | 定義 | 所属 | 検出 | 対策 | 境界 | タグ | 時点 | 証拠 | 肥大 |
|---|---|---|---|---|---|---|---|---|---|
| `absence-search-scope.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `autostage-collateral-sweep.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `base-advance-stales-late-checker.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 修正後妥当 | 妥当 | 修正後妥当 | 妥当 | 修正後妥当 |
| `brief-assumes-unverified-data-shape.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 |
| `canonical-record-frozen-at-draft.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `catalog-consulted-after-the-artifact.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 |
| `check-input-outside-its-rerun-trigger.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `check-materials-cannot-make-the-distinction.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `chronic-false-positive-silencing.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `claim-form-invites-restaleness.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 | 妥当 | 妥当 |
| `conditional-permission-misread-as-prohibition.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 |
| `convention-order-inverts-under-delegation.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `correct-finding-unverified-fix.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `declaration-content-vs-its-container.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `deletion-leaves-prose-orphaned.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `detection-covers-one-path-only.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `divergent-safety-across-isomorphic-commands.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `duplicate-name-not-a-discriminator.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 |
| `embedded-example-breaks-container-syntax.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 |
| `entry-path-reads-as-out-of-scope.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `environment-classification-hides-recurrence.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `executor-chosen-check-target.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `existential-aggregation-hides-partial-absence.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `expanded-input-set-skips-overlap-case.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 |
| `external-write-authority-boundary.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 |
| `filter-meaning-shifts-under-tool-inference.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `findings-split-below-triage-unit.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `firing-condition-conflated-with-weight.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `flag-scope-bundling.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 |
| `gate-identification-vs-convention-mismatch.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `generalization-drops-the-qualifier.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `implementation-diverges-from-approved-option.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `implicit-environment-assumption.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `incidental-resolution-open-issue.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `independent-solve-brief-points-at-the-answer.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `independent-units-fail-at-seam.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 |
| `indirect-test-input-bias.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `inherited-solution-space.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `interface-schema-does-not-prove-target-reachability.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `interrupted-delegate-leaves-applied-changes.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `invariance-claim-unverified-across-the-operation.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `isolation-does-not-cover-shared-scratch.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `isomorph-by-shape-not-by-question.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `isomorph-count-unit-mismatch.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `manual-enumeration-check-target.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `meta-item-hides-subitems.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `named-remedy-does-not-produce-effect.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 |
| `observation-frame-beyond-the-reporter-tools.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `observed-symptom-vs-inferred-cause.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `one-sided-delegation-brief.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `output-verb-subject-mismatch.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `overclaiming-beyond-measurement.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `partial-fix-sweep.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `pr-scope-creep-after-open.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `promoted-rule-invalidates-a-feature.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `rationale-cites-unverified-mechanism.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `record-timing-anchor-vs-work-unit.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `removing-target-drops-hidden-role.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 |
| `review-baseline-drifts-to-branch-interior.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `rule-exempts-its-own-counterexamples.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `self-referential-check.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `shared-helper-filter-set-by-first-consumer.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `shared-worktree-interference.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `shipping-with-surviving-rejected-option.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `stale-checkout-runs-old-checker.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 |
| `stale-root-cause-diagnosis.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `stale-window-external-artifact-survives-rebase.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `subtracted-count-hides-its-minuend.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 |
| `success-output-does-not-prove-persisted-body.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `symmetrization-duplicates-defect.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `type-width-vs-consumer-assumption.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `unmatched-vocabulary-defaults-to-pass.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 |
| `unusable-named-means.md` | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 |
| `unverified-input-schema-yields-valid-empty-result.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `unverified-precedent-style.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `verification-ran-in-another-tree.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 |
| `verification-scope-misses-symptom.md` | 妥当 | 妥当 | 妥当 | 妥当 | 妥当 | 修正後妥当 | 妥当 | 妥当 | 妥当 |

## 検査と責務境界

`node scripts/retro-patterns.mjs check` は77ファイルの解析・ファイル名・タグ・round-trip・コマンド例の構造を検査した。
`node scripts/check-asset-sweep.mjs` は記録 commit 以降の追加件数だけを判定する。
これらの機械検査は意味上の所属を証明せず、上の9観点と独立 reviewer の concrete failure scenario が意味判断を担う。
