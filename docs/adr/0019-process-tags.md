# ADR-0019: tags は Artifact / Process 両方に許可 — subroutine の代替

- Status: Accepted
- Date: 2026-06-20

## Context

#5/#6 のマルチファイル設計対話で、似た構造の Process を再利用する「subroutine」的機構が
検討され**却下**された（清水DFD の 1:1 leveling から逸脱し、図の「現実の地図」性を損ない、
安価な境界チェックを複雑化する — ADR-0004 のプロセス粒度基準と衝突）。

軽量な代替として、複数の Process が構造・振る舞いを共有するとき **共通タグで束ね**、
その族に関する共有知識を companion `.md`（`roadmap.md` / `workflow.md` と同じパターン）に
外化する方針が出た。グラフは各 Process を独立ノードとして忠実な地図のまま保ち、
共有知識は散文へ逃がす。

しかし v0.0.7 では `tags` を **Artifact 専用**フィールドと明記していた
（§2.7「対象は Artifact のみ」、§20 変更点に「`status` / `tags` が Artifact 専用」）。
一方で checker は Process の `tags:` を de-facto で受理していた（index signature 経由、error なし）。
spec の文面と実装の挙動が乖離し、上記の運用規約は spec の裏付けを欠いていた。

## Decision

`tags` を **Artifact / Process の両方**に許可する（`group` §2.8 と対称）。`status` は
Artifact 専用のまま据え置く（Process は進捗状態を持たない）。

- 型: `ProcessMeta` に `tags?: string[]` を第一級フィールドとして追加。
- 可視化: `tagStyles` を Artifact / Process いずれの node にも適用する。xlabel も Process の
  tags を表示する。status 由来の `statusStyles` は引き続き Artifact のみ。
- spec: §2.3 / §2.7（見出し・前文・§2.7.2・§2.7.4）を改訂。§20 変更点を訂正。

## Rationale

1. **`group` との対称性**: `group` は Artifact / Process 双方に付与でき、可視化で両者を
   クラスタ化する。tags も「ノードを横断的にラベル付けする」同種の語彙であり、片方だけ
   Artifact 限定にする非対称は語の直交性を損なう。issue #127 が「parallel to group §2.8」と
   述べた通り、両種別対象が自然な読み。

2. **subroutine 却下の受け皿**: Process 族の共有知識を外化する規約は tags が Process に
   付けられて初めて spec の裏付けを得る。図の忠実性（1 Process = 1 node）を保ちつつ
   再利用の意図を表現する唯一の手段。

3. **文面と挙動の一致**: checker は既に Process tags を受理していた。spec を実装に合わせる
   ことで「de-facto 許可だが spec 非公認」という乖離を解消する。

4. **status を据え置く理由**: status（todo/wip/done/blocked）は成果物の生成状態を表す概念で、
   変換そのものである Process には意味を持たない。tags（自由ラベル）とは性質が異なるため、
   対称化の対象は tags のみとする。

## Consequences

- spec v0.0.7（wip・未リリース）を in-place で改訂。§20 の「Artifact 専用」記述を
  status 限定に訂正し、tags 両種別許可の行を追加した。
- `ProcessMeta.tags` 追加、graphviz-exporter の `resolveStyleAttrs` / `buildXlabel` を
  両種別対応に、metadata-exporter の Process tags 出力を有効化した。
- Process 族を tag で束ね共有知識を companion `.md` に外化する運用が spec 上可能になった
  （#127 の動機）。具体的な族の運用規約は各リポの companion で定義する。
- pfdsl スキル品質ガイドに「Process 族は tag で束ね共有知識を companion へ外化する」旨の
  蒸留を検討する（ADR README の受理時蒸留判定）。

## References

- issue #127（spec: allow tags: on Process）
- spec.md §2.3 / §2.7 / §20
- `packages/core/src/types/frontmatter.ts`（`ProcessMeta.tags`）
- `packages/graphviz-exporter/src/index.ts`（`resolveStyleAttrs` / `buildXlabel`）
- `packages/metadata-exporter/src/index.ts`（Process tags 出力）
- ADR-0004（プロセス粒度 — subroutine が逸脱する 1:1 leveling）
- ADR-0008（グループは存在様式で切る — group の両種別対象性）
