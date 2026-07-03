# 合否基準フィールド仕様案 (#7)

## 対象仕様バージョン

v0.0.6 → v0.0.7

## 概要

Artifact に `criteria:` フィールドを追加する。成果物が完了（`status: done`）とみなされる条件を明示し、モデル内で完了根拠を自己文書化する。

清水吉男氏の PFD 方法論では各成果物に合否基準（exit criteria）を定義することが推奨されている。本提案はこの概念を PFDSL のモデルに組み込む。

## 仕様変更

### §2.3 IDメタデータ定義 への追加

`criteria:` は artifact メタデータに追加できる任意フィールド。

```yaml
artifact:
  design_doc:
    label: 設計書
    status: wip
    description: API設計・画面設計・DB設計を含む技術設計書
    criteria: Tech Lead 承認かつ未解決設計質問がすべて解消されていること
```

フィールド定義:
- 型: 文字列（自由記述）
- 個数: 1 Artifact につき 0 または 1 個
- 対象: Artifact のみ（Process には適用しない）

### §2.2 front matter キー一覧

変更なし（`artifact` キー配下の属性追加のみ）。

### §15 制約 への追加（§15.7 として）

#### 15.7 criteria 制約

`status: done` かつ `criteria:` 未設定の Artifact → warning

strict mode では error に昇格してよい。

### §16 エラー方針 への追加

| 状況 | 標準 | strict mode |
|------|------|-------------|
| `status: done` かつ `criteria:` 未設定 | warning | error |

### §2.3 renderer 利用（注記追加）

可視化バックエンドは `criteria:` を tooltip に `description:` と並べて表示してよい。

## 設計判断

### なぜ Artifact のみか

Process は純粋関数であり「完了」という状態を持たない（`status` フィールドが Artifact 専用のため）。

### なぜデフォルト warning か

既存 `.pfdsl` ファイルとの互換性維持。`criteria:` を強制したいプロジェクトは strict mode を選ぶ。

### checker の警告タイミング

`status: done` + `criteria:` 未設定 の組み合わせのみ検査する。`status: wip` / `todo` / `waiting` / `suspended` では警告しない。

## 影響範囲

- §2.3 IDメタデータ定義: `criteria:` フィールド追加
- §15 制約: §15.7 追加
- §16 エラー方針: warning 行追加
- §17 例: 例示追加推奨
- checker 実装: `done` + `criteria:` 欠如の検出ルール追加
- graphviz-exporter: tooltip に `criteria:` 表示追加
