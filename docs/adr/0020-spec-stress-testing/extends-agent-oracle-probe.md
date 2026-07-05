# extends 意味論の agent オラクルプローブ（sonnet/haiku モデル勾配）

ADR-0020 の付随資料（第4弾）。`subflow-agent-probe.md`（第3弾）が subflow の実書き・意味保存型プローブだったのに対し、本ログは `extends:`（プリセット継承、§2.9.4 / §2.9.5 / §15.12）をオラクル型で検証する。spec-stress-test スキル フェーズ2の初回実運用（issue #304）を兼ねる。

**実験プロトコル**（`subflow-agent-probe.md` を踏襲）:

- 被験者: sonnet / haiku subagent（general-purpose、独立コンテキスト）— モデル勾配プローブ
- 入力制限: `docs/spec/spec.md` のみ読可。docs/adr・samples・packages・skills・.pfdsl の参照禁止。CLI 実行禁止
- 出力: 各ケースの予測・根拠節・手トレース・曖昧点・確信度（高/中/低）の自己申告
- 採点: 実 CLI + spec §2.9.4 アルゴリズムの忠実再現スクリプトで正解を事前確定

**正解確定の方法**（このプローブ固有の注記）: `pfdsl check` は `extends:` について V026（missing）/ V027（circular）/ V028（プリセット汚染）の3エラーのみを報告し、**深マージ後の実効値（statusStyles/tag の解決結果）はどの CLI コマンドの出力にも露出しない**（詳細は「メタ発見」節）。そのため C1–C4 の正解は `@pfdsl/core` の `resolvePresentation` / `collectExtendsRefs` / `resolveRefPath` を直接呼び、§2.9.4 のアルゴリズム記述（`resolve(Pi) = resolve(Pi の extends) してから Pi ローカルで上書き`）を忠実再現したスクリプトで確定した。C5（プリセット汚染）のみ `pfdsl check` の実行結果で確定。

---

## オラクル5ケース

| Case | 内容 | 正解 |
|---|---|---|
| 1 | 深マージの兄弟属性保持（`done.fillcolor` のみ上書き、`fontcolor` 継承） | pass, done={fillcolor:#2196F3(ローカル), fontcolor:#FFFFFF(プリセット)} |
| 2 | diamond（`A extends [B,C]`、B・C とも `extends D`） | pass, done={fillcolor:#FF0000(c2-c 由来、後勝ち), fontcolor:#EEEEEE(d 由来、両経路保持)} |
| 3 | 多段 + 配列優先順位（`extends:[p1,p2]` + ローカル、p1 は基底を extends） | pass, done={fillcolor:#333333(p2), fontcolor:#FFFFFF(ローカル)} |
| 4 | `tag.<id>.<field>` 部分上書き（style のみ上書き、label/description 継承） | pass, tag.urgent={label/description 継承, style.color=orange(ローカル), style.penwidth 継承} |
| 5 | プリセット汚染（`layout:` 混入） | **error V028** |

## 結果

**sonnet**: 5/5 正解、全問確信度「高」。**haiku**: 5/5 正解、全問確信度「高」。両者ともモデル間で差が出ず、`extends:` の深マージ規則は haiku 級の精読者にも安全に委譲できる（`subflow-agent-probe.md` 実験Dの haiku 5/5 と同様の結果）。

## 被験者が独立に申告した曖昧点

1. **`tag.<id>.style.<属性>` の深マージ粒度が明文化されていない**（sonnet・haiku 両者が指摘）。§2.9.4 は「`tag.<id>.<field>`（label / description / style）に再帰適用される」と書くが、`style` フィールド自体が単一の `<field>` としてブロック単位で置換されるのか、内部の `color` / `penwidth` までさらに属性単位で深マージされるのかは字義上一意でない。両者とも `statusStyles.<status>.<attr>` との対称性から属性単位マージと推論し正答したが、これは類推であり spec の直接規定ではない。
2. **diamond の「値が実際に衝突する」worked example が spec に無い**（haiku が指摘）。§2.9.4 の diamond 節は解決の決定性のみを述べ、具体値の worked example を伴わない。本プローブの Case 2 も B・C 経由の `fontcolor` が偶然同値になり、「衝突が解消される」場面を実地検証できなかった（出題設計上の限界）。
3. **`resolve()` の返り値の形式的完全性が未定義**（haiku が指摘）。「resolve(Pi) を深マージする」の対象が Pi の全キーを含む完全なオブジェクトなのか、Pi が言及したキーのみの partial なのかが明示されない。今回のケース範囲では「キー不在 = 変更なし」の直感的解釈で一意に解けたが、より複雑な仕様拡張（例: プリセット値を `null` で明示的に取り消す等）では解釈が割れる余地がある。

## メタ発見（プローブ設計中に発覚、agent の回答とは独立）: extends 解決結果が描画に無反映

オラクル正解を確定する過程で、`resolvePresentation`（§2.9.4 の深マージ・diamond・優先順位を実装する core 関数）が **`@pfdsl/cli` のどのコマンドからも呼ばれていない**ことが判明した。

- `pfdsl check` は `loadExtendsChain`（V026/V027 検出）と `validatePresetKeys`（V028 検出）のみを呼び、`resolvePresentation` を呼ばない
- `pfdsl graph` は entry file 自身の `frontmatter` のみを `renderGraph` に渡し、extends チェーンを一切解決しない

**実測で確認**: `artifact.status: done` を持つ node について、`done` の `statusStyles` をプリセット側にのみ定義したケース（ローカルに `done` の定義なし）で `pfdsl graph` を実行すると `fillcolor` が一切出力されない。同じ frontmatter をローカルに直接書いた対照実験では `fillcolor="#4CAF50"` が正しく出力される。つまり **`extends:` で継承したプリセットの `statusStyles` は、実際の graph 描画（色・スタイル）には一切反映されない**。

`resolvePresentation` は `packages/core/src/multifile.ts` に実装され、`multifile.test.ts` の単体テスト（chain を手組みした入力）でのみ呼ばれる。issue #148（multifile checker 実装、spec v0.0.8）のスコープ確認では「graph コマンドの **subflow** ビジュアル表現 — out of scope（別 issue）」と明記されているが、これは subflow の話であり `extends:` の presentation 適用については scope 記述が無い。`resolvePresentation` 自体は #148 の in-scope 成果物として実装されたにもかかわらず、呼び出し元が存在しないまま孤立している。

`extends:` の存在意義（issue #6「プロジェクト共有プリセット」）は「複数ファイルで見た目の定義を共有し、実際にその見た目で描画される」ことのはずであり、現状は「check で構文検証はされるが、描画には一切効果がない」機能になっている。これは実装ギャップであり findings として振り分ける（→ 新規 issue）。

## 手法メモ

正解が CLI に露出しない仕様項目（本ケースの深マージ結果）をオラクル化する場合、checker の実装コードを直接呼ぶ検証スクリプトが必要になる。これ自体が「実装が spec の全機能を露出していない」ことの検出装置として機能した — オラクル設計の副産物として実装ギャップが見つかる、という新しいプローブ効用がここで確認できた。
