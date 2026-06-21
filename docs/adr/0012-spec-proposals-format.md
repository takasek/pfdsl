# ADR-0012: spec 提案文書の形式と役割

- Status: Accepted
- Date: 2026-06-15

## Context

spec 改版（例: v0.0.6 → v0.0.7）では複数の issue がそれぞれ独立した仕様変更を提案する。
これらを直接 spec.md に統合しようとすると、個別提案の設計判断・影響範囲・ cross-field constraints が統合フェーズに持ち込まれ、外部レビューなしでは見落としが生じる。

v0.0.7 の統合（`integrate_spec`）では Opus 外部レビュー 3ラウンドで 15件の指摘が出た。
うち最重要は「individual proposals では見えない cross-proposal constraints」—— 例えば `command:` フィールドの Artifact 指定禁止は、`command:` proposal 単独では 書かれず、統合時に他フィールドの対称性から発見された。

提案文書の形式とその役割を規約として定めることで、統合フェーズの品質を安定させる。

## Decision

`docs/spec/proposals/<iN>-<topic>.md` を spec 改版サイクルの中間成果物として定める。

### 形式（4セクション必須）

```markdown
# <タイトル> (#N)

## 対象仕様バージョン

vX.X.X → vX.X.Y

## 概要

...

## 仕様変更

### §X.Y <セクション名> への追加/変更

...

## 設計判断

### なぜ...か

...

## 影響範囲

- §X.Y: ...
- checker 実装: ...
- graphviz-exporter: ...
```

### チェックリスト（起草者が確認）

- [ ] 型専用フィールドを追加した場合、逆型指定（例: artifact-only なら Process への指定）の error を制約節と §16 の両方に対称記載した
- [ ] 例示は front matter と フロー edge が self-consistent（metadata フィールドを示す例は対応 edge も明示）
- [ ] 分類規則（例: URL/glob/path 判別）はエッジケースを列挙した
- [ ] 影響範囲に checker・renderer への影響を書いた

### マージ後の扱い

削除しない。`docs/spec/proposals/` に歴史的記録として保持する。
spec §20（変更点リスト）と対になる証跡。

## Rationale

1. **統合時の cross-validation が主仕事**: `integrate_spec` は "貼り合わせ" ではなく
   複数提案の相互参照フェーズ。個別提案が完全であっても、型の対称性・例示の整合・ strict mode 定義の一貫性は統合後にしか検査できない。外部レビューを推奨する。

2. **4セクション構成の根拠**: 概要（what）→ 仕様変更（spec text）→ 設計判断（why）→
   影響範囲（where to implement）の順が、起草・レビュー・実装の3者それぞれにとって 必要な情報を過不足なく提供する。

3. **マージ後に残す根拠**: 統合後の spec は "何が変わったか" のみを示す。
   "なぜその設計判断か" は proposal の設計判断セクションにしか残らない。
   実装者・将来の仕様改訂者が判断根拠を参照できる状態を保つ。

## Consequences

- `draft_proposals` プロセスの output = `spec_proposals`（`docs/spec/proposals/`）。
  ecosystem.pfdsl に明示した（2026-06-15 追記）。
- 次回 spec 改版時はこの ADR のチェックリストを参照する。
- `integrate_spec` description に「外部レビュー推奨」を記載した（ecosystem.pfdsl 参照）。

## References

- `docs/spec/proposals/`（実例: i7-criteria.md, i8-revises.md, i9-no-branching.md, i13-location.md）
- `.pfdsl/ecosystem.pfdsl`（`spec_proposals` artifact、`draft_proposals` / `maintain_spec` process）
- `.pfdsl/ecosystem.md`（spec_proposals ライフサイクル規約）
- ADR-0010（変更ガバナンス経路設計）
