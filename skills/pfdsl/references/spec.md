<!-- DO NOT EDIT — snapshot distributed with pfdsl skill. Authoritative source: https://github.com/takasek/pfdsl/blob/main/docs/spec/spec.md -->

# PFDSL仕様書 v0.0.12

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

#### artifact 専用フィールド（criteria / location / revises）

`status` も Artifact 専用フィールドである（§2.7 参照）。`tags` は Artifact / Process 両方に指定できる（`group` §2.8 と対称。§2.7.2 参照）。

**criteria** — 成果物の完了条件（任意文字列）。`status` を問わず事前宣言として設定可。モデル内で完了根拠を自己文書化する。1 Artifact につき 0 または 1 個。§15.7 参照。

**location** — 成果物の実体ファイル・リソースへのポインタ（パス、glob、または URL）。スカラー文字列または文字列配列で指定する（後方互換: スカラーは単一要素配列と等価）。相対パスの基準は含む `.pfdsl` ファイルの位置。グラフ意味論に影響しない。§15.8 参照。

**revises** — この成果物が改版する元成果物の ID（同一ファイル内）。バージョン系列を明示する。1 Artifact につき 0 または 1 個。§15.9 参照。

可視化バックエンドは `criteria:` / `location:` を tooltip に `description:` と並べて表示してよい。`location:` が単一の URL を指す場合に限り、Graphviz の `href` 属性として出力してよい（複数・ファイルパスの場合は出力しない）。

#### artifact と process の共有フィールド（owner / externalStakeholders）

**owner** — 成果物またはプロセスの内部責任者（任意文字列）。グラフ意味論に影響しない。1 ノードにつき 0 または 1 個。

**externalStakeholders** — 変換グラフの参加者でない外部消費者の列挙（文字列配列、省略可能）。外部提出先・最終消費者・規制当局など「フロー外で成果物を受け取る主体」を明示する。`owner`（内部責任者）と対称のフィールド。

`externalStakeholders` を持つ成果物は終端監査（`pfdsl check --audit`）において消費者あり扱いとなり、孤立終端として報告されない。

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
`pfdsl reindex` コマンドでトポロジカルソート順に自動採番できる。
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

#### process 専用フィールド

**command** — プロセスに対応する実行可能なコマンド文字列（任意文字列）。グラフ意味論に影響しない。1 Process につき 0 または 1 個。

**subflow** — 当該プロセスを子フローへ展開するビューリンク（文字列）。値は子 `.pfdsl` への相対パス（基準は含む `.pfdsl` ファイルの位置、`location:` と同規則）。生成の複製ではない（V001 非侵犯）。相対パスのみ許可。絶対パス・URL（`://` 形式）は不可。1 Process につき 0 または 1 個。意味論の詳細は §2.9.3 参照。

**boundary** — `subflow:` を持つプロセス専用の任意フィールド。親の境界 artifact ID を子の境界 artifact ID へ対応づける 1:1 全単射マップ（`親ID: 子ID` の YAML マップ）。独立に命名された子フローを再利用するために用いる。省略時は境界を同一 ID で照合する。詳細・制約は §2.9.3 / §15.11 参照。

```yaml
process:
  order_fulfill:
    label: 受注処理
    subflow: ./order_fulfill_sub.pfdsl
    boundary:                 # 任意。親ID: 子ID の 1:1 全単射
      order: incoming_order
      fulfilled_order: outgoing_parcel
```

#### document-level フィールド（basePath）

**basePath** — フロントマター全体に適用するパス解決基準（省略可能な文字列）。`location:` のファイルパス解決と `command:` の実行ディレクトリ（cwd）の両方に適用する。値は含む `.pfdsl` ファイルのディレクトリからの相対パスで指定する。省略時は `.pfdsl` ファイルのディレクトリをデフォルトとして後方互換を保つ。

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
  * `todo` — 未着手（artifact 未生成）
  * `wip` — 生産中（ブランチ・PR がオープン、artifact が部分的に存在する）
  * `done` — 完了（artifact が main にマージ済み）
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

#### 2.9.1 ファイルローカル ID スコープ

各 `.pfdsl` ファイルは独立した ID 名前空間を持つ。artifact ID および process ID はファイル内でのみ一意であればよい。グローバルレジストリは持たない。

異なるファイルが同名 ID を持っていても衝突しない。制約 V001（§15.1 単一生成元制約）/ V002（§15.2 プロセス完全性制約）/ V003（§15.3 フィードバック妥当性制約）はファイル単位で成立すれば十分とする。

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
* 内部（非境界）の artifact / process ID は各ファイルで自由に定義できる

**境界 artifact のメタデータ権威** — 境界 artifact は親ファイルと子ファイルの両方で宣言されうるが、共有されるのは ID のみである。`status` / `label` / `criteria` 等のメタデータが食い違う場合は、展開プロセスを持つ**親ファイルの宣言を優先**する。複数ファイルを平坦化して描画・解析する処理系はこの規則に従う。

**境界リネームマップ（`boundary:`）** — 既定では境界 artifact を同一 ID で照合するため、独立に命名された子フローを境界 ID の異なる複数の親プロセスで再利用できない。これを解消するため、展開プロセスに任意の `boundary:` マップ（`親ID: 子ID`）を指定してよい。

* マップは親の境界 artifact ID を子の境界 artifact ID へ対応づける **1:1 全単射**である。置換（swap）を含む任意の全単射を許す
* マップに現れない境界 artifact は**同一 ID で照合**される（部分マップ可）。明示マップと未マップの恒等対応を合わせた**実効対応が全単射**でなければならない
* **side 整合**: 親の通常入力境界は子の open input へ、親の出力境界は子の terminal へのみ対応づけられる（入力↔出力の越境は不可）
* フィードバック入力（`>>?`）は境界外のため、マップのキーにできない
* マップにより、同一子フローを `boundary:` の異なる複数の親プロセスで再利用できる

**粒度差の扱い** — `boundary:` は境界 ID の 1:1 貼り替えのみを行い、粒度（artifact の分割・併合）は変えない。親が粗い `order`、子が細かい `order_header` / `order_lines` を扱う場合は、子フロー**内部**で分割プロセスを置く（`order >> split -> [order_header, order_lines]`）。境界は粗いまま `order` で保つ。1 つの親境界を複数の子境界の併合として表す N:M 対応は、親 artifact 同士の重複（overlap）を招くため許可しない。重複が真に必要なら、その共有 artifact を親子両レベルの独立した境界 artifact として細粒度で揃える。

制約の機械検証は §15.11 参照。

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

* **属性レベル深マージ**: マージはブロック丸ごとの置換ではなく、属性レベルの再帰（深）マージである。ローカルが `statusStyles.done.fillcolor` のみ上書きした場合、プリセット由来の `statusStyles.done.fontcolor` 等の兄弟属性は保持される。同じ規則が `statusStyles.<status>.<attr>` / `tag.<id>.<field>`（label / description / style）/ `group.<id>.<field>` に再帰的に適用される
* **ローカル prevail**: ローカル定義は常に全プリセットに勝つ
* **解決アルゴリズム（決定的）**: ファイル F の実効 frontmatter は次で計算する。`extends: [P1, P2, ...]` のとき、優先度の低い順に `resolve(P1) → resolve(P2) → … → F のローカル定義` を深マージする（後マージ勝ち）。`resolve(Pi)` は Pi の `extends:` を先に解決してから Pi 自身のローカル定義を上書きした実効値（再帰）
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
* 省略可能。省略時は種別を問わない操作（check / fmt / graph 等）を実行する
* 列挙外の値は error (V031、§15.14)
* `pfdsl ready` は `type: roadmap` 以外の値を明示指定したファイルに対して error を出力する。省略時は `roadmap` として扱い実行を許可する

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
graph body 内の node-decl（edge を持たない孤立ノード）は完全性制約の対象外とする。
フロントマター `process:` セクションで宣言された Process は §15.10 の孤立宣言制約の対象となる。

### 15.3 フィードバック妥当性制約

<!-- pfdsl-nocheck -->
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
* statusStyles および `tag.<id>.style` の属性キーは §2.7.3 の許可属性のみ。許可外は error
* tags 配列の各要素は任意文字列（検証なし）

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

ファイルパスの場合、処理系はファイルの存在を検証してよい（dead link 検出）。相対パスの解決基準は、`basePath:` が指定されている場合はそれをフロントマターレベルで `.pfdsl` ファイルのディレクトリから解決した絶対パス、指定がない場合は含む `.pfdsl` ファイルのディレクトリとする。クロスファイル参照（別 `.pfdsl` への相対パス）は構文上許容するが、その意味論の完全な定義はマルチファイル仕様（将来版）に委ねる。

* `location:` を Process に指定した場合は error
* `command:` を Artifact に指定した場合は error

### 15.9 revises 制約

* `revises:` に指定した ID は同一ファイル内の Artifact ID でなければならない。存在しない場合は error
* 自己参照（`revises: self_id`）は error
* 線形チェーン制約: `revises:` チェーンは単方向の単一リンクリストでなければならない（最新版 → 前版 → … の方向）。複数の Artifact が同一 Artifact を `revises:` で参照することは error（分岐した改版系列）
* 循環参照は error
* `revises:` を Process に指定した場合は error
* クロスファイル revises はマルチファイル仕様（将来版）に委ねる（`location:` のクロスファイル参照扱いと同様、§15.8 参照）

### 15.10 孤立宣言プロセス制約

フロントマター `process:` セクションで宣言された Process が、graph body 内のいずれの edge にも参加していない場合、その Process は孤立宣言プロセス（orphaned process）として error を報告する。

孤立宣言プロセスは終端監査ルール「消費者を書けない成果物は作らない」の Process 版違反であり、チェーン削除時の残骸や未接続の宣言を機械的に検出する（学習ループ ADR-0006 の lint 要件経路）。

graph body の node-decl で宣言された孤立ノード（edge なし）は §15.2 の通り対象外とする（node-decl はデフォルト Artifact 扱いであり、Process 宣言としては機能しない）。

### 15.11 subflow 境界整合制約

`subflow:` を持つ Process（展開プロセス）に対し、checker は以下の境界整合を検証する。`boundary:` マップがある場合は親の境界 ID をマップで変換してから照合する（マップがなければ恒等変換）。

* 展開プロセスの通常入力エッジ（`>>`）が指す artifact の **ID 集合**（マップ適用後）と、子フローの **open input artifact**（生成元プロセス `->` を持たず `>>` で消費されるもの。判定は §2.9.3 参照）の **ID 集合**は一致しなければならない（全単射・集合一致）。展開プロセスのフィードバック入力（`>>?`）、および子フローの「生成元なし・`>>?` のみ消費」の artifact は照合対象外
* 展開プロセスの出力エッジ（`->`）が指す artifact の **ID 集合**（マップ適用後）と、子フローの **terminal artifact**（`>>` でも `>>?` でも消費されない artifact。判定は §2.9.3 参照）の **ID 集合**は一致しなければならない（全単射・集合一致）
* 境界 ID 協定・メタデータ権威・粒度差の扱いの詳細は §2.9.3 参照
* `subflow:` の値がファイルパスとして存在しない場合は error
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
* `pfdsl reindex` はトポロジカルソート順に `index:` を採番する。既定は未採番ノードのみ補完し、`--renumber` で全ノードを 1 から振り直す

### 15.14 type 制約

* `type:` に列挙外の値を指定した場合は error (V031)
* 省略時は種別を問わない操作（check / fmt / graph 等）を実行する。`pfdsl ready` は例外的に、省略時は `roadmap` として扱い実行を許可する。`roadmap` 以外の値を明示指定した場合は error

### 15.15 produced artifact の status 制約

* `type: roadmap` のファイルにおいて、**produced artifact**（少なくとも1つのプロセスの出力として登録されているもの）に `status:` が未設定の場合: warning (W005; strict mode では error)
* **source artifact**（いかなるプロセスの出力でもないもの）は W005 の対象外とする
* `type:` が `roadmap` 以外（`workflow` / `runtime-pipeline`）または省略されているファイルは W005 の対象外とする

---

## 16. エラー方針

処理系は以下をエラーまたは警告として報告する。`criteria:` 制約（§15.7）は独立した severity を持ち、strict option として個別に設定可能とする。

* 構文不正: error
* 型矛盾: error
* 単一生成元違反: error
* 不正YAML: error
* 不正parts参照: error
* 不正 status / statusStyles / `tag.<id>.style`: error
* `location:` / `revises:` / `criteria:` を Process に指定: error
* `command:` を Artifact に指定: error
* `criteria:` 未設定の produced Artifact（§15.7）: warning (W002; strict mode では error)
* `location:` ファイルパスが存在しない: warning（任意実装）
* `type:` に列挙外の値: error (V031)
* parts メンバーが edge に参加していない: warning (W001)
* プロセスの出力 Artifact が `done` なのに入力 Artifact の明示 status が `done` 未満: warning (W003; status 未宣言の Artifact は対象外)
* `type: roadmap` ファイルで `status:` 未設定の produced Artifact（§15.15）: warning (W005; strict mode では error)
* `revises:` 参照先不在 / 自己参照 / 分岐 / 循環: error
* 重複edge: warning可
* フロントマター宣言 Process が edge に不参加（孤立宣言プロセス、§15.10）: error
* `subflow:` を Artifact に指定: error
* `subflow:` の値がファイルパスとして存在しない: error
* 循環 subflow（自己参照・多段含む）: error
* `boundary:` マップが全単射でない / side 越境 / キーが親境界外 / 値が子境界外: error
* `boundary:` を `subflow:` なしのプロセスに指定: error
* `extends:` のパスが存在しない: error
* 循環 extends（自己参照・多段含む）: error
* プリセットファイルに許容外トップレベルキー（`artifact:` / `process:` / `layout:` / `title:` 等）混入: error
* `extends:` の値が絶対パスまたは URL: error
* 循環 `parent` チェーン（自己参照・多段含む、V025）: error

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

本仕様は PFDSL仕様書 v0.0.12 とする。

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
