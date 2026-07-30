# 読み手軸 vs 判断軸の比較実験（ADR-0017 追試）

## 目的

「開発者向けの図 / 利用者向けの図」という読み手軸で PFD 種別を切ると、3種別（roadmap / workflow / runtime-pipeline）より価値のある図になるか。
同一ドメインを3通りに分割して、図として何が見えるか・何が見えなくなるかを比較する。

## 題材

`polaris.md` の Polaris（社内プラットフォームSDK提供）を使う。
pfdsl 自身を題材にすると判定基準が pfdsl の事情に引きずられるため、別ドメインかつ第3種別を実際に持つ唯一の仮想プロジェクトを選んだ。

3変種すべてに同じノード在庫（process 17個）を持たせ、差が分割方法だけになるよう揃えている。

| 変種 | 分割軸 | ファイル |
|---|---|---|
| A | 判断の有無（人の営み / 機械の変換） | `pipeline` + `workflow` |
| B | 読み手（開発者 / 利用者） | `dev-pipeline` + `dev-workflow` + `user-pipeline` + `user-workflow` |
| C | 判断の有無で種別、読み手でファイル分割 | `pipeline` + `platform-workflow` + `consumption-workflow` |

変種Bの `user-workflow` と `user-pipeline` が、読み手軸を真としたときに増える「第4・第5のPFD」に当たる。

## プローブノード

軸の妥当性を検証するため、3変種すべてに2つの境界事例を仕込んだ。

- **`draft_migration_guide`** — 判断を含むが担当は LLM エージェント。API差分から移行ガイド草稿を書く。破壊的変更の重大度判断と回避策の提案を含むため、同じ入力から同じ出力が出るとは限らない
- **`transcribe_to_portal`** — 判断は不要だが担当は人。バージョン表を社内ポータルへ写す。ポータルに書き込みAPIがないという境界の問題だけが理由

## 定量結果

境界再宣言 = 他ファイルが生産する artifact を入力として受けるための再宣言数。
ファイル間を手で縫う量に相当する。

| 変種 | ファイル数 | process 総数 | 境界再宣言 |
|---|---|---|---|
| A | 2 | 17 | 3 |
| B | 4 | 17 | 8 |
| C | 3 | 17 | 8 |

読み手軸（B）は判断軸（A）の 2.7 倍の縫い代を要する。
Cも同じ縫い代だが、増えた5件はすべて workflow 内の platform / consumption 分割によるもので、パイプラインの背骨は無傷のまま残る。

## 図としての所見

### 変種A

`pipeline` は OpenAPI 仕様から消費チームのサービスビルドまでが1本の背骨として通り、group が 一次ソース → 中間生成物 → 配布物 → 消費チームの環境 → 社外が読む面 という進行になる。
素材が利用者の手元に届くまでの全変換段数が一目で数えられる。

`workflow` は人の判断だけが残るため、フィードバックの3本（起票→リリース判断、起票→採用判断、廃止判断→集計）が同一キャンバスに載る。
組織境界をまたぐループが1枚で見えるのは、この変種だけの利点である。
ただし1種別1ファイル原則でリリース判断と消費チームの利用が同居するため、破線が図の下半分を大きく回り込んでレイアウトが崩れる。
またフィードバックを `>>` で書くと V010 循環エラーになり、`>>?` への書き換えを強制された。
これは欠点ではなく、循環構造を明示させる検査が効いたという意味である。

### 変種B

`dev-workflow` が最も悪い。
生産者を持たない境界スタブが5枚も左端に並び、図が「よそから5つ届いて4つ決める」という判断の受信箱になる。
変換の筋がなく、`release_decision` は後続を持たない終端になるため、リリース判断が何を引き起こすのかを図が示せない。

`dev-pipeline` は5プロセスで読みやすいが、終端が `sdk_packages`（誰も欲しがらない中間物）になる。
終端がファイル境界であって意味の切れ目でないため、「何のための変換か」が図から消える。

`user-pipeline` はよく読めるが、5プロセスのうち `publish_registries` と `transcribe_to_portal` の2つは実行主体がプラットフォームチームである。
「利用者側」というファイル名が5分の2について嘘になる。
読み手と実行主体が分裂する節を、読み手軸は収容できない。

`user-workflow` は変種Bで唯一、単体で筋の通った図になった。
受領物 → 採用判断・障害対応 → フィードバック起票 という消費チームの営みが完結して読める。

### 変種C

Bで唯一よかった `user-workflow` は、実は3種別のまま `consumption-workflow.pfdsl` として書ける。
ADR-0017 は1種別1ファイルを原則としつつ「読み手が完全に別」を分割の例外として既に認めているため、読み手による分割は新種別を作らずに合法である。

変種Cはこれを使い、`pipeline` の背骨を1本に保ったまま workflow だけを読み手で割った。
`consumption-workflow` は変種Bの `user-workflow` に `release_decision` の受領を足したもので、プラットフォームから消費チームへの引き渡しが完全になる。
`platform-workflow` は境界スタブを5枚抱えるが、`from_consumers` group にまとめたため「消費チームから届くもの」という意味のある塊として読める。

## プローブの結論

### 判断が必要だが LLM が担当するもの

**workflow に置く。**
実行主体が人かLLMかは問わず、判断を含むかどうかだけで決める。

変種A・Bはどちらもこれを pipeline 側に置いたが、図の上で `migration_guide_draft` が消費者のない終端として浮いた。
草稿には人のレビューと承認が必要という構造が、pipeline に置くと図から消える。
workflow に置けば `review_migration_guide` → `approved_migration_guide` が現れ、草稿が承認を経ずに利用者へ届かないことが図で保証される。

実行主体は `owner` フィールドで表す（`owner: ドキュメントLLMエージェント`）。
種別で表現する必要はない。

### 判断が不要だが境界の問題で人間が転記するもの

**pipeline に置く。**
判断がないため。

変種Aの `pipeline` では、配布物の右端から社外が読む面へ抜ける唯一の人手ノードとして視覚的に際立った。
機械の変換チェーンの中に人手が1つだけ挟まっている構図がそのまま自動化候補の指摘になっている。
workflow に追い出すと人の営みの中に埋没し、この価値が消える。

変種Bでは `user-pipeline` に置かれるが、実行主体がプラットフォームチームなのでファイル名と矛盾する。

## 結論

読み手軸は種別軸としては採用しない。

1. 縫い代が 2.7 倍になり、その代償で得られる図（`user-workflow`）は既存の3種別でも書ける
2. 変換チェーンを読み手で割ると終端が意味の切れ目でなくなり、`dev-pipeline` / `dev-workflow` のように筋のない図が生まれる
3. 実行主体と読み手が分裂する節（レジストリ公開・ポータル転記）を収容できない

一方で「利用者の地図が欲しい」という要求自体は正当であり、**ADR-0017 が既に持つファイル分割の例外（読み手が完全に別）で満たせる**。
新しい種別も新しい軸も要らない。

### workflow と pipeline を分ける基準

プローブ2件の結果から、基準は**判断を含むかどうかの一点**に絞られる。
実行主体（人・LLM・機械）や決定性は基準にしない。

> **判断・承認・裁量が変換の一部なら workflow。入力が揃えば判断なしに出力が決まるなら pipeline。**

仮想プロジェクト5件で検証した結果、既存設計の分類をすべて再現する。

| プロジェクト | workflow 側 | pipeline 側 |
|---|---|---|
| Polaris | Go/No-go 判断・草稿レビュー・採用判断 | 生成・テスト・パッケージング・公開・依存解決 |
| Zenith | 月次レポートの承認・提出 | GPS生データ→月次レポート |
| Noodle | スプリント・API合意 | レシピ投稿→検索・お気に入り |
| FleetOps | CFP選考・当日運営・事後振り返り（全件） | なし |
| Mentori | 改善サイクル | なし |

第3種別を持たない FleetOps・Mentori について、持たない理由まで説明できる。
どちらも判断が営みの本体だからである。

### 命名への含意

`runtime-pipeline` の `runtime` は、この基準では余計な限定になる。
Polaris の `sdk-build-pipeline` はビルド時であって実行時ではないが、判断を含まないため pipeline に分類される。
`pipeline` への改名は筋が通るが、`type:` の列挙値変更は採用リポに及ぶ破壊的変更であり、実利は名前1語ぶんである。
判断基準の明文化とは独立の決定として扱う。

## 追試: pfdsl 自身の PFD 群を判断軸で描き直す

`pfdsl-redraw/` に `.pfdsl/workflow.pfdsl` と `.pfdsl/runtime-pipeline.pfdsl` を判断軸で組み替えたものを置いた。
process 総数は 35 のまま（22+13 → 16+19）で、発明も欠落もない。

### 移動したもの

`workflow.pfdsl` の 22 プロセスを判断の有無で棚卸しし、6件が pipeline 側へ移った。

| プロセス | 判断 | 移動先 | 理由 |
|---|---|---|---|
| `gen_skill` | なし | pipeline | `make gen-skill`。入力が揃えば出力が決まる |
| `gen_install` | なし | pipeline | `make gen-install`。同上 |
| `gen_plugin` | なし | pipeline | `make gen-plugin`。旧 `assemble_plugin` と統合 |
| `render_previews` | なし | pipeline | `make gen-samples`。同上 |
| `publish_cli` / `publish_libraries` | 判断は版数決定のみ | 分割 | タグを打つ判断は workflow、タグ以降の npm publish は pipeline |
| `publish_ext` | 判断なし＋人手 | 分割 | vsix 生成と marketplace アップロードは判断を含まない |

判断を含むため残ったもの: `discuss` / `draft_adrs` / `draft_proposals` / `maintain_spec` / `maintain_template` / `maintain_samples` / `distill_ops` / `write_examples` / `review_examples` / `write_article` / `file_issues` / `map_deps` / `map_transform_boundaries` / `develop` / `merge_pr` / `update_readme`。
`develop` は LLM エージェントが担当するが判断を含むため workflow に残る（プローブ1の結論の適用）。

### 定量結果

| ファイル | process | edge | artifact |
|---|---|---|---|
| 現行 workflow | 22 | 48 | 44 |
| 描き直し workflow | 16 | 41 | 41 |
| 現行 runtime-pipeline | 13 | 14 | 21 |
| 描き直し pipeline | 19 | 20 | 31 |

### 得られたもの

**二重モデル化が構造的に解消する。**
旧 `runtime-pipeline.pfdsl` の `assemble_plugin` → `plugin_dir` と `workflow.pfdsl` の `gen_plugin` → `plugin_dist` は同一の `make gen-plugin` を別ノードIDで二重に持っていた。
判断軸ではどちらも「判断なし」なので pipeline 側の1ノードに統合される。
`workflow.md` が要求していた4箇所の手作業照合（`distill_ops` 出力・`publish_cli` 入力・`gen_plugin` 入力・`assemble_plugin` 入力）が、`gen_plugin` の入力エッジ1箇所に集約される。
`pfd_lens_agent` / `implementer_agent` が片方の図にしか無かった乖離も、統合により発生しなくなる。

**「公開・配布」group が判断だけに縮む。**
現行は `publish_cli` / `publish_libraries` / `publish_ext` / `gen_install` / `gen_plugin` / `render_previews` の6プロセスが混在していた。
描き直しでは `decide_release`（リリース判断・タグ打ち）と `update_readme` の2つだけになる。
「リリースで人が何を決めるのか」が図から直接読める。

**`upload_vsix` が唯一の人手ノードとして可視化される。**
`manual_no_judgment` タグで赤く描かれ、機械チェーンの中で色として孤立する。
現行では `publish_ext` の description 中の「marketplace.visualstudio.com で .vsix を手動アップロード」という一文に埋もれており、図としては見えていなかった。
判断のない人手はここだけであり、自動化候補が1件に確定する。

### 新しく生じたコスト

**pipeline が3本の独立チェーンを抱える。**
現行 runtime-pipeline は2本（b層の文書変換・g層の配布）だったが、生成チェーン（一次ソース → スキル・plugin・描画物）が加わって3本になる。
3本は互いにエッジで繋がらないため、1枚の図としての凝集度は下がる。

ここで「読み手が完全に別」によるファイル分割が効く候補になる。

- 処理系（`.pfdsl` → 診断・DOT・画像）の読み手は CLI ユーザー・VSCode 拡張ユーザー
- 生成・配布（一次ソース → plugin → 採用リポ）の読み手はメンテナと採用リポ

Polaris では workflow を読み手で割るのが有効だったが、pfdsl では pipeline を割る側に回る。
「pfdsl は開発者と利用者が同一なので読み手分割の恩恵が小さい」という予想は外れており、恩恵はあるが切れ目の位置が Polaris と異なるだけだった。

**workflow の読みにくさは解決しない。**
`distill_ops` が13成果物へ扇状に出る構造は判断軸では動かない（蒸留は判断そのもの）。
描き直し後も workflow は 16 プロセス・41 エッジで、フィードバックの破線が図の下半分を大きく回り込む。
これは軸の問題ではなく `distill_ops` の粒度の問題であり、別途扱う。
