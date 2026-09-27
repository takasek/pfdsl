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

## 既知フィールド全体への拡張

上記は最初の文字列配列限定版の記録である。
ユーザーの指摘を受け、文字列・数値・配列・mapping・union を含む既知フィールド全体へ範囲を広げた。
TypeBox＋Ajv と Zod を比較し、既存読込みへの試作、Node 18 と実ブラウザ検証、サイズ比較を経て Zod Mini＋英語 locale を採用した。
スキーマから公開型を導出し、空宣言を受け入れる入力形状と正規化後の型を分ける。
`status` / `type` の列挙値とスタイルキーは既存の意味検証へ残し、診断コードと `meta set` の修復経路を維持する。
既知フィールドの型違反は FM004 とし、拡張キーは保持する。

単一制約節 §2.1 の型検査拡張として spec-stress-test フェーズ1を実施した。
粒度・N:M・diamond・孤立宣言は今回の型制約を変えない。
実CLIに対する追加17例は、以下の予測と一致した。

| 入力境界 | 予測と実測 |
| --- | --- |
| スカラー tags、配列 owner、数値 parts、数値 boundary 値、数値 penwidth | FM004、exit 1 |
| 未定義 layout.direction | FM004、exit 1 |
| 不正な文字列 status / type | V007 / V031、exit 1 |
| 未定義スタイル属性 / statusStyles キー | V009 / V008、exit 1 |
| index: 0 | V029、exit 1 |
| 拡張キー内の owner 配列・parts 数値 | error なし、exit 0 |
| 空の artifact / process 宣言 | error なし、exit 0 |
| 拡張値と共有された空宣言 alias | error なし、exit 0 |
| location 配列の非文字列要素を含む alias | FM004、exit 1 |
| 有効な tags と feedback の併用 | error なし、exit 0 |
| frontmatter-only の title 数値 | FM004、exit 1 |

回帰テストでは union の子診断パスを親パスへ結合し、`location: [ok, 42]` の `42` 自体を指すことを確認した。
独立レビューで、空宣言の破壊的正規化が共有 alias の拡張値まで変える反例が見つかった。
回帰テストの Red を確認後、ルートと宣言 mapping をコピーして正規化し、Green と再レビューで解消を確認した。
明示的な null / `~` ルートは FM004、空の front matter は引き続き許容する。

### サイズと実行環境

同一入口・esbuild 0.28.2・minify・gzip 条件で、旧コミット c8722d5e のバンドルと比較した。
ここでの browser は frontmatter loader のみで、アプリや拡張の配布サイズではない。
全 core は既存の `node:path` 依存があるため、この測定を全 core のブラウザ対応とは扱わない。

| 構成 | browser gzip bytes | 旧版との差 |
| --- | ---: | ---: |
| 旧版 | 32011 | 0 |
| 部分スキーマ・通常 Zod namespace import | 124348 | 92337 |
| 部分スキーマ・通常 Zod 個別 import | 58726 | 26715 |
| 部分スキーマ・Mini＋英語 | 38784 | 6773 |
| 全既知フィールド・Mini＋英語（今回の実装） | 40277 | 8266 |

最終 core バンドルは Node 18.20.8 で6不正例と1有効例を通し、行・列と型検査を確認した。
Chrome 153.0.8010.53 では、ページ自身のスクリプトで `new Function` が禁止される CSP 下で読み込み、alias 使用位置と未知キー・空宣言の保持を確認した。
型検査からスキーマ生成への移行、全パッケージのテスト、参照先プリセットと subflow の診断伝播も別途検証した。
全項目の配布利用者受入れや、VS Code の対話操作を確認したという意味ではない。
