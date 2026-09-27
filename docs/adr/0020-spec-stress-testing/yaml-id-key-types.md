# YAML ID キー型の境界確認

対象は仕様 v0.0.24 §2.1、PR #1298 の #1290 追補。2026-09-27 に実施した。
単一のキー型制約なので spec-stress-test フェーズ1を適用し、agent 作文プローブは非適用とした。

| 境界 | 仕様上の期待 | 確認 |
|---|---|---|
| 数値・小数・真偽値・null・collection の宣言 ID | FM004 | core 回帰テストで4種の宣言 mapping を検査 |
| クォートした数値・真偽値、通常の語、prototype メンバー名 | 受理 | core 回帰テスト |
| 明示的な `!!str 10` | 受理 | CLI check の exit 0 |
| 型だけが異なる同じ綴りのキーの併記 | 型付きキーを拒否 | core 回帰テスト |
| セクション値・キーの alias | 参照先の型を検査 | core 回帰テスト |
| セクション名そのものの alias | 参照先の宣言 mapping を検査 | 独立レビューの反例を回帰テスト化 |
| 未知の拡張 mapping 内の数値キー | 制約対象外 | core 回帰テスト |
| frontmatter-only の不正 ID と書込み | 部分更新しない | core の4経路、CLI meta set/meta reindex/delete を実測 |

CLI check は `10` / `true` / `null` / `[a, b]` のキーを exit 1、FM004 とし、`"10"` / `"true"` / `!!str 10` は exit 0 とした。
meta set・meta reindex・delete --write は数値キー文書を exit 1 で拒否し、入力の完全一致を確認した。
reindex と定義挿入を含む4経路の拒否・文字列 ID の既存書込みは core 回帰テストで確認した。
グラフの N:M・feedback・diamond はこの制約の判定材料に含まれず、frontmatter-only と通常 edge 入り文書の両方で境界を確認した。

独立レビューでは、セクション名を alias にした場合に単純な `Document.get` が数値 ID を見落とす反例を検出した。
root の pair を列挙してセクション名を解決する方式へ修正し、正常な別 ID を書き換える操作も含めて拒否を確認した。
JSON Schema 単独では解析前の YAML キー型を復元できないため、この制約は YAML 読込み境界が担う。
