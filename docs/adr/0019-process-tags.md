# ADR-0019: tags はノード横断ラベル — 両種別対象 + `tag:` 定義ブロック

- Status: Accepted
- Date: 2026-06-20

## Context

#5/#6 のマルチファイル設計対話で、似た構造の Process を再利用する「subroutine」的機構が
検討され**却下**された（清水DFD の 1:1 leveling から逸脱し、図の「現実の地図」性を損ない、 安価な境界チェックを複雑化する — ADR-0004 のプロセス粒度基準と衝突）。軽量な代替として、 構造・性質を共有するノードを **共通タグで束ねる** 方針が出た（issue #127）。

当初 #127 は「Process にも `tags:` を許可する」という小さな変更として起票された。しかし レビューで2つの過小設計が露見した:

1. **意味の不要な限定**: tags の本質は「ノードへ横断的な性質ラベルを付ける」ことで、これは
   Artifact でも Process でも等しく成り立つ（"external" な成果物群、"audited" な工程群）。
   「Process 族の subroutine 代替」は tags の *一用途* であって *定義* ではない。
   v0.0.7 では `tags` を Artifact 専用と明記していたが、これは過剰な限定だった。
2. **タグ定義の住処**: タグの「意味」（label / description）を置く場所が front matter に無く、
   companion `.md` への散文外化に頼っていた。一方 `tagStyles` はスタイルだけを別トップレベル キーで持ち、タグ定義が2箇所（散文 + tagStyles）に分散していた。

## Decision

`tags` を **Artifact / Process 両方**の横断ラベルとして正式化し、front matter トップレベルに **`tag:` 定義ブロック**を新設する（`artifact` / `process` / `group` と同階層）。

```yaml
tag:
  external:
    label: 外部公開
    description: 外部に公開・提供される成果物・工程
    style: { color: blue }
```

- タグごとに `label` / `description` / `style` を宣言できる（すべて省略可）。
- `tag` 宣言は任意。ノードは未宣言タグも使える（自由ラベル性を維持）。宣言すると意味と見た目が紐づく。
- 既存の **`tagStyles` トップレベルキーは廃止**し、`tag.<id>.style` に統合する（v0.0.6 非互換）。
- `status` は Artifact 専用のまま据え置く（Process は進捗状態を持たない）。`statusStyles` は存続。

## Rationale

1. **`group` との対称性**: `group` は Artifact / Process 双方に付与でき、`label` + `color` を
   1ブロックに持つ。`tag` も両種別対象とし、`label` / `description` / `style` を1ブロックに 集約することで、ノード横断メタデータの語彙が直交して並ぶ（group=単一所属/領域分割、 tag=多重付与/横断ラベル）。issue #127 の「parallel to group §2.8」を全面的に満たす。

2. **タグ定義の一元化**: 「意味」と「見た目」が `tag.<id>` に集まり、散文（companion .md）や
   別キー（tagStyles）への分散が解消する。タグの見通しが上がる（#127 レビューでの発見）。
   companion `.md` は本当に長い運用知識がある時だけに退く。

3. **自由ラベル性の保持**: `tag` 宣言を任意にすることで、未宣言タグの利用（現行の自由ラベル）を
   壊さない。`group` の未定義参照が無視されるのと対称。

4. **status を据え置く理由**: status は成果物の生成状態を表す閉じた列挙で、変換そのものである
   Process には意味を持たない。宣言可能な自由ラベルである tag とは性質が異なるため、`status:`
   定義ブロックは作らず `statusStyles`（列挙キー）のまま残す。

5. **破壊的変更を許容する理由**: 本リポは pre-1.0（v0.0.x）で `tagStyles` 利用は少数
   （リポ内は roadmap.pfdsl とサンプル1件）。互換エイリアスを残すより一元化を優先し、 §20 変更点に非互換を明記して移行する。

## Consequences

- spec v0.0.7（wip・未リリース）を in-place 改訂: §2.2 キー表に `tag` 追加・`tagStyles` 削除、
  §2.7 を status（Artifact 専用）/ tags（両種別）/ statusStyles / `tag` 定義 / 適用順に再構成。
- 実装: `frontmatter.ts` に `TagMeta` と `Frontmatter.tag` を追加し `tagStyles` を削除、
  `ProcessMeta.tags` を追加、validator の V009 を `tag.<id>.style` 検証へ、graphviz-exporter の `resolveStyleAttrs` / `buildXlabel` を両種別 + `tag.style` 対応に、metadata-exporter の Process tags 出力を有効化。
- リポ内 `tagStyles` 利用（`.pfdsl/roadmap.pfdsl`、`docs/samples/06-status-styles.pfdsl`）を
  `tag:` ブロックへ移行。
- pfdsl スキル品質ガイドに「Process 族は subroutine でなく tag で束ねる」蒸留を追加（tags は
  両種別対象である旨も明記）。
- マルチファイル presets 設計（i6-presets.md / multifile-policy.md）の共有可能キー列挙を
  `tagStyles` → `tag` に更新（integrate_multifile が消費する前提資料の整合）。

## References

- issue #127（spec: allow tags: on Process）
- spec.md §2.2 / §2.7 / §20
- `packages/core/src/types/frontmatter.ts`（`TagMeta` / `Frontmatter.tag` / `ProcessMeta.tags`）
- `packages/core/src/validator.ts`（V009 → `tag.<id>.style`）
- `packages/graphviz-exporter/src/index.ts`（`resolveStyleAttrs` / `buildXlabel`）
- `packages/metadata-exporter/src/index.ts`（Process tags 出力）
- ADR-0004（プロセス粒度 — subroutine が逸脱する 1:1 leveling）
- ADR-0008（グループは存在様式で切る — group の両種別対象性）
