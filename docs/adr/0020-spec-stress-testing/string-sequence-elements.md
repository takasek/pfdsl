# 文字列配列の要素型検査（#1272）

## 対象と手トレース

spec §2.1 の FM004 を対象とする小規模制約変更として、ADR-0020 のフェーズ1を実施した。
入力は以下の YAML を `---` で囲み、指定がなければ本文 `a >> p -> b` を付ける。
修正済み CLI の `check - --json` に入力し、予測した exit code と FM004 の有無を照合した。
非文字列の型違反は通常 mode でも error とする方針をユーザーが承認した。

| 境界 | YAML / 条件 | 手トレース | CLI 実測 |
| --- | --- | --- | --- |
| mapping | `artifact: {a: {tags: [{x: y}]}}` | FM004 | exit 1、FM004 |
| 数値 | `tags: [42]` | FM004 | exit 1、FM004 |
| 真偽値 | `tags: [true]` | FM004 | exit 1、FM004 |
| null | `tags: [null]` | FM004 | exit 1、FM004 |
| 入れ子配列 | `tags: [[x]]` | FM004 | exit 1、FM004 |
| 空集合 | `tags: []` | pass | exit 0 |
| quoted scalar | `tags: ["x: y", "42", "true", "null", ""]` | pass | exit 0 |
| 文字列 alias | `text: &text hello` と `tags: [*text]` | pass | exit 0 |
| 配列 alias | `list: &list [{x: y}]` と `tags: *list` | FM004、使用側位置 | exit 1、FM004 |
| 親 mapping alias | `meta: &meta {tags: [{x: y}]}` と `artifact: {a: *meta}` | FM004、使用側位置 | exit 1、FM004 |
| 自己参照 | `tags: &tags [*tags]` | FM004 | exit 1、FM004 |
| 拡張フィールド | `artifact: {a: {custom: {tags: [{x: y}]}}}` | pass | exit 0 |
| 既存スカラー形式 | `artifact: {a: {location: ./a.md}}` | pass | exit 0 |
| feedback との交差 | mapping 例に `b >>? p` を追加 | FM004 | exit 1、FM004 |
| frontmatter-only | `tags: [42]`、本文なし | FM004 | exit 1、FM004 |

同じ検査は9つのフィールド配置に適用される。
`frontmatter.test.ts` は各配置で mapping・入れ子配列・数値・真偽値・null を拒否し、空配列と文字列を受理する組を持つ。
LF / CRLF、block scalar、alias、YAML 構文エラーと未解決 alias、数値・真偽値のノードキーも同ファイルで確認する。
N:M・diamond・粒度の違いは配列要素の型を変えないため、グラフ制約の新しい規則は追加しない。

## 独立レビューで確認した境界

数値ノード ID は YAML AST の数値キーと JavaScript object の文字列キーが異なるため、文字列キーだけで AST を引く案では型検査から漏れた。
数値・真偽値・ゼロ埋め数値・null のキーを追加テストで再現し、解決後の配列値を検査することと、YAML のキー変換に対応した位置解決で修正した。

参照先プリセットの解析結果に FM004 があっても、親文書の `check` が成功する経路を CLI の独立利用試験で発見した。
`extends` の多段参照と subflow の読込先に対して FM004 を集約し、JSON の `file` と元ファイルの座標を保持する回帰テストを追加した。
raw YAML プリセットに解析用の fence を付けた場合は、診断位置からその1行・4文字を除く。
他の既存診断の参照先からの伝播範囲は変更しない。

文字列 alias と独自の `custom.tags` は `fmt --write` 後も `check` と `meta get` で同じ意味を保持した。
通常・strict の FM004、参照プリセットと subflow の拒否、`explain FM004` は CLI の回帰テストでも確認する。
