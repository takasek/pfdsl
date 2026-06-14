# ADR-0013: v0.0.8 はツールチェーン実装後に統合する

- Status: Accepted
- Date: 2026-06-15

## Context

spec v0.0.7 の策定中に、v0.0.8 候補（マルチファイル意味論: #5 階層 PFD、#6 共有プリセット）の
スコープを決める必要が生じた。当初 plan.pfdsl では v0.0.7 に #5/#6 も含まれていたが、
設計複雑度と依存構造を踏まえて延期した。

延期後の問題: マルチファイル仕様（i5/i6 提案 + multifile_policy）は
v0.0.7 実装済みツールチェーン（#52: i52_featured_toolchain）の完成を待つべきか、
あるいは並列に仕様起草できるか。

## Decision

`integrate_multifile`（マルチファイル仕様統合→ spec_v008）の入力に
`i52_featured_toolchain` を含める。

```
[i5_hierarchy_spec, i6_presets_spec, multifile_policy, i52_featured_toolchain]
  >> integrate_multifile -> spec_v008
```

これにより、spec v0.0.7 のツールチェーン実装（#52）が完了するまで
spec v0.0.8 の統合フェーズには着手できない。

提案起草（`draft_multifile_specs`）は依然として並列着手可能
（入力 `spec_v006` は done）。

## Rationale

1. **実装が仕様の盲点を露出する**: v0.0.7 で追加した 4フィールド
   （criteria/location/command/revises）をツールチェーンに実装する過程で、
   cross-file 文脈でのフィールド解釈（例: `location:` のパス解決、
   `revises:` のクロスファイル参照）の設計課題が浮かぶ可能性が高い。
   この実装経験なしにマルチファイル仕様を統合すると、v0.0.7 フィールドとの
   相互作用に設計漏れが残る。

2. **マルチファイルは全フィールドとの整合が必要**: 階層 PFD（#5）や共有プリセット（#6）は
   ID スコープ・継承解決順・ファイル間参照を定義する。これらが v0.0.7 の
   `location:` パス解決規則（`://` / glob / ファイルパス分類）や
   `revises:` の同一ファイル限定制約と整合するかは、実装後にしか検証できない。

3. **起草は先行できる**: `i5_hierarchy_spec` / `i6_presets_spec` / `multifile_policy` の
   起草自体は `spec_v006` だけで開始できる。実装待ちは「統合（integrate_multifile）」
   だけであり、起草の並列進行を妨げない。

## Consequences

- `draft_multifile_specs` は今すぐ着手可能（入力 `spec_v006` done）。
- `integrate_multifile` は `i52_featured_toolchain` 完了まで着手不可。
- 将来 v0.0.7 実装中に `location:` / `revises:` のマルチファイル意味論に関する
  設計判断が出た場合は、ADR 化して `multifile_policy` へ反映する経路が存在する。

## References

- `.pfdsl/plan.pfdsl`（integrate_multifile フローライン）
- ADR-0010（変更ガバナンス経路設計）
- issue #5（階層 PFD）、#6（共有プリセット）、#52（v0.0.7 実装）
- `docs/spec/proposals/i13-location.md`（location: クロスファイル注記）
- `docs/spec/proposals/i8-revises.md`（revises: 同一ファイル限定の根拠）
