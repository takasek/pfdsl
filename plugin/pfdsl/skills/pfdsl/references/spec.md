<!-- DO NOT EDIT — snapshot distributed with pfdsl skill. Authoritative source: https://github.com/takasek/pfdsl/blob/main/docs/spec/spec.md -->

# PFDSL仕様書 v0.0.17

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
| tag          | タグ定義（label / description / style、§2.7.4参照） |
| statusStyles | status → DOT属性 マッピング（§2.7参照）              |
| extends      | 継承するプリセットファイルへの相対パス（文字列または文字列の配列、§2.9.4参照） |
| type         | PFD の種別（roadmap \| workflow \| runtime-pipeline、§2.10参照） |

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
    criteria: Tech Lead 承認かつ未解決設計質問がすべて解消されていること
    location: docs/spec/spec.md
    revises: spec_v1
    tags: [external, critical]

process:
  impl:
    label: 実装
    description: バックエンド実装処理
    owner: dev-team
    command: make build
    estimate: 5d
```

label は表示名として利用してよい。
description は可視化バックエンドでのツールチップ（tooltip）に使用してよい。
status / tags は §2.7 を参照。
artifact / process に対して group を指定することで、ノードをグループへ所属させてよい（§2.8参照）。

#### document-level フィールド（basePath）

個々の ID メタデータに先立ち、フロントマター全体に効く document-level フィールドを規定する。

**basePath** — フロントマター全体に適用するパス解決基準（省略可能な文字列）。`location:` のファイルパス解決と `command:` の実行ディレクトリ（cwd）の両方に適用する。値は含む `.pfdsl` ファイルのディレクトリからの相対パスで指定する。省略時は `.pfdsl` ファイルのディレクトリをデフォルトとして後方互換を保つ。`subflow:` / `extends:` のクロスファイル参照の解決基準には影響しない（それらは常に含む `.pfdsl` ファイルの位置を基準とする。§2.9.2 が優先）。

```yaml
---
basePath: ../   # .pfdsl ファイルからの相対パス（例: サブディレクトリに .pfdsl を置く場合）
process:
  build:
    command: npm run build   # basePath を起点に実行される
artifact:
  config:
    location: config.json   # basePath を起点に解決される
---
```

#### artifact 専用フィールド（criteria / revises）

`status` も Artifact 専用フィールドである（§2.7 参照）。`tags` は Artifact / Process 両方に指定できる（`group` §2.8 と対称。§2.7.2 参照）。

**criteria** — 成果物の完了条件（任意文字列）。`status` を問わず事前宣言として設定可。モデル内で完了根拠を自己文書化する。1 Artifact につき 0 または 1 個。§15.7 参照。

**revises** — この成果物が改版する元成果物の ID（同一ファイル内）。バージョン系列を明示する。1 Artifact につき 0 または 1 個。§15.9 参照。

可視化バックエンドは `criteria:` を tooltip に `description:` と並べて表示してよい。

#### artifact と process の共有フィールド（owner / externalStakeholders）

**owner** — 成果物またはプロセスの内部責任者（任意文字列）。グラフ意味論に影響しない。1 ノードにつき 0 または 1 個。

**externalStakeholders** — 変換グラフの参加者でない外部消費者の列挙（文字列配列、省略可能）。外部提出先・最終消費者・規制当局など「フロー外で成果物を受け取る主体」を明示する。`owner`（内部責任者）と対称のフィールド。

`externalStakeholders` を持つ成果物は終端監査（`pfdsl graph io`）において消費者あり扱いとなり、孤立終端として報告されない。

```yaml
artifact:
  monthly_report:
    label: 月次コンプライアンスレポート
    externalStakeholders: [規制当局]
  published_skill:
    label: 配布済みスキル
    externalStakeholders: [外部ユーザー, 他プロジェクト開発者]
```

#### artifact と process の共有フィールド（index）

**index** — ノードに付与する正整数の採番（省略可能）。
process と artifact で名前空間は独立し、それぞれが独立した連番を持つ。
グラフ意味論・トポロジには影響しない。
pfdsl 自身はプレフィックスを持たず、外部ツール（pfd-tools 等）が process の `index:` を `P{index}`、artifact の `index:` を `D{index}` として解釈してよい。
`pfdsl meta reindex` コマンドでトポロジカルソート順に自動採番できる。
1 ノードにつき 0 または 1 個。§15.13 参照。

名前空間が独立しているため、process と artifact で同じ番号が並存してよい（衝突しない）。
次の例では process・artifact がそれぞれ独立に 1 から採番されている。

```yaml
process:
  design:
    index: 1
    label: 設計
  implement:
    index: 2
    label: 実装
artifact:
  requirement:
    index: 1
    label: 要求
  spec:
    index: 2
    label: 仕様書
```

#### artifact と process の共有フィールド（location）

**location** — 成果物の実体ファイル・リソース、またはプロセスの追跡・実行文脈（issue/PR 等）へのポインタ（パス、glob、または URL）。スカラー文字列または文字列配列で指定する（後方互換: スカラーは単一要素配列と等価）。相対パスの基準は含む `.pfdsl` ファイルの位置（`basePath:` 参照）。グラフ意味論に影響しない。`location:` フィールド自体は1ノードにつき0または1回指定できる（値は複数エントリの配列でもよい）。§15.8 参照。

可視化バックエンドは `location:` を tooltip に `description:` と並べて表示してよい。単一の URL を指す場合に限り、Graphviz の `href` 属性として出力してよい（複数・ファイルパスの場合は出力しない）。

#### process 専用フィールド

**command** — プロセスに対応する実行可能なコマンド文字列（任意文字列）。グラフ意味論に影響しない。1 Process につき 0 または 1 個。

**subflow** — 当該プロセスを子フローへ展開するビューリンク（文字列、子 `.pfdsl` への相対パス）。1 Process につき 0 または 1 個。ビューリンクの意味論・パス解決規則・境界整合・絶対パス禁止などの規範は §2.9.3（意味論）と §15.11（機械検証）に一本化する。

**boundary** — `subflow:` を持つプロセス専用の任意フィールド。親の境界 artifact ID を子の境界 artifact ID へ対応づけるマップ（`親ID: 子ID`）。独立に命名された子フローの再利用に用いる。全単射・side 整合などの規範は §2.9.3 / §15.11 参照。

```yaml
process:
  order_fulfill:
    label: 受注処理
    subflow: ./order_fulfill_sub.pfdsl
    boundary:                 # 任意。親ID: 子ID の 1:1 全単射
      order: incoming_order
      fulfilled_order: outgoing_parcel
```

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

### 2.7 status / tags / Style マッピング

Artifact に進捗状態 status を、Artifact / Process に任意ラベル tags を付与してよい。可視化バックエンド（Graphviz 等）はこれらを node 属性へ反映してよい。status は Artifact 専用（Process には付与しない）。tags は Artifact / Process の両方を対象とする（`group` §2.8 と対称）。

#### 2.7.1 status

```yaml
artifact:
  spec:
    status: done
```

* 列挙値: done | wip | todo | waiting | suspended
  * `todo` — 未着手（成果物未生成）
  * `wip` — 生産中（成果物が部分的に存在する。例: ソフトウェア工程ではブランチ・PR がオープン）
  * `done` — 完了・受入済み（成果物が確定し受け入れられた。例: ソフトウェア工程では main にマージ済み）
  * `waiting` — 外部要因で着手不能（locus of control: 他者。レビュー待ち・外部ベンダー回答待ち等）
  * `suspended` — 自主的な一時中断・再開予定あり（locus of control: 自分たち）
* 1 Artifact につき 0 個または 1 個
* 列挙外の値は error

#### 2.7.2 tags

`tags` は **Artifact / Process の両方**に指定してよい（`group` §2.8 と対称）。ノードへ横断的な性質ラベルを付与し、同じ性質を持つノード群（成果物でも工程でもよい）を束ねる。

```yaml
artifact:
  spec:
    tags: [external, critical]
process:
  review:
    tags: [shared, audited]
```

* 任意文字列の配列（0..N 個）
* Artifact / Process のどちらにも付与できる
* 検証は行わない（自由ラベル）
* `tag` セクション（§2.7.4）で宣言されていないタグを使ってもよい（宣言は任意。未宣言タグは error/warning とせず無視する）

#### 2.7.3 statusStyles

```yaml
statusStyles:
  done:    { fillcolor: lightgray, style: filled, fontcolor: dimgray }
  wip:     { fillcolor: lightyellow, style: filled }
  waiting:   { fillcolor: salmon, style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }
```

* status 値 → DOT 属性マップ（プロジェクト共通スタイル）
* 許可属性: fillcolor | color | fontcolor | style | penwidth
* キーは status 列挙値のみ許可（列挙外は error）
* 許可外属性キーは error
* status は Artifact 専用のため statusStyles も Artifact node にのみ適用される

#### 2.7.4 tag 定義

`tag` は front matter のトップレベルキーで、`artifact` / `process` / `group` と同階層に置く（§2.2）。タグごとに `label` / `description` / `style` を宣言してよい。タグの「意味」と「見た目」を front matter 内に一元管理する（`group` が `label` + `color` を1ブロックに持つのと対称）。

```yaml
tag:
  external:
    label: 外部公開
    description: 外部に公開・提供される成果物・工程
    style: { color: blue }
  critical:
    style: { penwidth: "3" }
```

* キーがタグ ID（front matter 内で一意）
* label: 可視化・文書でのタグ表示名（省略可）
* description: タグの意味の説明（省略可）
* style: DOT 属性マップ（省略可）。許可属性は §2.7.3 と同じ（fillcolor | color | fontcolor | style | penwidth、許可外は error）
* `tag` 宣言は任意。ノードは未宣言のタグも使える（§2.7.2）。宣言すると label/description/style が紐づく
* 未定義キーは処理系が無視してよい

#### 2.7.5 適用順

可視化処理系は次の順で属性を合成してよい。

1. tags 配列を逆順走査し、`tag[tag].style` を順次マージ（後マージ勝ち = 先頭タグ最終勝者）。Artifact / Process の両方に適用する
2. statusStyles[status] を最後にマージ（status が全体最終勝者）。status は Artifact 専用のため Process では本ステップを行わない

`tag` の style / statusStyles 未定義時は属性追加なし（通常描画）。組み込み既定スタイルは持たない。

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
  g3:
    label: "サブ層"
    color: "#ffeecc"
    parent: g1            # g1 の子グループ
```

* キーがグループ ID（front matter 内で一意）
* label: 可視化時のグループ表示名（省略可）
* color: 可視化時のグループ枠色（省略可、値は可視化バックエンド依存）
  * 色名（`lightblue` 等）またはカラーコード（`"#ff6600"` 等）を指定できる
  * カラーコードを使う場合は YAML の文字列クォートが必須（`#` はコメント開始文字のため）
* parent: 親グループ ID（省略可）。指定した場合、このグループは親グループの内側にネストして描画される。親が存在しない ID を指定した場合は無視する
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
  subgraph cluster_g3 {
    label="サブ層";
    color="#ffeecc";
    "raw_data" [shape=box, label="raw_data"];
  }
  "processed" [shape=box, label="processed"];
  "ingest" [shape=ellipse, label="ingest"];
}
```

* クラスタ名は `cluster_<グループID>`
* `parent` が指定されている場合、そのグループのクラスタを親クラスタの内側にネストして出力する
* label / color が未指定の場合は対応する属性行を省略する
* edge はグループ外（digraph 直下）に出力する

#### 2.8.4 制約

* V025: `parent` チェーンに循環が存在する場合は error（§15 参照）

---

### 2.9 マルチファイル意味論

複数の `.pfdsl` ファイルにまたがる参照（`subflow:` による階層展開・`extends:` によるプリセット継承）の共通前提を規定する。

本節は `subflow:` / `extends:` のみを対象とする。`location:` / `revises:` のクロスファイル参照の意味論は対象外であり、引き続き将来の拡張に委ねる（§15.8 / §15.9 参照）。

#### 2.9.1 ファイルローカル ID スコープ

各 `.pfdsl` ファイルは独立した ID 名前空間を持つ。artifact ID および process ID はファイル内でのみ一意であればよい。グローバルレジストリは持たない。

異なるファイルが同名 ID を持っていても衝突しない。制約 V001（§15.1 単一生成元制約）/ V002・V003（§15.2 プロセス完全性制約）はファイル単位で成立すれば十分とする。

W003（status 非単調, §15.6）を含む status 系検査も同様にファイル単位で閉じる。各ファイルの status 宣言のみを見て評価し、複数ファイルを跨いだ平坦化ビューを構成しない。境界 artifact のメタデータ権威（親優先, §2.9.3）と組み合わせた場合も、検査はファイル単位で行うため、平坦化ビューでのみ現れる非単調は警告対象としない。

#### 2.9.2 ファイル間参照規則

ファイル間参照は常に相対パスで記述する。パス解決の基準は「含む `.pfdsl` ファイルの位置」とし、`location:` フィールドのパス解決規則（§15.8）と一致する。

絶対パス・リポジトリルート相対パス・URL（`://` 形式）は `subflow:` および `extends:` の値として不可とする。

#### 2.9.3 subflow（階層展開）

`subflow:` フィールドを持つプロセス（展開プロセス）は、指定した子 `.pfdsl` の要約ビューとして機能する。subflow はビューリンクであり、子フローを親フロー内に複製するものではない。

**境界 ID 協定** — ファイルローカル名前空間を維持したまま親子フローの整合を機械検証するため、境界 artifact にかぎり親子で同一 ID を共有する契約とする。照合は **ID の集合一致**であり位置対応ではない。

* 展開プロセスの通常入力エッジ（`>>`）が指す artifact の **ID 集合**と、子フローの **open input artifact**（生成元プロセスを持たない artifact）の **ID 集合**は一致しなければならない（全単射）
* 展開プロセスの出力エッジ（`->`）が指す artifact の **ID 集合**と、子フローの **terminal artifact**（消費先プロセスを持たない artifact）の **ID 集合**は一致しなければならない（全単射）
* **フィードバック入力（`>>?`）は境界整合の対象外**とする。フィードバック入力は横断的な修正ループであり、階層的な外部 I/O 契約には含めない
* **open input / terminal の判定**: open input artifact は生成元プロセス（`->`）を持たず、**かつ通常入力（`>>`）で1回以上消費される** artifact、terminal artifact は **`>>`（通常入力）でも `>>?`（フィードバック入力）でも消費されない** artifact とする。フィードバックのみで消費される artifact（生成元の有無を問わない）は横断的な修正ループの要素であり、open input / terminal のいずれでもない（境界に出さない）
* **境界判定の対象**: 境界判定は edge に参加する artifact のみを走査する。孤立 node-decl や frontmatter `artifact:` のみで宣言され本文エッジに現れない artifact は、open input / terminal のいずれにも数えず、境界整合の対象外とする
* 内部（非境界）の artifact / process ID は各ファイルで自由に定義できる

**境界 artifact のメタデータ権威** — 境界 artifact は親ファイルと子ファイルの両方で宣言されうるが、共有されるのは対応関係のみである。メタデータ権威は**実効対応**（`boundary:` の明示マップと未マップ境界の恒等対応を合わせた対応。後述「境界リネームマップ」・§15.11）で対応づけられた境界 artifact 対に適用する。`boundary: { order: incoming_order }` のように親子で ID が異なる場合も含め、対応づいた対の `status` / `label` / `criteria` 等のメタデータが食い違うときは、展開プロセスを持つ**親ファイルの宣言を優先**する。複数ファイルを平坦化して描画・解析する処理系はこの規則に従う。

**境界リネームマップ（`boundary:`）** — 既定では境界 artifact を同一 ID で照合するため、独立に命名された子フローを境界 ID の異なる複数の親プロセスで再利用できない。これを解消するため、展開プロセスに任意の `boundary:` マップ（`親ID: 子ID`）を指定してよい。

* マップは親の境界 artifact ID を子の境界 artifact ID へ対応づける **1:1 全単射**である。置換（swap）を含む任意の全単射を許す
* マップに現れない境界 artifact は**同一 ID で照合**される（部分マップ可）。明示マップと未マップの恒等対応を合わせた**実効対応が全単射**でなければならない
* **side 整合**: 親の通常入力境界は子の open input へ、親の出力境界は子の terminal へのみ対応づけられる（入力↔出力の越境は不可）
* フィードバック入力（`>>?`）は境界外のため、マップのキーにできない
* マップにより、同一子フローを `boundary:` の異なる複数の親プロセスで再利用できる

**粒度差の扱い** — `boundary:` は境界 ID の 1:1 貼り替えのみを行い、粒度（artifact の分割・併合）は変えない。親が粗い `order`、子が細かい `order_header` / `order_lines` を扱う場合は、子フロー**内部**で分割プロセスを置く（`order >> split -> [order_header, order_lines]`）。境界は粗いまま `order` で保つ。1 つの親境界を複数の子境界の併合として表す N:M 対応は、親 artifact 同士の重複（overlap）を招くため許可しない。重複が真に必要なら、その共有 artifact を親子両レベルの独立した境界 artifact として細粒度で揃える。

**子 terminal が親出力より多い場合** — 子フローがログ・帳票などの副産物 terminal を持ち、親の出力より terminal が多くなる場合は、`boundary:` の N:M マップで畳もうとせず、親の出力 edge を子の terminal 数に合わせて増やして全 terminal を境界に露出させるのが正攻法である。例えば子が `order >> work -> [fulfilled_order, work_log]` を持つなら、親も両方を出力する（`order >> order_fulfill -> [fulfilled_order, work_log]`）。全単射（親の外部 I/O = 子の外部 I/O）が階層整合の要件であり、副産物を親ビューから隠す機構は現時点では持たない。

制約の機械検証は §15.11 参照。

**展開プロセスの通常入力** — subflow 展開プロセスは通常入力（`>>`）を1つ以上持つべきである。子フローが edge を持つ DAG である以上その open input 集合は非空であり、親の通常入力境界と全単射で対応する必要があるため、通常入力ゼロ（フィードバックのみ）の展開プロセスは境界整合を満たせない。

self-consistent 例（`order_fulfill` プロセス）:

親フロー:

<!-- pfdsl-nocheck -->
```pfdsl
---
process:
  order_fulfill:
    label: 受注処理
    subflow: ./order_fulfill_sub.pfdsl
---
order >> order_fulfill -> fulfilled_order
```

子フロー（`order_fulfill_sub.pfdsl`）では `order` が open input artifact、`fulfilled_order` が terminal artifact となる。子フロー内部の artifact / process ID は自由に定義できる。

**V001 との関係** — `subflow:` はビューリンクであり生成の複製ではない。子フロー内で境界 artifact が別プロセスにより生成されていても、それは別ファイル（別名前空間）の生成元であり、親フロー側の V001 制約とは独立して成立する。

境界整合制約の詳細は §15.11 参照。

#### 2.9.4 extends（プリセット継承）

`extends:` フロントマターキーを使い、複数の `.pfdsl` ファイルで `statusStyles` / `tag`（§2.7.4 tag 定義ブロック）/ `group` の定義を共有できる。これらは純粋な presentation 系設定であり、`artifact` / `process` 定義およびボディのエッジ文は共有しない（§2.9.1 ファイルローカル ID スコープを保つため）。

```yaml
# 単一プリセット
extends: ./presets.yaml

# 複数プリセット（後勝ち）
extends:
  - ./base.yaml
  - ./team.yaml
```

**継承解決規則**

* **属性レベル深マージ**: マージはブロック丸ごとの置換ではなく、属性レベルの再帰（深）マージである。ローカルが `statusStyles.done.fillcolor` のみ上書きした場合、プリセット由来の `statusStyles.done.fontcolor` 等の兄弟属性は保持される。同じ規則が `statusStyles.<status>.<attr>` / `tag.<id>.<field>`（label / description / style）/ `group.<id>.<field>` に再帰的に適用される。とくに `tag.<id>.style` は `statusStyles.<status>.<attr>` と同様、内部属性（`color` / `penwidth` 等）単位でさらに深マージされる。ローカルが `tag.urgent.style.color` のみ上書きしても、プリセット由来の `tag.urgent.style.penwidth` は保持される
* **ローカル prevail**: ローカル定義は常に全プリセットに勝つ
* **解決アルゴリズム（決定的）**: ファイル F の実効 frontmatter は次で計算する。`extends: [P1, P2, ...]` のとき、優先度の低い順に `resolve(P1) → resolve(P2) → … → F のローカル定義` を深マージする（後マージ勝ち）。`resolve(Pi)` は Pi の `extends:` を先に解決してから Pi 自身のローカル定義を上書きした実効値（再帰）。`resolve(Pi)` が返すのは Pi 自身が言及した属性に限らず、Pi の継承チェーンで解決済みの全属性を含む完全な frontmatter である（欠落属性を継承元で補完した完全形であり、partial ではない）
* **優先度（低→高）**: 配列の前のプリセット < 後のプリセット < 継承元 < 継承先 < ローカル定義。ローカルが常に最優先
* **diamond**: 同一プリセット D が複数経路（例: `A extends [B, C]`、B・C とも `extends D`）から到達する場合、より高優先の経路の値が後マージで自然に勝つため解決は決定的
* **循環禁止**: 自己参照（`extends: ./self`）および多段循環を含む、extends グラフ全体における任意の循環は error

**継承解決の具体例**

プリセット `presets.yaml` で `done` を緑・`wip` を黄に定義し、ローカルファイルで `done` のみ青に上書きする場合：

```yaml
# presets.yaml
statusStyles:
  done:
    fillcolor: "#4CAF50"   # 緑
  wip:
    fillcolor: "#FFC107"   # 黄
```

```yaml
# main.pfdsl
---
extends: ./presets.yaml
statusStyles:
  done:
    fillcolor: "#2196F3"   # 青（ローカル定義がプリセットに勝つ）
---
spec >> implement -> test
```

解決結果: `done` は青（`#2196F3`）、`wip` はプリセットの黄（`#FFC107`）。深マージのため `wip` はローカル未定義でもプリセット値が有効となる。

**深マージの例**（兄弟属性の保持）: プリセットが `done: {fillcolor: 緑, fontcolor: white}`、ローカルが `done: {fillcolor: 青}` を定義した場合、解決結果は `done: {fillcolor: 青, fontcolor: white}` となる。ローカルは `fillcolor` のみ上書きし、プリセット由来の `fontcolor: white` は保持される（done ブロックごと置換しない）。

**diamond の値衝突 worked example**: `A extends [B, C]`・`B extends D`・`C extends D` の菱形で、D が `tag.x.style.color: red` を定義し、B が同属性を `green`・C が `blue` に上書きする場合を考える。A の実効値は優先度の低い順に `resolve(B) → resolve(C) → A のローカル` を深マージして得る。`resolve(B)` は D の `red` を B の `green` で上書きした `green`、`resolve(C)` は同様に `blue` を返す。配列で後にある C が B より高優先のため後マージで勝ち、A がローカル上書きを持たなければ `tag.x.style.color` は `blue`（C 経由）に決定する。プリセット D へ複数経路が到達しても、優先度順の後マージにより解決は一意である。

`tag` は §2.7.4 で導入された tag 定義ブロックであり、extends 共有対象に含まれる。`tag` の各タグ ID も深マージ対象であるため、ローカルで特定タグの style のみ上書きしつつプリセットの label / description / 他タグ定義を引き継ぐことができる。

**共有対象外キーの非継承**: extends で共有されるのは `statusStyles` / `tag` / `group` のみである。`layout` / `title` / `dslVersion` 等その他のトップレベルキーは各ファイル固有であり、プリセットから継承されない。

制約の詳細は §15.12 参照。

#### 2.9.5 プリセットファイル形式

プリセットファイル（`.yaml` 拡張子を推奨）は presentation 系キーのみを含む YAML ファイルである。

許容トップレベルキー: `extends` / `statusStyles` / `tag` / `group`

```yaml
# presets.yaml の例
extends: ./base.yaml   # プリセットが別プリセットを extends してよい（多段）

statusStyles:
  done:
    style: filled
    fillcolor: "#4CAF50"
    fontcolor: white
  wip:
    style: filled
    fillcolor: "#FFC107"

tag:
  urgent:
    style: { color: red }

group:
  frontend:
    label: フロントエンド
    style: dashed
```

* 許容トップレベルキー（`extends` / `statusStyles` / `tag` / `group`）以外のキー（`artifact:` / `process:` / `layout:` / `title:` / `dslVersion:` 等）を含む場合は error（ホワイトリスト方式。生成物定義の共有禁止に加え、非継承キーの混入も誤りとして検出する）
* エッジ本文（`>>` 構文）を記述した場合は error
* プリセットファイル自身も `extends:` を持てる（多段継承）

---

### 2.10 type フィールド

フロントマターのトップレベルに `type:` フィールドを指定することで、PFD ファイルの種別を自己記述できる。

```yaml
type: roadmap   # または workflow / runtime-pipeline
```

* 列挙値: `roadmap` | `workflow` | `runtime-pipeline`（ADR-0017 の種別定義に対応）
* 省略可能。省略時は種別を問わない操作（check / fmt / render 等）を実行する
* 列挙外の値は error (V031、§15.14)
* `pfdsl status ready` / `pfdsl meta set`（status 設定時）/ `pfdsl status gaps`（roadmap引数）は `type: roadmap` 以外の値を明示指定したファイルに対して error を出力する。省略時は `roadmap` として扱い実行を許可するが、warning (W006、§15.14) を出す

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

終端成果物 = 通常入力（`>>`）で消費されない成果物とする。フィードバック入力（`>>?`）による消費の有無で、二つの部分クラスに分かれる。二つの述語は「フィードバック入力でのみ消費される成果物」の扱いだけが異なる。

* **audit-terminal**（終端監査の対象）— 通常入力で消費されない成果物。フィードバック消費は無視するため、通常入力・フィードバック入力のいずれでも消費されない成果物に加え、フィードバック入力でのみ消費される成果物も含む。終端監査（`pfdsl graph io`）はこれらを「消費者が疑わしい終端」として列挙する。
* **boundary-terminal**（subflow 境界判定の対象）— 通常入力でもフィードバック入力でも消費されない成果物。フィードバック入力でのみ消費される成果物は横断的な修正ループの要素として除外し、terminal に数えない（§2.9.3）。

audit-terminal は boundary-terminal を包含し、両者はフィードバックのみ消費の成果物の一点でのみ食い違う（監査は列挙し、境界判定は除外する）。

---

## 4. 識別子

ID は bare-id または quoted-id とする。

### 4.1 bare-id

Unicode Letter / Number および `_` `-` を許可する。

禁止文字：

```
[ ] ; # " ,
```

カンマ（`,`）は集合記法（`[a, b]`）の要素区切りトークンであり、bare-id に含められない。空白類（スペース・タブ・改行）も常にトークン区切りとして扱われ、bare-id の内部に現れない。

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

末尾トークン (`<id>` または `]`) と継続オペレータ (`>>`, `>>?`, `->`) の間に 改行が入っても、同一 statement として扱う。

* 改行は最大1個まで（途中に空行があれば終端）
* 改行と継続オペレータの間にコメント行を挟んでもよい（コメントは改行カウントをリセット）
* 継続オペレータを行末に置くこと（例: `A >>\n P -> B`）は禁止 — 行頭オペレータのみ継続合図

例:

<!-- pfdsl-nocheck -->
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

(注) 末尾トークンと継続オペレータの間の単一改行は statement separator ではなく行継続として扱う (§7.1)。

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

<!-- pfdsl-nocheck -->
```pfdsl
A >> P
```

成果物 A をプロセス P の通常入力とする。

### 9.2 フィードバック入力

<!-- pfdsl-nocheck -->
```pfdsl
A >>? P
```

成果物 A をプロセス P の補助入力とする。

### 9.3 出力

<!-- pfdsl-nocheck -->
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

`subflow:` はプロセスのメタデータであり、正規形には現れない。normalize は subflow を展開も保持もしない。subflow 階層を単一グラフへ平坦化した正準形は本仕様の正規形の対象外である。

この帰結として、リファクタリングでフローの一部を子フローへ切り出すと、構造 diff（`pfdsl diff`）は子フロー版とインライン版を別物と判定し、全張り替えとして現れる。正規形が subflow を保持しない以上避けられない帰結であり、驚きを減らすため明記する。

---

## 14. 正準順序（fmt が従う規範）

フォーマッタ・diff用途のため、正規形 edge は以下キー順で安定ソートする。この順序は `pfdsl fmt` が必ず従う規範であり、fmt 出力の安定性と diff の最小性はこの順序に依存する。したがって fmt にとっては「推奨」ではなく事実上 normative である（fmt 以外の処理系が同じ順序を採用するかは任意とする）。

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
「入力」にはフィードバック入力（`>>?`）を含む。通常入力（`>>`）がゼロでフィードバック入力のみを持つ Process も「1入力」を満たす。
ただし subflow 展開プロセスは、境界整合のため通常入力を1つ以上持つべきである（§2.9.3）。
graph body 内の node-decl（edge を持たない孤立ノード）は完全性制約の対象外とする。
フロントマター `process:` セクションで宣言された Process は §15.10 の孤立宣言制約の対象となる。

入力が無い場合は warning (V002; strict mode では error)、出力が無い場合は warning (V003; strict mode では error)。
グラフを後ろ向き・逐次に書いている途中では、入出力の一方が未接続の Process が正常な中間状態として現れるため、非 strict（デフォルト）では警告に留める。

### 15.3 フィードバック妥当性制約

<!-- pfdsl-nocheck -->
```pfdsl
A >>? P
```

は P に対する再入力・改善入力・補助入力として意味的に解釈可能であることが望ましい。

A が非連結な別系統（P の系譜に属さない）の産物であっても、それ自体は妥当な補助入力でありうる。
strict mode では、フィードバック元 A が Primary Graph 上ですでに対象プロセス P の**真の上流**（A から P の方向へ有向辺を辿って到達可能）になっている場合のみを検査対象とする。この場合、A は本来 `>>` で表現すべき通常入力であり、`>>?` としての宣言は Primary Graph と矛盾する（逆循環）。到達可能な場合は error (V011)。A と P が非連結、または A が P の下流にある場合は許容する。

### 15.4 重複 edge

同一 edge の重複記述は冗長であり、2回目以降は無視してよい。処理系は warning (N003) を報告してよい。

### 15.5 parts 制約

```
artifact.C.parts = [Ca, Cb]
```

において：

* C と Ca/Cb はすべて Artifact でなければならない
* Process ID を parts に含めてはならない
* 自己参照は error
* parts 循環参照は error としてよい
* parts メンバーが graph body 内のいずれの edge にも参加していない場合は warning (W001)

### 15.6 status / Style 制約

* artifact.X.status は §2.7.1 の列挙値のみ許可。列挙外は error
* statusStyles のキーは §2.7.1 の列挙値のみ許可。列挙外は error
* statusStyles および `tag.<id>.style` の属性キーは §2.7.3 の許可属性のみ。許可外は error
* tags 配列の各要素は任意文字列（検証なし）
* Process の出力 Artifact が `status: done` なのに、明示 status を持つ入力 Artifact が `done` 未満の場合は warning (W003)。status 未宣言の入力 Artifact は対象外

### 15.7 criteria 制約

* **produced artifact**（少なくとも1つのプロセスの出力として登録されているもの）に `criteria:` が未設定の場合: warning (W002; strict mode では error)
* **source artifact**（いかなるプロセスの出力でもないもの）は W002 の対象外とする
* `criteria:` を Process に指定した場合は error
* `status` が `done` 以外の Artifact に `criteria:` を設定することは有効（事前宣言として許容）

### 15.8 location / command 制約

`location:` にはスカラー文字列または文字列配列を指定できる。スカラーは単一要素配列と等価として扱う。各要素は次の規則で分類する:

* `://` を含む → URL（検証対象外）
* `*` / `?` / `{` のいずれかを含む → glob（検証対象外）
* それ以外 → ファイルパス

URL に分類されない `?` を含む文字列（例: `docs/file?v=1`）は glob とみなす。クエリ文字列形式のローカルパスを使う場合は `file://` 形式の URL として記述すること。

ファイルパスの場合、処理系はファイルの存在を検証してよい（dead link 検出）。相対パスの解決基準は、`basePath:` が指定されている場合はそれをフロントマターレベルで `.pfdsl` ファイルのディレクトリから解決した絶対パス、指定がない場合は含む `.pfdsl` ファイルのディレクトリとする。クロスファイル参照（別 `.pfdsl` への相対パス）は構文上許容するが、その意味論の完全な定義は引き続き対象外とし将来の拡張に委ねる（§2.9 のマルチファイル意味論は `subflow:` / `extends:` のみを対象とする）[[SPEC_crossfile_semantics?]]。

* `command:` を Artifact に指定した場合は error

### 15.9 revises 制約

* `revises:` に指定した ID は同一ファイル内の Artifact ID でなければならない。存在しない場合は error
* 自己参照（`revises: self_id`）は error
* 線形チェーン制約: `revises:` チェーンは単方向の単一リンクリストでなければならない（最新版 → 前版 → … の方向）。複数の Artifact が同一 Artifact を `revises:` で参照することは error（分岐した改版系列）。この制約は「最新版はどれか」を一意に機械判定するための意図的な単純化である。分岐する版系列（同一版から社内版と提出版を派生等）が必要な場合は、別 ID 系列に分けて表現する
* 循環参照は error
* `revises:` を Process に指定した場合は error
* クロスファイル revises の意味論は引き続き対象外とし将来の拡張に委ねる（`location:` のクロスファイル参照扱いと同様、§2.9 のマルチファイル意味論は `subflow:` / `extends:` のみを対象とする、§15.8 参照）[[SPEC_crossfile_semantics?]]

### 15.10 孤立宣言プロセス制約

フロントマター `process:` セクションで宣言された Process が、graph body 内のいずれの edge にも参加していない場合、その Process は孤立宣言プロセス（orphaned process）として warning (V020; strict mode では error) を報告する。グラフを後ろ向き・逐次に書いている途中では、宣言済みだがまだ配線していない Process が正常な中間状態として現れるため、非 strict（デフォルト）では警告に留める。

孤立宣言プロセスは終端監査ルール「消費者を書けない成果物は作らない」の Process 版違反であり、チェーン削除時の残骸や未接続の宣言を機械的に検出する（学習ループ ADR-0006 の lint 要件経路）。strict mode で error として扱うのはこのためである。

graph body の node-decl で宣言された孤立ノード（edge なし）は §15.2 の通り対象外とする（node-decl はデフォルト Artifact 扱いであり、Process 宣言としては機能しない）。

**artifact 側との非対称** — frontmatter `artifact:` セクションで宣言され本文エッジに現れない artifact は、V020（プロセス側の孤立宣言）と異なり error・warning のいずれも報告しない。プロセスは入出力を持つ変換であり本文で使われなければ残骸だが、artifact は正当な孤立成果物宣言（source でも terminal でもない参照予定のプレースホルダ等）と typo を機械的に区別できないため、対称の検査を課さない。

### 15.11 subflow 境界整合制約

`subflow:` を持つ Process（展開プロセス）に対し、checker は以下の境界整合を検証する。`boundary:` マップがある場合は親の境界 ID をマップで変換してから照合する（マップがなければ恒等変換）。

* 展開プロセスの通常入力エッジ（`>>`）が指す artifact の **ID 集合**（マップ適用後）と、子フローの **open input artifact**（生成元プロセス `->` を持たず `>>` で消費されるもの。判定は §2.9.3 参照）の **ID 集合**は一致しなければならない（全単射・集合一致）。展開プロセスのフィードバック入力（`>>?`）、および子フローの「生成元なし・`>>?` のみ消費」の artifact は照合対象外
* 展開プロセスの出力エッジ（`->`）が指す artifact の **ID 集合**（マップ適用後）と、子フローの **terminal artifact**（`>>` でも `>>?` でも消費されない artifact。判定は §2.9.3 参照）の **ID 集合**は一致しなければならない（全単射・集合一致）
* 境界 ID 協定・メタデータ権威・粒度差の扱いの詳細は §2.9.3 参照
* `subflow:` の値がファイルパスとして存在しない場合は error
* `subflow:` の値が絶対パスまたは URL（`://` を含む）の場合は error
* 循環 subflow（自己参照および多段循環を含む、subflow グラフ全体における任意の循環）は error
* `subflow:` を Artifact に指定した場合は error

`boundary:` マップを指定する場合、checker は加えて以下を検証する。

* マップのキーは展開プロセスの境界 artifact ID（通常入力エッジまたは出力エッジが指す artifact）でなければならない。境界でない ID（フィードバック入力含む）をキーにした場合は error
* マップの値は子フローの境界 artifact ID（open input または terminal）でなければならない。子の境界でない値は error
* 明示マップと未マップ境界の恒等対応を合わせた**実効対応は全単射**でなければならない（非単射・非全射は error）
* **side 整合**: 親の通常入力境界はマップで子の open input へ、親の出力境界は子の terminal へのみ対応づけられる。入力↔出力の越境マップは error
* `boundary:` を `subflow:` のないプロセスに指定した場合は error

### 15.12 extends 制約

1. **パス存在**: `extends:` に指定されたファイルが存在しない場合は error
2. **循環参照禁止**: 自己参照（`extends: ./self`）および多段循環を含む、extends グラフ全体における任意の循環は error。checker が深さ優先で検出する
3. **プリセット汚染禁止**: プリセットファイルが許容トップレベルキー（`extends` / `statusStyles` / `tag` / `group`）以外のキー（`artifact:` / `process:` / `layout:` / `title:` 等）を含む場合は error（§2.9.5 ホワイトリスト）
4. **相対パスのみ**: `extends:` の値が絶対パスまたは URL（`://` を含む）の場合は error
5. **継承解決順**: §2.9.4 に従う（属性レベル深マージ・決定的解決アルゴリズム・ローカル prevail）

### 15.13 index 制約

* `index:` の値は正整数（1 以上の整数）でなければならない。0・負数・非整数は error
* process と artifact は独立した名前空間を持つ。同一名前空間内での重複は warning（別名前空間どうしの同値は許容）
* `index:` はグラフ意味論・トポロジ・終端監査に影響しない
* `pfdsl meta reindex` はトポロジカルソート順に `index:` を採番する。既定は未採番ノードのみ補完し、`--renumber` で全ノードを 1 から振り直す

### 15.14 type 制約

* `type:` に列挙外の値を指定した場合は error (V031)
* 省略時は種別を問わない操作（check / fmt / render 等）を実行する。`pfdsl status ready` / `pfdsl meta set`（status 設定時）/ `pfdsl status gaps`（roadmap引数）は例外的に、省略時は `roadmap` として扱い実行を許可するが warning を出す (W006)。`roadmap` 以外の値を明示指定した場合は error

### 15.15 produced artifact の status 制約

* `type: roadmap` のファイルにおいて、**produced artifact**（少なくとも1つのプロセスの出力として登録されているもの）に `status:` が未設定の場合: warning (W005; strict mode では error)
* **source artifact**（いかなるプロセスの出力でもないもの）は W005 の対象外とする
* `type:` が `roadmap` 以外（`workflow` / `runtime-pipeline`）または省略されているファイルは W005 の対象外とする

---

## 16. エラー方針

処理系は以下のコードをエラーまたは警告として報告する。定義節はそのコードが検証する条件を規範として定める§15 の小節（または該当節）を指す。

| コード | severity | 定義節 | 条件 |
|---|---|---|---|
| FM001 | error | §2.1 | front matter の閉じ `---` がない |
| FM002 | error | §2.1 | front matter の YAML が不正 |
| P001 | error | §8 | 構文不正（汎用トークンエラー） |
| P002 | error | §11 | artifact 集合内で識別子が期待される位置に無い |
| P003 | error | §11 | artifact 集合内でカンマの後に識別子が無い |
| P004 | error | §9 | `->` の後に artifact 式が無い |
| P005 | error | §9 | artifact の後に `>>` または `>>?` が無い |
| P006 | error | §9 | プロセス識別子が期待される位置に無い |
| P007 | error | §10 | チェーン中の `->` の後に artifact 式が無い |
| P008 | error | §10 | チェーン継続でプロセス識別子が無い |
| P010 | error | §10 | チェーン継続で artifact 式が無い |
| P011 | error | §11 | artifact 集合を閉じる `]` が無い |
| V001 | error | §15.1 | 同一 Artifact を複数 Process が生成 |
| V002 | warning (--strict: error) | §15.2 | Process に入力が無い |
| V003 | warning (--strict: error) | §15.2 | Process に出力が無い |
| V004 | error | §15.5 | parts のメンバーが Process |
| V005 | error | §15.5 | parts の自己参照 |
| V006 | error | §15.5 | parts の循環参照 |
| V007 | error | §15.6 | `status` が列挙外の値 |
| V008 | error | §15.6 | `statusStyles` のキーが列挙外の値 |
| V009 | error | §15.6 | `statusStyles` / `tag.<id>.style` の属性キーが許可外 |
| V010 | error | §16 | Primary Graph に循環がある |
| V011 | error | §15.3 | strict mode: feedback artifact がすでに Process の真の上流（逆循環） |
| V012 | error | §15.7 | `criteria:` を Process に指定 |
| V014 | error | §15.8 | `command:` を Artifact に指定 |
| V015 | error | §15.9 | `revises:` を Process に指定 |
| V016 | error | §15.9 | `revises:` の参照先が不在、または文字列でない |
| V017 | error | §15.9 | `revises:` の自己参照 |
| V018 | error | §15.9 | `revises:` の分岐（複数 Artifact が同一 Artifact を revises） |
| V019 | error | §15.9 | `revises:` の循環参照 |
| V020 | warning (--strict: error) | §15.10 | フロントマター宣言 Process が edge に不参加（孤立宣言プロセス） |
| V021 | error | §15.11 | `subflow:` のパスが不在、または絶対パス・URL |
| V022 | error | §15.11 | 循環 subflow（自己参照・多段含む） |
| V023 | error | §15.11 | `subflow:` を Artifact に指定 |
| V024 | error | §15.11 | `boundary:` を `subflow:` のないプロセスに指定 |
| V025 | error | §2.8.4 | group `parent` チェーンの循環 |
| V026 | error | §15.12 | `extends:` のパスが不在、または絶対パス・URL |
| V027 | error | §15.12 | 循環 extends（自己参照・多段含む） |
| V028 | error | §15.12 | プリセットファイルが許容外トップレベルキーを含む |
| V029 | error | §15.13 | `index:` が正整数でない |
| V030 | error | §15.11 | `boundary:` マップのキーまたは値が親/子の境界 artifact でない |
| V031 | error | §15.14 | `type:` に列挙外の値 |
| V032 | error | §15.11 | `boundary:` マップが全単射でない |
| V033 | error | §15.11 | `boundary:` マップの side 越境（入力↔出力） |
| V034 | error | §15.11 | 境界集合の不一致（親 I/O と子 open input / terminal の全単射違反） |
| W001 | warning | §15.5 | parts メンバーが edge に参加していない |
| W002 | warning (--strict: error) | §15.7 | produced Artifact に `criteria:` が未設定 |
| W003 | warning | §15.6 | status 非単調（出力 Artifact が `done` なのに、明示 status を持つ入力 Artifact が `done` 未満） |
| W004 | warning | §15.13 | 同一名前空間内で `index:` が重複 |
| W005 | warning (--strict: error) | §15.15 | roadmap ファイルの produced Artifact に `status:` が未設定 |
| W006 | warning | §15.14 | ready-gate 文脈（status ready / meta set / status gaps）で `type:` 省略ファイルを roadmap として扱う |
| L001 | error | §4.2 | quoted-id の閉じ `"` がない |
| L002 | error | §8 | いずれの有効なトークンも開始しない文字 |
| N001 | error | §5.1 | front matter で同一IDを artifact と process の両方に宣言 |
| N002 | error | §5.1 | graph body で同一IDが artifact と process の両方として使用される |
| N003 | warning | §15.4 | 同一 edge が重複記述されている |

P009 は実装に存在しない（欠番）。V013 は #310 で撤廃された（`location:` を Process に指定することは現在許可されている）。

以下は診断コードとして実装されていない任意の処理系ポリシーである。

* `location:` ファイルパスが存在しない: warning（任意実装。dead link 検出。§15.8 参照）

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
    location: https://github.com/example/repo/issues/42
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

本節はバージョンごとの変更履歴を記す。現行バージョンはタイトル行（`# PFDSL仕様書 vX.Y.Z`）が唯一の権威であり、本節では版番号を重複記載しない。

v0.0.16 からの主な変更点（v0.0.17）：CLI コマンド体系を再編し、フラットな17コマンドを操作対象の種類で分類し直した（graph/meta/status グループ導入）。外部ユーザーが不在の段階のため後方互換は取らず、旧コマンド名は一括で廃止する（**破壊的変更**、旧名は exit 2、ADR-0030）。

* `pfdsl graph <file>`（DOT/SVG/PDF/PNG描画）を `pfdsl render <file>` に改名
* `pfdsl normalize` を `pfdsl graph edges` に改名
* `pfdsl neighbors|impact|depends-on|path|stats` を `pfdsl graph neighbors|impact|depends-on|path|stats` に改名
* `pfdsl check --audit` の終端監査部分を `pfdsl graph io` に分離し、consumer-asymmetry ヒント部分を `pfdsl check --hints` に改名。`check` は検証専念のコマンドになる
* `pfdsl check --summary` を `pfdsl graph summary` に改名
* `pfdsl get` を `pfdsl meta get` に改名。`--field` は省略可能になり、指定フィールドの生値に加えて `location.resolved` / `command.cwd` 等の派生フィールドを返す
* `pfdsl sort-meta` を `pfdsl meta sort` に改名
* `pfdsl reindex` を `pfdsl meta reindex` に改名
* `pfdsl status-set <file> <id> <status>` を `pfdsl meta set <file> <id> status <status>` に改名し、任意のスカラーフィールド・カンマ区切り複数 id 指定へ汎用化
* `pfdsl ready` を `pfdsl status ready` に改名
* `pfdsl audit-sync` を `pfdsl status gaps` に改名（roadmap とは同期しないコマンドのため audit-sync の名を廃した）
* `pfdsl fmt --mode flat|flows` を廃止し、fmt は常に flows 形式で出力する

v0.0.15 からの主な変更点（v0.0.16）：V020/V002/V003 を非 strict（デフォルト）では warning に降格し、`--strict` で従来どおり error とする（#480）。書き途中グラフ（孤立宣言 process・入出力未接続の process）を非 strict の `check` で許容するための変更。**破壊的変更**: 該当条件のみを持つファイルは非 strict の `check` で exit code が 1 から 0 に変わる。CI 等で完全性を強制したい利用者は `--strict` を明示する必要がある。

* §15.2 プロセス完全性制約（V002/V003）の severity を非 strict では warning、strict では error に変更
* §15.10 孤立宣言プロセス制約（V020）の severity を非 strict では warning、strict では error に変更
* §16 診断表の V002/V003/V020 の severity 列を更新

v0.0.14 からの主な変更点（v0.0.15）：v0.0.11 全体レビューおよび extends プローブの残余 findings を反映した編集整備パス（#300）。破壊的変更ではない（valid/invalid 判定は不変。既存挙動の明文化・文書整理のみ）。

* §3.3 「終端成果物」を audit-terminal（監査対象・フィードバック消費を無視）と boundary-terminal（subflow 境界対象・フィードバック消費を除外）の二述語に分離命名（F3）
* §2.9.1 status 系検査（W003 含む）がファイル単位で閉じることを明記（F21）
* §2.9.3 境界判定が edge 参加 artifact のみを対象とすること（F5）・展開プロセスが通常入力を1つ以上持つべきこと（F6）・子 terminal 過多時は親出力 edge を増やすのが正攻法であること（F12）を追記。メタデータ権威を実効対応（`boundary:` マップ ⊕ 恒等）ベースへ書き換え（F10）
* §2.9.4 `tag.<id>.style` の属性単位深マージ（F23）・`resolve()` 返り値の完全性（F25）を明記し、diamond の値衝突 worked example を追加（F24）
* §15.2 プロセス完全性の「1入力」に `>>?` を含むことを明記（F6）
* §15.3 strict feedback 検査の方向（P から順方向に到達可能）を明記（F11）
* §15.9 revises 分岐禁止の理由（最新版の一意判定）を追記（F14）
* §15.10 frontmatter のみ宣言 artifact が V020 と非対称に無検査である理由を明記（F7）
* §4.1 bare-id 禁止文字に `,` と空白区切りを追記（F9）
* §2.7.1 status gloss を git 固有表現から一般語へ（git は例として括弧書き）（F13）
* §14 タイトルを「正準順序（fmt が従う規範）」に改め normative 位置づけを明記（F18）
* §2.3 basePath を document-level 小節として ID メタデータより前へ移し、`subflow:` / `extends:` の解決基準に影響しないことを追記（F16 / F22）。subflow / boundary の規範散文を §2.9.3 / §15.11 へ一本化（F16 / F19）
* §13 subflow 切り出しが構造 diff 上は全張り替えになる帰結を注記（レビュー §6-4）

v0.0.13 からの主な変更点（v0.0.14）：

* §16 エラー方針を「コード / severity / 定義節 / 条件」の表に改める（#299）
  * P 系（パースエラー）コード族を含む全診断コード（FM/P/V/W）を表に列挙する
  * `location:` ファイルパス不在の dead link 検出と重複 edge は診断コード未実装の任意ポリシーとして表外に注記する
* §15.5 に W001（parts メンバーが edge に不参加）の定義を移す。従来 §16 の散文にのみ存在していた
* §15.6 に W003（status 非単調）の定義を移す。従来 §16 の散文にのみ存在していた
* §15.11 に `subflow:` の絶対パス・URL 禁止（error, V021）を追記し、extends 側（§15.12-4）と対称化する
* core パッケージから `DIAGNOSTIC_REGISTRY` をエクスポートし、この表との一致を CI（`check-diag-registry.mjs`）が検査する
* 破壊的変更ではない（従来 valid/invalid だったファイルの判定は変わらない — ドキュメント整備とツール化のみ）

v0.0.12 からの主な変更点（v0.0.13）：

* §2.3 / §15.8 / §16 `location:` を Process にも許可（#310）
  * §2.3 artifact 専用フィールドから artifact/process 共有フィールドへ移動
  * §15.8 「`location:` を Process に指定した場合は error」制約を撤廃（`command:` を Artifact に指定は引き続き error）
  * 破壊的変更ではない（従来 valid だったファイルは引き続き valid — 検証の緩和のみ）

v0.0.11 からの主な変更点（v0.0.12）：

* §2.9.3 / §15.11 subflow 境界の open input 定義を terminal と対称化（#298）
  * open input artifact = 生成元プロセスを持たず、**かつ通常入力（`>>`）で1回以上消費される** artifact
  * 生成元を持たずフィードバック入力（`>>?`）でのみ消費される artifact は横断的ループの要素であり境界照合から除外する
  * フィードバックループを跨ぐプロセスの subflow 階層化が可能になる（従来 valid だったファイルは引き続き valid — 検証の緩和のみ）

v0.0.10 からの主な変更点（v0.0.11）：

* **破壊的変更**: `status: blocked` を廃止し `waiting` と `suspended` の 2 値に分割（§2.7.1）
  * `waiting` — 外部要因待ち（locus of control: 他者）
  * `suspended` — 自主的な一時中断・再開予定あり（locus of control: 自分たち）
  * `blocked` は V007 error（deprecated 期間なし）
  * `statusStyles` の `blocked:` キーも V008 error
* §15.7 W002 criteria 制約を改訂: source artifact（プロセスの出力でない入力専用 artifact）を W002 対象外に変更
* §2.10 `type:` フィールドを追加（roadmap | workflow | runtime-pipeline）
  * 列挙外の値は V031 error
  * `pfdsl ready` は `type: roadmap` 以外を明示指定した場合 error。省略時は `roadmap` として扱い許可
* §15.15 W005 status 制約を追加: `type: roadmap` ファイルの produced artifact（`->` で生成される artifact）に `status:` が未設定の場合 warning（strict mode では error）。source artifact と非 roadmap ファイルは対象外

v0.0.9 からの主な変更点（v0.0.10）：

* `basePath:` フィールドを追加（§2.3 / §15.8）。`location:` ファイルパス解決と `command:` 実行ディレクトリの基準を変更する。省略時は `.pfdsl` ファイルのディレクトリ（後方互換）

v0.0.8 からの主な変更点（v0.0.9）：

* §2.3 `index:` を artifact / process の共有フィールドに追加（省略可能な正整数。pfd-tools 等の外部ツールが `P{index}` / `D{index}` として解釈するための採番フィールド）
* §15.13 index 制約を追加（正整数必須・名前空間独立・重複 warning・グラフ意味論に影響しない）
* `pfdsl reindex` コマンドを追加（トポロジカルソート順に `index:` を採番。既定は未採番ノードのみ補完・`--renumber` で全振り直し）

v0.0.7 からの主な変更点（v0.0.8）：

* §2.9 マルチファイル意味論を新設（複数 `.pfdsl` ファイルにまたがる参照の共通前提）
* §2.9.1 ファイルローカル ID スコープを規定（各ファイルが独立 ID 名前空間。V001/V002/V003 はファイル単位で成立）
* §2.9.2 ファイル間参照規則を規定（常に相対パス・基準は含むファイルの位置。絶対パス・URL 不可）
* §2.3 Process に `subflow:` フィールドを追加（子フローへの階層展開ビューリンク。#5）
* §2.9.3 subflow 意味論を規定（ビューリンク・境界 ID 協定・V001 非侵犯）
* §2.2 `extends:` トップレベルキーを追加（プリセット継承。#6）
* §2.9.4 extends 継承解決を規定（対象は statusStyles / `tag`（§2.7.4）/ group のみ。ローカル prevail。マージ規則の詳細は後掲の深マージ・決定的解決を参照）
* §2.9.5 プリセットファイル形式を新設（許容キー・`artifact`/`process` 混入禁止・多段 extends）
* §15.11 subflow 境界整合制約を追加（open input / terminal 境界一致・パス存在・循環禁止・Artifact 指定禁止）
* §2.9.3 / §15.11 subflow 境界整合を全単射（ID 集合一致・双方向）に強化。フィードバック入力（`>>?`）を境界照合対象外と明記
* §2.9.3 境界 artifact のメタデータ権威規則を追加（食い違い時は親ファイル優先）
* §2.3 / §2.9.3 / §15.11 subflow に任意の `boundary:` リネームマップ（親ID↔子ID の 1:1 全単射）を追加。独立命名された子フローの再利用を可能化（旧「1 親 : 1 子」制約を解消）。粒度差は子フロー内部の分割で扱い N:M 対応は不可と明記
* §15.11 循環 subflow の検出範囲を「自己参照および多段循環を含む subflow グラフ全体の任意の循環」に一般化
* §13 正規形に subflow の非展開を明記（normalize は subflow を展開も保持もしない）
* §15.12 extends 制約を追加（パス存在・循環禁止・プリセット汚染禁止・相対パスのみ）
* §2.9.4 extends マージを属性レベル深マージと明記（兄弟属性を保持。`statusStyles.<status>.<attr>` / `tag.<id>.<field>` / `group.<id>.<field>` に再帰適用）
* §2.9.4 多段・複数 extends の解決を決定的アルゴリズムとして明記（深さ優先・後勝ち・ローカル最優先。diamond の解決順を確定）
* §2.9.4 共有対象外キー（`layout` / `title` / `dslVersion` 等）の非継承を明記
* §2.9.5 / §15.12 プリセットの許容トップレベルキーをホワイトリスト化（許容外キー混入は error）
* §15.12 循環 extends の検出範囲を「自己参照および多段循環を含む extends グラフ全体の任意の循環」に一般化
* §2.3 / §15.8 `location:` フィールドをスカラーまたは文字列配列で指定可能に拡張（後方互換。スカラーは単一要素配列と等価）。href 出力条件を単一 URL の場合のみに限定（#182）
* §2.8.1 `group` に `parent:` フィールドを追加（省略可）。指定した場合、Graphviz 出力でサブグループを親クラスタ内にネスト描画する。V025（循環 parent chain: error）を追加（#183）

v0.0.6 からの主な変更点（v0.0.7）：

* §2.3 `status` が Artifact 専用フィールドであることを明記（§2.7 参照）
* §2.7.2 `tags` を Artifact / Process の両方に許可（`group` §2.8 と対称）。`tag` の style を Process node にも適用する（status は Artifact 専用のまま）
* §2.7.4 `tag` 定義ブロックを新設（`label` / `description` / `style` をタグごとに宣言。`artifact` / `process` / `group` と同階層）
* `tagStyles` トップレベルキーを廃止し `tag.<id>.style` に統合（v0.0.6 互換性のない変更。タグ定義を一元化）
* §2.3 Artifact に `criteria:` フィールドを追加（完了条件の自己文書化）
* §2.3 Artifact に `location:` フィールドを追加（実体ファイル/URL へのポインタ）
* §2.3 Artifact に `revises:` フィールドを追加（バージョン系列の明示）
* §2.3 Process に `command:` フィールドを追加（実行手順の記述）
* §15.7 criteria 制約を追加（`status: done` + `criteria:` 欠如 → warning）
* §15.7 criteria 制約を拡張（全 status の `criteria:` 欠如 → warning）
* §15.8 location 妥当性制約を追加（ファイルパス存在検証、任意実装）
* §15.9 revises 制約を追加（参照先存在・自己参照禁止・線形性・循環禁止）
* §15.10 孤立宣言プロセス制約を追加（フロントマター宣言 Process が edge 不参加 → error、V020）
* §15.2 プロセス完全性制約を補足（node-decl の孤立は対象外、フロントマター宣言は §15.10 対象と明記）
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
