# ADR-0023: L4 companion から配布層への昇格経路

- Status: Accepted
- Date: 2026-07-03

## Context

pfd-ops のアーキテクチャ（`references/architecture.md`）は L1（汎用プロトコル）〜L4（リポ固有 companion）の層で構成され、
L1〜L3 は skill sync で採用リポに配布されるが、L4 companion は配布されない。

pfd-retro の出力表は findings の宛先をほぼすべて companion（L4）に向けていた。
その結果、汎用的な運用知見が L4 に滞留し、採用リポに永久に届かない構造欠陥があった。
2026-07-03 のスキル群設計レビューで実例を複数検出した:

- workflow.md「develop 着手時の todo→wip 更新」— PFD 概念だけで導ける L1 相当のルール
- workflow.md「hotfix 運用（issue 省略）」「flow:exempt の roadmap 追加除外」— GitHub Issues バックエンド汎用の L3 相当ルール
- roadmap.md の close 降格ゲート — L3 reference の規約の再掲

retro には D 層「知識成果物のライフサイクル」監査があるが、
「companion に書かれた知見が汎用かどうか」を問う項目が無く、滞留は検出されないままだった。

## Decision

pfd-retro の D 層に **L4 滞留監査** を追加する:

> companion のルールのうち固有名詞（リポ名・パッケージ名・ツール名・パス）を含まないものは汎用ルールの疑いがある —
> 配布層（L3 reference / スキル SKILL.md 本文）への昇格候補として検出する。

昇格の宛先判定は architecture.md の層定義に従う:
PFD 概念だけで導けるルールは L1（SKILL.md 本文）、
特定バックエンド流儀に属すルールは L3（references/）、
リポ固有の値・経路を含むものだけが L4 に残る。

## Rationale

1. **固有名詞テストは機械的に適用できる**: 「このルールからリポ名・パス・ツール名を消しても意味が立つか」は文面だけで判定でき、セッション文脈を要しない。
   retro D 層の他項目（列挙ドリフト・同期在庫）と同じ性質。
2. **滞留は自然発生する**: retro の出力表が companion を既定宛先にする以上、汎用知見も最初は L4 に書かれる。
   これ自体は正しい（発見時点では汎用性が未確定）。
   問題は昇格の再点検が無いことなので、書き込み規則でなく監査項目で解決する。
3. **配布価値の回収**: L4 滞留知見は上流リポでは機能するため、上流の運用だけ見ていると欠陥が見えない。
   採用リポの視点を持つ監査項目が必要だった。

## Consequences

- pfd-retro SKILL.md の D 層に「L4 滞留監査」を追加した。
- 今回検出した滞留実例（todo→wip・hotfix 運用・flow:exempt 除外等）の実際の昇格は、個別に文面の汎用化を要するため本 ADR のスコープ外とし、次回以降の retro で順次昇格する。

## References

- pfd-retro `SKILL.md`（D 層「L4 滞留監査」）
- pfd-ops `references/architecture.md`（層定義と配布可能性）
- ADR-0016（install/ 集約 — 配布ファイルの canonical 管理）
- `.pfdsl/workflow.md`（滞留実例の現在の所在）
