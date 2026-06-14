# PFDSL仕様書 v0.0.7

## 1. 目的

本仕様は、清水吉男氏による PFD（Process Flow Diagram）の思想を基礎とし、成果物中心・純粋関数的なプロセス記述を行う DSL（Domain Specific Language）の形式仕様を定める。

PFDSL は以下を目的とする。

* 成果物（Artifact）とプロセス（Process）の依存関係を明示する
* 成果物の内部構造（parts）を明示する
* 人間に読みやすい逐次フロー記述を提供する
* 機械処理しやすい正規形へ変換可能とする
* ドキュメント・分析・可視化・実行支援の中間に位置する記述形式を提供する
* 手編集しやすく、差分比較しやすいテキスト形式を提供する

成果物の英語表記には、PFD 本家の "deliverable" ではなく **artifact** を採用する。deliverable は最終納品物のニュアンスが強いのに対し、artifact は中間生成物を含む開発者向けの定着語であり、本 DSL の用途に適する。

---

## 2. ファイル形式

拡張子：`.pfdsl`

ファイルは以下の2部構成を取ってよい。

1. YAML front matter（任意）
2. PFDSL本文

front matter が存在しないファイルも有効とする。
front matter はファイル先頭にのみ記述できる。

---

### 2.1 YAML front matter

```yaml
---
title: 開発フロー
version: 1.2
dslVersion: 0.0.2
tags: [web, review]

layout:
  direction: LR

artifact:
  req:
    label: 要求仕様書

process:
  design:
    label: 設計
---
```

---

### 2.2 front matter キー

すべて任意とする。

| key          | 内容                                         |
| ------------ | ------------------------------------------ |
| title        | 文書名                                        |
| version      | 文書バージョン                                    |
| dslVersion   | PFDSL仕様バージョン                               |
| description  | 文書説明                                       |
| tags         | 任意タグ                                       |
| layout       | レイアウト補助情報                                  |
| artifact     | 成果物定義                                      |
| process      | プロセス定義                                     |
| group        | グループ定義（§2.8参照）                             |
| statusStyles | status → DOT属性 マッピング（§2.7参照）              |
| tagStyles    | tag → DOT属性 マッピング（§2.7参照）                 |

未定義キーを含んでもよい。処理系は無視してよい。

---

### 2.3 IDメタデータ定義

front matter では、本文中で使用する Artifact / Process ID に対し追加情報を定義してよい。

```yaml
artifact:
  spec:
    label: 仕様書
    description: 要求仕様の詳細説明
    owner: po
    status: done
    tags: [external, critical]
    criteria: Tech Lead 承認かつ未解決設計質問がすべて解消されていること
    location: docs/spec/spec.md
    revises: spec_v1

process:
  impl:
    label: 実装
    description: バックエンド実装処理
    owner: dev-team
    estimate: 5d
    command: make build
```

label は表示名として利用してよい。
description は可視化バックエンドでのツールチップ（tooltip）に使用してよい。
status / tags は §2.7 を参照。
artifact / process に対して group を指定することで、ノードをグループへ所属させてよい（§2.8参照）。

#### artifact 専用フィールド（criteria / location / revises）

`status` / `tags` も Artifact 専用フィールドである（§2.7 参照）。

**criteria** — 成果物が完了（`status: done`）とみなされる条件（任意文字列）。モデル内で完了根拠を自己文書化する。1 Artifact につき 0 または 1 個。§15.7 参照。

**location** — 成果物の実体ファイル・リソースへのポインタ（パス、glob、または URL）。相対パスの基準は含む `.pfdsl` ファイルの位置。グラフ意味論に影響しない。1 Artifact につき 0 または 1 個。§15.8 参照。

**revises** — この成果物が改版する元成果物の ID（同一ファイル内）。バージョン系列を明示する。1 Artifact につき 0 または 1 個。§15.9 参照。

可視化バックエンドは `criteria:` / `location:` を tooltip に `description:` と並べて表示してよい。`location:` を Graphviz の `href` 属性として出力してよい。

#### process 専用フィールド

**command** — プロセスに対応する実行可能なコマンド文字列（任意文字列）。グラフ意味論に影響しない。1 Process につき 0 または 1 個。

---

### 2.4 IDと表示名の分離

DSL本文では短く安定したIDを使用し、図示・UI・レポートでは front matter 上の label を利用してよい。

```pfdsl
req >> design -> spec
```

表示例：

```
要求仕様書 → 設計 → 設計書
```

---

### 2.5 Artifact 構造定義

Artifact は内部構造（parts）を持ってよい。

```yaml
artifact:
  C:
    label: 統合成果物
    parts: [Ca, Cb]
```

意味：

* C は成果物ID
* Ca, Cb は C を構成する部分成果物ID
* parts は順序を持たない集合として扱う

parts は graph の生成関係とは独立である。
parts 宣言と生成graph入力との整合性は、標準意味論では検査対象外とする。処理系拡張として検査してよい。

---

### 2.6 レイアウトヒント

layout は可視化時の補助情報であり意味論には影響しない。

```yaml
layout:
  direction: LR
  maxWidth: 120
```

#### direction

グラフ描画方向。推奨値：

* LR
* RL
* TB
* BT

#### maxWidth

ノードラベルの折り返し幅（ピクセル単位、正の整数）。省略時は折り返しなし。
可視化バックエンドはラベル文字列をこの幅に収まるよう改行を挿入してよい。

layout 以下の未定義キーは実装依存とする。

---

### 2.7 Artifact status / tags / Style マッピング

Artifact に対し進捗状態 status と任意ラベル tags を付与してよい。可視化バックエンド（Graphviz 等）はこれらを node 属性へ反映してよい。対象は Artifact のみ（Process には適用しない）。

#### 2.7.1 status

```yaml
artifact:
  spec:
    status: done
```

* 列挙値: done | wip | todo | blocked
* 1 Artifact につき 0 個または 1 個
* 列挙外の値は error

#### 2.7.2 tags

```yaml
artifact:
  spec:
    tags: [external, critical]
```

* 任意文字列の配列（0..N 個）
* 検証は行わない（自由ラベル）
* tagStyles に未定義のタグでも error/warning とせず無視する

#### 2.7.3 statusStyles / tagStyles

```yaml
statusStyles:
  done:    { fillcolor: lightgray, style: filled, fontcolor: dimgray }
  wip:     { fillcolor: lightyellow, style: filled }
  blocked: { fillcolor: salmon, style: filled }

tagStyles:
  external: { color: blue }
  critical: { penwidth: "3" }
```

* 値は属性マップ（プロジェクト共通スタイル）
* 許可属性: fillcolor | color | fontcolor | style | penwidth
* statusStyles のキーは status 列挙値のみ許可（列挙外は error）
* tagStyles のキーは任意文字列
* 許可外属性キーは error

#### 2.7.4 適用順

可視化処理系は次の順で属性を合成してよい。

1. tags 配列を逆順走査し、tagStyles[tag] を順次マージ（後マージ勝ち = 先頭タグ最終勝者）
2. statusStyles[status] を最後にマージ（status が全体最終勝者）

statusStyles / tagStyles 未定義時は属性追加なし（通常描画）。組み込み既定スタイルは持たない。

---

### 2.8 Group 定義

任意の Artifact または Process を、名前付きグループへ所属させてよい。グループは可視化バックエンドでの領域分割（Graphviz の `subgraph cluster`）に対応する。意味論には影響しない。

#### 2.8.1 グループ宣言

```yaml
group:
  g1:
    label: "データ取込層"
    color: lightblue      # 色名
  g2:
    label: "出力層"
    color: "#ff6600"      # カラーコード（YAML クォート必須）
```

* キーがグループ ID（front matter 内で一意）
* label: 可視化時のグループ表示名（省略可）
* color: 可視化時のグループ枠色（省略可、値は可視化バックエンド依存）
  * 色名（`lightblue` 等）またはカラーコード（`"#ff6600"` 等）を指定できる
  * カラーコードを使う場合は YAML の文字列クォートが必須（`#` はコメント開始文字のため）
* 未定義キーは処理系が無視してよい

#### 2.8.2 ノードのグループ所属

```yaml
artifact:
  raw_data:
    group: g1
  processed:
    group: g1
process:
  ingest:
    group: g1
```

* Artifact / Process のメタデータに `group: <グループID>` を指定する
* 1 ノードは 0 または 1 グループにのみ所属できる
* `group` に指定したIDが `group` セクションに存在しない場合、処理系は警告なく無視してよい

#### 2.8.3 Graphviz 出力

```dot
subgraph cluster_g1 {
  label="データ取込層";
  color="lightblue";
  "raw_data" [shape=box, label="raw_data"];
  "processed" [shape=box, label="processed"];
  "ingest" [shape=ellipse, label="ingest"];
}
```

* クラスタ名は `cluster_<グループID>`
* label / color が未指定の場合は対応する属性行を省略する
* edge はグループ外（digraph 直下）に出力する

---

## 3. モデル構成要素

### 3.1 成果物（Artifact）

* IDで識別される
* プロセスの入力または出力となる
* Primary Graph において高々1つのプロセスから生成される
* 任意に parts を持ってよい
* edge を持たない孤立成果物として宣言してよい

生成元を持たない成果物は外部入力成果物とみなす。

---

### 3.2 プロセス（Process）

* IDで識別される
* 入力成果物集合から出力成果物集合を生成する純粋関数である
* 副作用・暗黙依存を持たない
* edge を持たない孤立プロセスとして宣言してよい（この場合、完全性制約の対象外）

---

### 3.3 終端成果物

どのプロセスにも入力されない成果物は終端成果物とみなす。

---

## 4. 識別子

ID は bare-id または quoted-id とする。

### 4.1 bare-id

Unicode Letter / Number および `_` `-` を許可する。

禁止文字：

```
[ ] ; # "
```

また演算子トークン：

* `>>`
* `>>?`
* `->`

を内部に含んではならない。

字句解析では演算子トークン `>>?` `>>` `->` を最長一致で優先認識する。

日本語識別子を許可する。

---

### 4.2 quoted-id

ダブルクォートで囲まれた識別子。

```
"要求仕様書 v2"
"設計書-新"
```

エスケープ：

```
\"  ダブルクォート
\\  バックスラッシュ
\n  改行
\t  タブ
```

---

## 5. ID種別推論

ID は明示的型を持たない。

### 5.1 推論規則

1. 演算子位置により推論する

   * `>>`, `>>?` 左辺 = Artifact
   * `>>`, `>>?` 右辺 = Process
   * `->` 左辺 = Process
   * `->` 右辺 = Artifact

2. front matter に明示定義がある場合はそれを優先する

3. 未確定IDは Artifact とみなす（孤立宣言を含む）

4. 同一IDに対し Artifact / Process の矛盾が発生した場合は error とする

---

## 6. コメント

```
# comment
```

* `#` 以降、行末までコメントとして無視される
* quoted-id 内の `#` はコメントではない

---

## 7. 文区切り

statement は以下で区切られる。

* 改行
* `;`

空行（連続する改行2個以上）は強制終端として扱われる。

### 7.1 行継続

末尾トークン (`<id>` または `]`) と継続オペレータ (`>>`, `>>?`, `->`) の間に
改行が入っても、同一 statement として扱う。

* 改行は最大1個まで（途中に空行があれば終端）
* 改行と継続オペレータの間にコメント行を挟んでもよい（コメントは改行カウントをリセット）
* 継続オペレータを行末に置くこと（例: `A >>\n P -> B`）は禁止 — 行頭オペレータのみ継続合図

例:

```pfdsl
[a, b, c]
  >> proc -> result      # OK: 末尾 ] の後改行→行頭 >>

A >> P
  -> B                   # OK: 末尾 ID(P) の後改行→行頭 ->

[a, b]
# 注釈
  >> proc -> result      # OK: コメント挟みは継続

[a, b]

  >> proc -> result      # NG: 空行で強制終端

A >>
  P -> B                 # NG: 行末オペレータ
```

---

## 8. 構文

```
<graph>       ::= <statement> (<separator> <statement>)*
<separator>   ::= newline{2,} | ';'
<statement>   ::= <chain> | <edge> | <node-decl>
```

(注) 末尾トークンと継続オペレータの間の単一改行は statement separator
ではなく行継続として扱う (§7.1)。

```
<chain>         ::= <artifact-expr> <input-op> <process-id> '->' <artifact-expr>
                    ( <input-op> <process-id> '->' <artifact-expr> )*

<edge>          ::= <artifact-expr> <input-op> <process-id>
                  | <process-id> '->' <artifact-expr>

<node-decl>     ::= <id>

<input-op>      ::= '>>' | '>>?'

<artifact-expr> ::= <id>
                  | '[' <id-list> ']'

<id-list>       ::= <id> (',' <id>)*

<process-id>    ::= <id>
<id>            ::= <bare-id> | <quoted-id>
```

node-decl は edge を伴わない node の存在宣言である。
ID 種別は §5 推論規則に従う（front matter 未定義かつ演算子位置なし = Artifact）。
複数の node を宣言する場合はセパレータで区切る（`a; b; c` または改行）。

---

## 9. 演算子意味論

### 9.1 通常入力

```pfdsl
A >> P
```

成果物 A をプロセス P の通常入力とする。

### 9.2 フィードバック入力

```pfdsl
A >>? P
```

成果物 A をプロセス P の補助入力とする。

### 9.3 出力

```pfdsl
P -> B
```

プロセス P が成果物 B を生成する。

---

## 10. チェーン記法

```pfdsl
X >> R -> Y >> S -> Z
```

は次と同値：

```pfdsl
X >> R
R -> Y
Y >> S
S -> Z
```

チェーン構文は左から線形走査で解釈される。結合性の概念は持たない。

---

## 11. 集合記法

```pfdsl
[a, b] >> P -> [x, y]
```

は次と同値：

```pfdsl
a >> P
b >> P
P -> x
P -> y
```

集合は順序を持たない。zip対応は持たない。

---

## 12. グラフモデル

PFDSL は2層グラフを持つ。

### 12.1 Primary Graph

対象 edge：

* `>>`
* `->`

用途：

* 到達性判定
* 制約判定
* 正規形生成
* 正準順序計算

### 12.2 Feedback Graph

対象 edge：

* `>>?`

用途：

* 補助依存表現

Feedback Graph は Primary Graph の構造に影響しない。

---

## 13. 正規形

すべての記述は以下へ変換される。

* edge 集合：
  * Artifact `>>` Process
  * Artifact `>>?` Process
  * Process `->` Artifact
* 孤立 node 集合：edge を持たない node（Artifact / Process）

edge 集合・孤立 node 集合はそれぞれ順序を持たない。

---

## 14. 正準順序（推奨）

フォーマッタ・diff用途のため、正規形 edge は以下キー順で安定ソートする。

### 14.1 第1キー：連結成分順

Primary Graph の各連結成分について、その成分に属する node ID の辞書順最小値が小さい成分を先に出力する。
孤立 node（連結成分サイズ = 1）は自身の ID を連結成分キーとする。
孤立 node は edge の後に出力する（孤立 node 群の中では ID 辞書順）。

### 14.2 第2キー：ランク順

ランク計算は Primary Graph のみを対象とする。

各 node の rank を以下で定義する。

* source Artifact = 0
* Process = 入力 Artifact rank の最大値 + 1
* 出力 Artifact = 生成 Process rank + 1

edge は接続 node の rank に基づき昇順に整列する。

### 14.3 第3キー：edge種別順

同ランク内では以下順とする。

1. `>>`
2. `>>?`
3. `->`

### 14.4 第4キー：辞書順

同順位では node ID の辞書順とする。

### 14.5 Feedback edge

`>>?` は rank 計算に含めず、接続先 Process の rank に従って配置する。

---

## 15. 制約

### 15.1 単一生成元制約

Primary Graph において、同一 Artifact を複数 Process が生成してはならない。

### 15.2 プロセス完全性制約

edge に1つ以上参加している Process は少なくとも1入力・1出力を持つ。
edge を持たない孤立 Process は完全性制約の対象外とする。

### 15.3 フィードバック妥当性制約

```pfdsl
A >>? P
```

は P に対する再入力・改善入力・補助入力として意味的に解釈可能であることが望ましい。

strict mode では、A が Primary Graph 上で P に関連する到達可能成果物であることを追加制約として検査してよい。

### 15.4 重複 edge

同一 edge の重複記述は冗長であり無視してよい。

### 15.5 parts 制約

```
artifact.C.parts = [Ca, Cb]
```

において：

* C と Ca/Cb はすべて Artifact でなければならない
* Process ID を parts に含めてはならない
* 自己参照は error
* parts 循環参照は error としてよい

### 15.6 status / Style 制約

* artifact.X.status は §2.7.1 の列挙値のみ許可。列挙外は error
* statusStyles のキーは §2.7.1 の列挙値のみ許可。列挙外は error
* statusStyles / tagStyles の属性キーは §2.7.3 の許可属性のみ。許可外は error
* tags 配列の各要素は任意文字列（検証なし）

### 15.7 criteria 制約

* `status: done` かつ `criteria:` 未設定の Artifact: warning
* strict mode では error に昇格してよい
* `criteria:` を Process に指定した場合は error
* `status` が `done` 以外の Artifact に `criteria:` を設定することは有効（事前宣言として許容）。warning / error は発しない

### 15.8 location / command 制約

`location:` の値は次の規則で分類する:

* `://` を含む → URL（検証対象外）
* `*` / `?` / `{` のいずれかを含む → glob（検証対象外）
* それ以外 → ファイルパス

URL に分類されない `?` を含む文字列（例: `docs/file?v=1`）は glob とみなす。クエリ文字列形式のローカルパスを使う場合は `file://` 形式の URL として記述すること。

ファイルパスの場合、処理系はファイルの存在を検証してよい（dead link 検出）。相対パスは含む `.pfdsl` ファイルからの相対として解決する。クロスファイル参照（別 `.pfdsl` への相対パス）は構文上許容するが、その意味論の完全な定義はマルチファイル仕様（将来版）に委ねる。

* `location:` を Process に指定した場合は error
* `command:` を Artifact に指定した場合は error

### 15.9 revises 制約

* `revises:` に指定した ID は同一ファイル内の Artifact ID でなければならない。存在しない場合は error
* 自己参照（`revises: self_id`）は error
* 線形チェーン制約: `revises:` チェーンは単方向の単一リンクリストでなければならない（最新版 → 前版 → … の方向）。複数の Artifact が同一 Artifact を `revises:` で参照することは error（分岐した改版系列）
* 循環参照は error
* `revises:` を Process に指定した場合は error
* クロスファイル revises はマルチファイル仕様（将来版）に委ねる（`location:` のクロスファイル参照扱いと同様、§15.8 参照）

---

## 16. エラー方針

処理系は以下をエラーまたは警告として報告する。`criteria:` 制約（§15.7）は独立した severity を持ち、strict option として個別に設定可能とする。

* 構文不正: error
* 型矛盾: error
* 単一生成元違反: error
* 不正YAML: error
* 不正parts参照: error
* 不正 status / statusStyles / tagStyles: error
* `location:` / `revises:` / `criteria:` を Process に指定: error
* `command:` を Artifact に指定: error
* `status: done` かつ `criteria:` 未設定: warning（strict mode では error）
* `location:` ファイルパスが存在しない: warning（任意実装）
* `revises:` 参照先不在 / 自己参照 / 分岐 / 循環: error
* 重複edge: warning可

---

## 17. 例

### 17.1 基本例

```pfdsl
req >> design -> spec
spec >> impl -> code
code >> test -> release
```

### 17.2 フィードバック

```pfdsl
code >> review -> issues
issues >>? impl -> code
```

### 17.3 集合

```pfdsl
[a, b] >> merge -> c
```

### 17.4 parts

```pfdsl
Ca >> merge -> C
Cb >> merge -> C
```

front matter:

```yaml
artifact:
  C:
    label: 統合成果物
    parts: [Ca, Cb]
```

### 17.5 criteria / location / revises / command

front matter:

```yaml
artifact:
  spec_v2:
    label: 設計書 v2
    status: done
    criteria: Tech Lead 承認かつ未解決設計質問がすべて解消されていること
    location: docs/spec/spec.md
    revises: spec_v1
  spec_v1:
    label: 設計書 v1
    status: done

process:
  revise_spec:
    label: 設計書改訂
    command: make gen-spec
```

本文（フロー edge）:

```pfdsl
spec_v1 >> revise_spec -> spec_v2
```

`revises:` は edge を自動生成しない。`spec_v1 >> revise_spec -> spec_v2` というフロー edge は引き続き必要。`revises:` はその改版意図を宣言するメタデータとして追加する。

### 17.6 条件分岐の表現

条件的な結果は決定成果物として外化する。

```pfdsl
review_result >> approve -> approved_spec
review_result >> reject -> revision_request
revision_request >>? impl -> code
```

`review_result`（承認/差し戻しの判断）が成果物。`approve` / `reject` はそれぞれ承認処理・差し戻し処理プロセス。条件分岐構文は存在しない（§19参照）。

---

## 18. 設計原則

* 成果物中心
* プロセスは純粋関数
* 暗黙依存禁止
* 人間可読な糖衣構文
* 機械処理可能な正規形
* IDと表示名の分離
* 生成関係と構造関係（parts）の分離
* 手編集しやすいファイル形式
* 差分安定性重視
* 実装互換性重視

---

## 19. 条件分岐の不在

PFDSL は制御フローではなく成果物フローを記述する。次の構造は表現しない。

* 条件分岐（if A then B else C）
* ループ（until done）
* 例外フロー（on error goto）

**設計判断**: 分岐構文を追加すると字句解析・意味論・可視化のいずれも複雑化する。また「条件が必要」に見える場面は多くの場合、設計が不明瞭な状態を示す。PFD の問いは「どの成果物があればどのプロセスが動くか」であり、条件はその成果物の定義に帰着する。

条件的な結果は決定成果物として外化する（§17.6 参照）。`>>?` フィードバック入力（§9.2）は条件を表現するのではなく、条件の結果として生まれた成果物を既存プロセスへ再入力するためのものである。

---

## 20. バージョン

本仕様は PFDSL仕様書 v0.0.7 とする。

v0.0.6 からの主な変更点（v0.0.7）：

* §2.3 `status` / `tags` が Artifact 専用フィールドであることを明記（§2.7 参照）
* §2.3 Artifact に `criteria:` フィールドを追加（完了条件の自己文書化）
* §2.3 Artifact に `location:` フィールドを追加（実体ファイル/URL へのポインタ）
* §2.3 Artifact に `revises:` フィールドを追加（バージョン系列の明示）
* §2.3 Process に `command:` フィールドを追加（実行手順の記述）
* §15.7 criteria 制約を追加（`status: done` + `criteria:` 欠如 → warning）
* §15.8 location 妥当性制約を追加（ファイルパス存在検証、任意実装）
* §15.9 revises 制約を追加（参照先存在・自己参照禁止・線形性・循環禁止）
* §17.5 / §17.6 例を追加
* §19 条件分岐の不在を新設（設計判断の明文化）

v0.0.5 からの主な変更点（v0.0.6）：

* §2.2 `dsl_version` キーを `dslVersion` に改名（camelCase 統一）
* §2.3 Artifact / Process メタデータに `description` フィールドを追加（可視化時ツールチップ）
* §2.6 `layout.maxWidth` フィールドを追加（ラベル折り返し幅、px単位）

v0.0.4 からの主な変更点（v0.0.5）：

* §2.2 front matter キー一覧に `group` を追加
* §2.3 IDメタデータに `group` 参照を追記
* §2.8 Group 定義を新設（グループ宣言・ノード所属・Graphviz cluster 出力）
* Artifact / Process メタデータに `group` フィールドを追加
* §2.3 / §2.4 / §2.5 Artifact / Process メタデータの `title` フィールドを `label` に改名

v0.0.3 からの主な変更点（v0.0.4）：

* §8 構文に node-decl（孤立 node 宣言）を追加
* §3.1/§3.2 に孤立 node 宣言の記述を追加
* §5.1.3 の未確定ID規則に孤立宣言を含む旨を明記
* §13 正規形を「edge 集合 + 孤立 node 集合」に拡張
* §14.1 正準順序に孤立 node の出力規則を追加
* §15.2 プロセス完全性制約を「edge 参加 Process のみ対象」に緩和

v0.0.2 からの主な変更点（v0.0.3）：

* Artifact に status (enum) / tags (任意配列) を追加
* front matter に statusStyles / tagStyles マッピングを追加
* Style 適用順（tags 逆順マージ → status 最終上書き）を規定
* 制約 §15.6 / エラー方針に status / Style 検証を追加

v0.0.1 から v0.0.2 の主な変更点：

* Artifact に parts 構造を追加
* Primary / Feedback 二層グラフを明文化
* 正準順序にランク順を追加
* front matter の artifact / process 定義を整理
* lexer規則を明文化
* 表示名分離方針を明文化
