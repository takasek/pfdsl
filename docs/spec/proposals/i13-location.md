# location/command メタデータ仕様案 (#13)

## 対象仕様バージョン

v0.0.6 → v0.0.7

## 概要

Artifact と Process のメタデータにそれぞれ `location:` と `command:` を追加し、図のノードとリポジトリの実体（ファイル・実行手順）を結びつける。グラフ意味論に影響しない（`layout`/`group` と同層）。

## 仕様変更

### §2.3 IDメタデータ定義 への追加

```yaml
artifact:
  spec:
    label: 仕様書
    location: docs/spec/spec.md

process:
  gen_skill:
    label: スキル生成
    command: make gen-skill
```

#### location（Artifact 専用）

- 型: 文字列
- 値: 相対パス、glob、または URL
- 相対パスの基準: 含む `.pfdsl` ファイルの位置
- 個数: 1 Artifact につき 0 または 1 個
- 意味論: 当該成果物の実体ファイル・リソースへのポインタ

#### command（Process 専用）

- 型: 文字列
- 値: 実行可能なコマンド文字列
- 個数: 1 Process につき 0 または 1 個
- 意味論: 当該プロセスに対応する実行手順

### §15 制約 への追加（§15.8 として）

#### 15.8 location 妥当性制約

`location:` の値がファイルパスの場合、checkerはファイルの存在を検証してよい（dead link 検出）。

URL および glob パターンの場合は検証対象外とする。

### renderer 利用（§2.3 注記追加）

可視化バックエンドは `location:` を Graphviz の `href` 属性として出力してよい。これにより SVG 出力がリポジトリのサイトマップとして機能する。

## 設計判断

### なぜ Artifact に `location:`、Process に `command:` を分けるか

Artifact = 状態（ファイル・文書）、Process = 動作（手順・コマンド）。それぞれの実体の種類が異なる。

### multifile 方針との関係

パス解決規則（「含む .pfdsl ファイルからの相対パス」）が multifile 意味論（#5/#6）と接する唯一の点。ただし multifile 確定前でも単一ファイル内での利用はこの規則で完結するため、独立して仕様化できる。

### なぜ意味論に影響させないか

`location:` / `command:` をグラフ制約（単一生成元・完全性）の対象にすると既存ファイルとの互換性が失われる。`layout` / `group` と同様に処理系が無視しても有効なオプションとする。

## 影響範囲

- §2.2 front matter キー一覧: 変更なし（artifact / process キー配下の属性追加のみ）
- §2.3 IDメタデータ定義: `location:` / `command:` 追加
- §15 制約: §15.8 追加（checker 任意実装）
- graphviz-exporter: `location:` → `href` 属性出力
- checker 実装: ファイルパス存在検証ルール追加
