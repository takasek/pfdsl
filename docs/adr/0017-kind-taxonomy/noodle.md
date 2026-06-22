# Agent: noodle

## user


あなたはPFD（Process Flow Diagram）の設計者です。
以下のプロジェクトに対して、どのようなPFDファイルを作成すべきかを設計してください。

## プロジェクト: Noodle

料理レシピ共有モバイルアプリ。
- iOSチームとバックエンドチームの2チーム構成
- ユーザーがレシピを投稿・検索・お気に入り登録
- バックエンド: Node.js API + PostgreSQL
- 検索機能のためにレシピデータをElasticsearchにインデックス化するバッチ処理がある
- 毎週スプリントでリリースを繰り返す継続的開発
- APIの変更はiOSチームとのインターフェース合意が必要



## PFDSL 基礎構文
- A >> P : ArtifactをProcessの入力に
- P -> B : ProcessがArtifactを出力
- A >>? P : フィードバック入力（破線）
- [a, b] >> P : 複数入力

## PFDの品質原則
- 各artifactは生産者が最大1つ（V001）
- 各プロセスは入力・出力を持つ（V002/V003）
- 「最終成果物から遡って書く」
- プロセス名は変換が見える動詞句
- 成果物名は保管できるモノの名詞


## タスク

1. このプロジェクトに必要なPFDファイルを列挙してください（ファイル名と一言の目的）
   - 複数必要な場合は全て挙げる
   - 1ファイルで済む場合はその理由も述べる

2. 各PFDファイルについて、その特徴を説明してください
   - 時間軸の有無（収束型・循環型・構造型など）
   - 主語（何を/誰を中心に記述しているか）
   - このPFDが「ない場合に見えなくなること」

3. 最も重要な1つのPFDについて、実際のPFDSL形式で骨格を書いてください（frontmatter + 主要な5〜10エッジ程度）

## 制約
- 一般的な「PFDの種別理論」は意識しなくていい。このプロジェクトに素直に向き合うこと
- 「とりあえず1ファイルにまとめる」ではなく、分割が必要なら理由を述べて分割する
- PFDSL構文の制約（V001/V002/V003）を守る


---

## assistant

## 1. 必要なPFDファイルの列挙

**3ファイル**必要だと判断する。

| ファイル名 | 目的 |
|---|---|
| `recipe_lifecycle.pfdsl` | レシピが投稿されてから検索・お気に入りに使われるまでのデータの流れ |
| `api_contract.pfdsl` | iOSチームとバックエンドチームのインターフェース合意プロセス |
| `sprint_delivery.pfdsl` | スプリントの計画→実装→リリースの繰り返しサイクル |

**分割理由:**
- `recipe_lifecycle` はデータの変換（何がどう加工されるか）を記述する構造型。他の2つとは時間軸の性質が異なる
- `api_contract` はチーム間の合意という意思決定フローで、レシピデータの流れとは主語が違う（チームが主語）
- `sprint_delivery` は週次ループという繰り返し構造で、前の2つを包含するメタレイヤー。1ファイルに混ぜるとV001違反（同じartifactを複数ファイルの生産者として扱うことになる）が起きやすい

---

## 2. 各PFDの特徴

### `recipe_lifecycle.pfdsl`

- **時間軸:** 収束型。「投稿」という起点から「検索インデックス」「お気に入りリスト」という複数の終端に向かって収束する。バッチ処理が非同期なので並列ブランチがある
- **主語:** レシピデータそのもの。データが変換・複製・インデックス化されていく過程
- **ない場合に見えなくなること:** Elasticsearchへのインデックスがリアルタイムではなくバッチであること、つまり「投稿直後は検索に出ない」というタイムラグ。これはiOSチームがUXを設計する上で知らないと困る事実

### `api_contract.pfdsl`

- **時間軸:** 収束型（合意という終端がある）。ただし差し戻しループ（iOSからの修正要求）が存在する
- **主語:** iOSチームとバックエンドチームの合意プロセス。人・チームが主語
- **ない場合に見えなくなること:** APIスキーマがどのタイミングで、誰の承認を経て確定するかが不明確になる。変更が「なし崩し」で入り、iOS側のビルドが壊れるリスクの所在が見えない

### `sprint_delivery.pfdsl`

- **時間軸:** 循環型。1スプリント（1週間）を1サイクルとして繰り返す
- **主語:** チーム全体の開発活動。スプリントイベント（計画・実装・レビュー・リリース）が主語
- **ない場合に見えなくなること:** `recipe_lifecycle` の改善（例: バッチ頻度の変更）や `api_contract` の更新がどのスプリントイベントで発生するかが見えない。「いつ変更が入るか」の文脈が失われる

---

## 3. 最も重要なPFDの骨格

`recipe_lifecycle.pfdsl` が最重要。なぜなら:
- このプロジェクト固有の複雑性（バッチ非同期、2チーム間のデータ依存）が最も凝縮されている
- iOSチームとバックエンドチームが「同じデータの流れ」を共有するための唯一の根拠になる

```pfdsl
---
title: Recipe Lifecycle
description: レシピ投稿から検索・お気に入り利用までのデータ変換フロー
---

# Nodes

artifact PostedRecipe
artifact ValidatedRecipe
artifact StoredRecipe
artifact RecipeSearchIndex
artifact FavoriteList
artifact SearchResults

process validateAndEnrich "入力を検証してメタデータを付与する"
process persistToDatabase "PostgreSQLに永続化する"
process indexForSearch "Elasticsearchにバッチインデックスする"
process searchRecipes "クエリを実行して候補を返す"
process addToFavorites "ユーザーのお気に入りに追加する"

# Edges

PostedRecipe >> validateAndEnrich
validateAndEnrich -> ValidatedRecipe

ValidatedRecipe >> persistToDatabase
persistToDatabase -> StoredRecipe

StoredRecipe >> indexForSearch
indexForSearch -> RecipeSearchIndex

RecipeSearchIndex >> searchRecipes
searchRecipes -> SearchResults

StoredRecipe >> addToFavorites
addToFavorites -> FavoriteList
```

**骨格で意図的に表現したこと:**

- `StoredRecipe` から `indexForSearch` と `addToFavorites` の2つのプロセスが出ている点が「バッチは非同期・別経路」を視覚的に示す
- `ValidatedRecipe` という中間artifactを明示することで「バリデーション失敗はここで止まる」という意味を持たせている（V001: 生産者は `validateAndEnrich` の1つだけ）
- `FavoriteList` の生産者は `addToFavorites` のみ（ユーザーのアクションが起点）という所有関係が明確