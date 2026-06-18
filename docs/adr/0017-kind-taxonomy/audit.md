# Agent: audit

## user


以下は4つの異なる仮想プロジェクトに対して、独立したエージェントがそれぞれPFD設計を行った結果です。
あなたはPFDの種別分類理論を構築しようとしている審査者です。

## 各プロジェクトの設計結果


### Noodle
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

---

### Mentori
構造を十分に把握できました。Mentoriプロジェクトのために設計を行います。

---

## 1. 必要なPFDファイルの列挙

**3ファイル構成を推奨します。**

---

### `ecosystem.pfdsl` — 成果物の生態系図

成果物（ガイド文書・サンプル対話集・ADR・スキル本体）がどこから生まれ、どこで消費されるかを定義する構造マップ。「消費者を書けない成果物は作らない」の終端監査機能。

---

### `roadmap.pfdsl` — 開発ロードマップ

スキルの初版構築から配布・改善サイクル確立までの実装進捗を artifact の status で可視化する。実装作業の着手順を示す依存グラフ。

---

### `improvement_cycle.pfdsl` — 改善サイクル図

「対話 → 知見抽出 → ガイド更新 → スキル再生成 → 配布」という定常ループを専用に記述する。ecosystem は「何があるか」、この図は「どう回るか（時間的流れ）」を担う。

---

**分割する理由:**

- ecosystem と improvement_cycle は**抽象度が異なる**。ecosystem は「成果物の住処と消費者」を問う構造図（時間軸なし）。improvement_cycle は「誰が何を変換して次に渡すか」という変換の連鎖（時間的な流れあり）。同一ファイルに混ぜると「会場・スポンサー手配」式の偽依存が生まれる。
- roadmap は**実装フェーズ限定**の進捗管理用途であり、定常運用ループとは寿命が違う（完成したら参照が減る）。

---

## 2. 各PFDファイルの特徴

### `ecosystem.pfdsl`

- **時間軸**: なし（構造型）。「この成果物は誰が作り、誰が読むか」の静的マップ
- **主語**: 成果物。「ガイド文書が何に使われるか」「ADRはどこで生きるか」を中心に記述
- **これがない場合に見えなくなること**: 誰も読まないドキュメントが増殖する。サンプル対話集が「書いたけど参照されていない」状態が検出できない。新種の成果物を追加するとき「本当にこれ要る？」の問いを立てる場所がない

### `roadmap.pfdsl`

- **時間軸**: あり（収束型）。スキル初版 → CI設定 → 配布 → 品質監査の順序依存を示す
- **主語**: 実装タスク。「何が終われば次に進めるか」の依存が主題
- **これがない場合に見えなくなること**: 「ガイド文書が書けていないとスキル生成できない」「配布前にサンプル対話集が必要」などの順序制約が頭の中にしかない。着手可能作業が判断できず、並行してよい作業と待つべき作業の区別がつかない

### `improvement_cycle.pfdsl`

- **時間軸**: あり（循環型）。ただし循環は `>>?` で表現し、primary graph は DAG
- **主語**: 改善ループ自体。「対話から学習し、スキルを育てる」という Mentori の核心プロセス
- **これがない場合に見えなくなること**: 改善が「なんとなくやっている」状態になる。「どの対話のどの知見が、どのガイドのどの記述に反映されたか」のトレーサビリティが消える。レビューの結果がスキルに戻る経路が設計されていないとサイクルが止まる

---

## 3. 最重要PFDの骨格 — `improvement_cycle.pfdsl`

このプロジェクトの存在意義は「スキルが対話から自己改善する」ことなので、その流れを最初に明確にするのが最重要です。

```yaml
---
title: Mentori 改善サイクル
description: >
  対話セッションを起点に学習パターンを抽出し、ガイド文書・ADRを更新し、
  スキルを再生成・配布するまでの変換連鎖。定常運用ループ。
  循環は >>? で表現し、primary graph は DAG。
layout:
  direction: LR
  maxWidth: 130

group:
  input:
    label: 入力・観察
    color: "#f3e8fd"
  extraction:
    label: 知見抽出
    color: "#e8f4fd"
  knowledge:
    label: 知識記録
    color: "#fdf2f8"
  generation:
    label: スキル生成
    color: "#eafaf1"
  distribution:
    label: 配布
    color: "#fde8e8"

artifact:
  session_log:
    label: 対話セッションログ
    group: input
    description: "ユーザーとのメンタリング対話の記録。学習パターン抽出の一次情報"
  review_record:
    label: 品質レビュー記録
    group: input
    description: "定期的な対話品質レビューの結果文書。改善点と評価観点を含む"
  learning_patterns:
    label: 学習パターン集
    group: extraction
    description: "抽出された学習スタイル・つまずき傾向・効果的な介入パターン"
  adrs:
    label: ADR
    group: knowledge
    description: "設計決定記録。スキル設計・対話戦略の根拠文書"
  mentoring_guide:
    label: メンタリングガイド
    group: knowledge
    description: "スキルの品質ガイド文書。学習パターンとADRを反映した一次情報"
  sample_dialogues:
    label: サンプル対話集
    group: knowledge
    description: "ガイドの実証例。スキル生成時の references として同梱"
  mentori_skill:
    label: Mentoriスキル（リポ内）
    group: generation
    description: ".claude/skills/mentori/。手編集禁止。gen-skillで再生成"
  gh_skill_dist:
    label: gh skill 配布スキル
    group: distribution
    description: "skills/mentori/。gh skill install で外部配布"

process:
  extract_patterns:
    label: 学習パターン抽出
    group: extraction
    description: セッションログと品質レビュー記録から学習傾向・介入パターンを抽出する
  draft_adrs:
    label: ADR 起草
    group: knowledge
    description: 設計上の判断を決定記録として文書化する
  update_guide:
    label: ガイド更新
    group: knowledge
    description: 学習パターンとADRをメンタリングガイドに反映する
  write_samples:
    label: サンプル対話執筆
    group: knowledge
    description: ガイドの記述をサンプル対話として例示する
  gen_skill:
    label: スキル生成
    group: generation
    description: ガイド・サンプル・ADRからスキルファイルを生成する
  review_quality:
    label: 対話品質レビュー
    group: input
    description: 配布スキルを使った対話の品質を定期監査し改善点を記録する
  publish_skill:
    label: スキル配布
    group: distribution
    description: gh skill install で配布できる形式に出力する

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  blocked: { fillcolor: "#f8d7da", style: filled }
---

session_log >> extract_patterns -> learning_patterns

[session_log, review_record] >> draft_adrs -> adrs

[learning_patterns, adrs] >> update_guide -> mentoring_guide

mentoring_guide >> write_samples -> sample_dialogues

[mentoring_guide, sample_dialogues, adrs] >> gen_skill -> mentori_skill

mentori_skill >> publish_skill -> gh_skill_dist

gh_skill_dist >> review_quality -> review_record

review_record >>? extract_patterns

mentori_skill >>? gen_skill
```

---

**設計上の判断メモ（口頭で補足）:**

- `review_quality` の入力を `gh_skill_dist` にした。「配布後のスキルを使った対話を評価する」という順序制約を明示するため。`session_log` を直接 review_quality に入れると、スキル未使用の対話も混入する
- `mentori_skill >>? gen_skill` は「前世代スキルが次世代生成の参照入力になる（ADR-0011 の世代還流パターン）」。循環に見えるが `>>?` で DAG に保つ
- `review_record` は `extract_patterns` への `>>?` と `draft_adrs` への `>>` の両方を持つ。レビュー記録はパターン抽出の**フィードバック**（後から前へ戻す）であり、ADR起草の**一次入力**（新しい判断の根拠）という二役を担うため、向きが異なる

---

### FleetOps
## 設計回答: FleetOps PFD

---

### 1. 必要なPFDファイルの列挙

**2ファイルに分割する。** 理由: この系には時間軸が異なる2つの変換パターンが混在しており、1ファイルにまとめると各パターンの読み手が変わり、ノイズが増える。

| ファイル名 | 目的 |
|---|---|
| `data_pipeline.pfdsl` | GPS生データから月次レポートまでのデータ変換チェーンを表現する |
| `compliance_submission.pfdsl` | 月次レポートの承認・提出・規制当局受理という外部連携フローを表現する |

**3ファイル目を却下した理由:** 「社内オペレーター向けダッシュボード」を別ファイルにする案も検討したが、走行ログや日報は `data_pipeline.pfdsl` の中間成果物であり、オペレーターが消費するだけでプロセスを持たない（V002: 出力のないプロセスを避ける制約から、分割すると宙に浮く）。オペレーターの消費は `data_pipeline.pfdsl` 内に consumer 注釈で表現する。

---

### 2. 各ファイルの特徴

**`data_pipeline.pfdsl`**

- **時間軸:** 収束型。ストリームデータ（高頻度・小粒度）が集約されて低頻度・大粒度の成果物に変換される階段構造
- **主語:** データ（GPS位置データを起点として何が生まれるか）
- **ない場合に見えなくなること:** どの変換ステップで情報が落ちるか（例: 走行ログ生成時に何を集約・捨てるか）が不明になる。機能追加の際にどの中間成果物に手を入れるべきかが分からなくなる。ストリーム受信の障害がどこまで波及するかの依存関係が見えなくなる

**`compliance_submission.pfdsl`**

- **時間軸:** 循環型（月次サイクル）+ ゲート型（承認が通らないと次に進めない）
- **主語:** 月次レポート（成果物を中心に、誰がどう扱うかを記述）
- **ない場合に見えなくなること:** 外部ステークホルダー（規制当局）との境界が `data_pipeline.pfdsl` に埋もれ、「提出したが受理されなかった場合」の差し戻しループが設計上存在しないことになる。義務的な外部提出と社内処理が混同される

---

### 3. 最重要PFD: `data_pipeline.pfdsl` の骨格

`data_pipeline.pfdsl` を最重要とする根拠: 稼働中システムの機能追加で最も変更頻度が高いのはデータ変換チェーンであり、ここが崩れると下流の `compliance_submission.pfdsl` も崩れる。依存の起点になる。

```yaml
---
title: FleetOps Data Pipeline
description: >
  GPS端末からのストリームデータを走行ログ・日報・月次レポートへ変換する
  データパイプラインの全体構造。機能追加時の変更影響範囲を把握するための図。
actors:
  - id: gps_device
    label: GPS端末
  - id: operator
    label: 社内オペレーター
  - id: report_generator
    label: 月次レポート生成システム
statusStyles:
  done:    { border: solid,   color: "#4caf50" }
  wip:     { border: dashed,  color: "#ff9800" }
  todo:    { border: dotted,  color: "#9e9e9e" }
  blocked: { border: double,  color: "#f44336" }
---

// ── GPS受信層 ──────────────────────────────
gps_device -> location_stream
  [label: "位置パケット送信"]

location_stream >> ingest_location_stream -> raw_location_log
  [process_label: "位置データを受信・バッファリングする",
   status: done]

// ── 走行ログ生成層 ──────────────────────────
raw_location_log >> detect_trips -> trip_segment
  [process_label: "連続座標から走行区間を検出する",
   status: done]

[trip_segment, raw_location_log] >> build_trip_log -> trip_log
  [process_label: "走行区間を速度・距離・時刻付きで集計する",
   status: done]

// オペレーターは走行ログをリアルタイム参照する（消費のみ）
trip_log >>? operator
  [label: "ダッシュボード参照"]

// ── 日報生成層 ──────────────────────────────
trip_log >> aggregate_daily -> daily_report
  [process_label: "車両ごとの走行ログを日単位で集約する",
   status: wip]

daily_report >>? operator
  [label: "日報確認・修正"]

// ── 月次レポート生成層 ───────────────────────
[daily_report] >> compile_monthly_report -> monthly_report
  [process_label: "日報30件を月次コンプライアンス形式に変換する",
   status: todo]

// monthly_report はcompliance_submission.pfdslへの入力となる
```

**設計上の判断メモ:**

- `raw_location_log` と `trip_segment` を別成果物にした。「位置の羅列」と「走行区間の識別結果」は別の概念であり、将来的に区間検出アルゴリズムを差し替える際の変更境界になる
- `operator` への2本の `>>?` は消費（プロセスを持たない参照）として表現。V002違反を避けるため `>>?` のフィードバック記法を使い、オペレーターが成果物を生産していないことを明示する
- `monthly_report` はこのファイルで生産し、`compliance_submission.pfdsl` で入力として受け取る。V001（生産者は最大1つ）を守るため、生産はこちらのみ

---

### Zenith
## 1. 必要なPFDファイルの列挙

**3ファイル**に分割する。

| ファイル名 | 目的 |
|---|---|
| `cfp_to_schedule.pfdsl` | CFP受付から登壇者選考・スケジュール確定までの準備フロー |
| `event_operations.pfdsl` | 当日の運営フロー（スタッフ・登壇者・参加者が交差する） |
| `post_event.pfdsl` | イベント後の記録公開・振り返りレポート作成フロー |

**分割理由**: 3つのフェーズで「主要なアクター」と「作られるartifact群」がほぼ入れ替わる。1ファイルにまとめると、CFP選考の細部と当日運営の細部が同じ図に混在し、どちらも読み取りにくくなる。また「当日フロー」だけを取り出してスタッフに共有する実用的な用途がある。

---

## 2. 各PFDファイルの特徴

### `cfp_to_schedule.pfdsl`
- **時間軸**: 収束型。「多数の登壇申請」→「1つの確定スケジュール」へ絞り込む
- **主語**: 運営チーム（選考委員）を中心に、登壇者が入力側に位置する
- **これがない場合に見えなくなること**: どの情報をもとに誰が選考判断を下すか、選考基準が成果物として存在しているかが不透明になる。「なんとなく決めた」状態がモデル上で発生する

### `event_operations.pfdsl`
- **時間軸**: 時系列型（開場→セッション→クロージング）。並列するトラックがあればfork的な構造を持つ
- **主語**: スタッフ（受付・会場・タイムキーパー）が中心。登壇者・参加者は入出力として現れる
- **これがない場合に見えなくなること**: 当日の情報伝達経路（誰が何をinputにして動くか）が見えず、トラブル時の責任境界が曖昧になる

### `post_event.pfdsl`
- **時間軸**: 収束型 + 線形。「録画・スライド・アンケート」という複数rawデータ → 複数の公開成果物へ
- **主語**: 記録担当スタッフ、次回開催検討チーム
- **これがない場合に見えなくなること**: 動画・スライド公開と振り返りレポートの間の依存関係（アンケート結果は両方に使われる）が見えなくなる。また「次回への接続」という成果物が定義されないまま終わる

---

## 3. 最重要PFDの骨格

最重要は `cfp_to_schedule.pfdsl`。理由: ここでの判断の質（選考基準・採否通知）がスピーカーラインナップを決定し、残り2つのPFD全体の品質の前提条件になるため。

```yaml
title: Zenith CFP to Schedule
description: CFP受付から登壇者選考・スケジュール確定までの準備フロー
version: "0.1"
statusStyles:
  done: { color: "#4caf50" }
  wip:  { color: "#ff9800" }
  todo: { color: "#9e9e9e" }
```

```
// --- 入力成果物 ---
cfp_form        [label: "CFP応募フォーム", status: done]
selection_rubric [label: "選考基準ルーブリック", status: todo]
speaker_proposals [label: "登壇申請一覧", status: todo]
venue_capacity  [label: "会場・時間枠制約", status: done]

// --- 中間成果物 ---
scored_proposals [label: "採点済み申請リスト", status: todo]
accepted_list   [label: "採択者リスト", status: todo]
speaker_info    [label: "登壇者確定情報", status: todo]

// --- 最終成果物 ---
session_schedule [label: "確定セッションスケジュール", status: todo]
acceptance_notice [label: "採択通知メール", status: todo]
rejection_notice  [label: "不採択通知メール", status: todo]

// --- フロー ---
cfp_form       >> collect_proposals
collect_proposals -> speaker_proposals

[speaker_proposals, selection_rubric] >> score_proposals
score_proposals -> scored_proposals

[scored_proposals, venue_capacity] >> decide_acceptance
decide_acceptance -> accepted_list

accepted_list  >> notify_speakers
notify_speakers -> acceptance_notice
notify_speakers -> rejection_notice

accepted_list  >> gather_speaker_details
acceptance_notice >>? gather_speaker_details
gather_speaker_details -> speaker_info

[speaker_info, venue_capacity] >> build_schedule
build_schedule -> session_schedule
```

**設計上の判断メモ:**
- `selection_rubric`（選考基準）を明示的なartifactにした。これがないと`score_proposals`プロセスがinputなしになりV002違反になると同時に、「基準が存在しないまま選考が走る」という実務上の問題も可視化できる
- `acceptance_notice >>? gather_speaker_details` をフィードバック入力にした。採択通知に対して登壇者が詳細情報を返すという「往復」を表現するため
- `rejection_notice`は`notify_speakers`の出力にした。`accepted_list`から直接生成されるのではなく、「採択判断プロセスが通知を生む」という変換の意味を保つため


## 審査タスク

以下の観点で齟齬・問題を洗い出してください：

1. **命名の揺れ**: 同じ種別のPFDが別の名前で呼ばれている箇所
2. **分割基準の不整合**: あるプロジェクトでは分けたのに別のプロジェクトでは混ぜている、その根拠が曖昧な箇所
3. **分類しきれないケース**: どの種別にも当てはまらない、または複数の種別が混在しているPFD
4. **欠落**: このプロジェクトにはあるはずのPFDが設計から抜けている疑いがある箇所
5. **PFDSLの制約違反**: V001/V002/V003に違反している疑いがある設計

最後に：
- 4つの設計を通じて**自然に収束した分類軸**があれば抽出する
- **どうしても一つの軸で割り切れなかった概念**があれば指摘する
- 分類理論を洗練させるための**追加の問い**を1〜3個提示する


---

## assistant

審査を始めます。まず各設計の構造を横断的に把握するため、PFDSLの仕様を確認します。

---

## user

Base directory for this skill: /Users/yoshitaka.seki/.claude/skills/pfdsl

## Syntax

- `A >> P` — Artifact A as normal input to Process P
- `A >>? P` — Artifact A as feedback input to Process P (dashed edge, no rank effect)
- `P -> B` — Process P outputs Artifact B
- Chain: `A >> P -> B >> Q -> C`
- **Multiple inputs — always use set notation**: `[a, b] >> P` (preferred over two separate `a >> P` / `b >> P` lines)
- Multiple outputs: `P -> [a, b]`

**ID type inference** (no explicit declaration needed in body):
- Left of `>>` / `>>?` → Artifact; right → Process
- Left of `->` → Process; right → Artifact
- Frontmatter `artifact:` / `process:` declarations override

**Continuation**: operator at *start* of next line continues the statement. Blank line terminates.

## Frontmatter structure

```yaml
title: ...
layout:
  direction: LR   # LR | RL | TB | BT (default LR)
  maxWidth: 120   # label wrap width in px (optional)

artifact:
  <id>:
    label: 人間向けラベル
    status: done       # todo=未着手 | wip=PR open | done=main済み | blocked=外部要因
    description: ...
    owner: ...
    tags: [tag1, tag2]
    group: <group-id>
    parts: [sub-artifact-id, ...]

process:
  <id>:
    label: ...
    description: ...
    owner: ...
    group: <group-id>

group:
  <id>:
    label: ...
    color: "#f0f0f0"

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  blocked: { fillcolor: "#f8d7da", style: filled }
```

## CLI

```bash
npx @pfdsl/cli check <file>
npx @pfdsl/cli fmt <file> [--write] [--mode flat|flows]
npx @pfdsl/cli normalize <file>
npx @pfdsl/cli graph <file> [--format dot|svg]
npx @pfdsl/cli diff <file-a> <file-b>
```

## Key constraints

- **V001 single-producer**: each artifact has at most one producing process (`->`)
- **V002 process needs inputs**: every non-isolated process needs ≥1 input (`>>`)
- **V003 process needs outputs**: every non-isolated process needs ≥1 output (`->`)

## Writing quality PFDs

PFD はタスクリストではなく成果物の変換グラフ。

- **最終成果物から遡って書く**: 前から並べる(push)と無意味な成果物・孤立プロセスが混入する
- **プロセス分割は依存で決める**: 時間的凝集で束ねない（束ねた全入力が全出力をゲートする偽依存）。「会場・スポンサー手配」「双方レビュー」等の並記名は束ねのサイン。分けても境界をまたぐ新依存が出ないなら割らない
- **相互依存は分割しない**: 決定が往復で形成される作業は1プロセス複数出力に。共有方針は出力の決定記録として外化する。下流作業なしで合否判定できる方針だけが上流 artifact になれる
- **所有権境界は正当な分割根拠**: 担当が替わる引き継ぎ点では artifact が契約になる — 依存上は不要でも分割してよい。単一所有者の内部では依存基準だけで決める
- **命名**: プロセスは変換が見える動詞句（「設計」「査読」。「対応」「作業」不可）、成果物は保管できるモノの名詞（「応急処置」は作業名 — 「暫定対応記録」に）。ID は短い英語スネーク、表示名は label
- **抽象度を統一**: 「システム開発」と「変数リネーム」を並べない。肥大したら別ファイルへ
- **グループは存在様式で切る**: 住処・寿命・消費局面の軸で分け、生成元では分けない — 生成関係はエッジが表現済み（ADR-0008）
- **出力は検証可能な「モノ」**: 「理解」「合意」は理解資料・議事録・承認記録に外化。副次物（リリースノート）だけでなく主産物も出力する
- **入力は全て明示**: 暗黙依存禁止（例: 差分実装に base_code）。「レビュアー知識」等の不定形もフロー外リソースなら入力可。フロー内で生成するなら文書化
- **可変リソースはスナップショット化**: DB・本番環境は「日次ダンプ」「リリース版」等の時点固定 artifact に（単一生成元・DAG と衝突するため）
- **改版は1パターン**: フェーズ境界（承認・配布されるベースライン）なら別 artifact、同一フェーズ内の収束や定常運用サイクル（再学習等、版を列挙できない繰り返し）なら `>>?`。併用は二重表現
- **Primary graph は DAG に**: 循環は `>>` で書かず `>>?` か改版 artifact で（`check` は循環を検出しない）
- **`>>?` は後ろ向きに**: 下流の成果物を上流プロセスへ戻す（`修正稿 >>? 交渉`）。既に `>>` で繋いだ対に重ねるのは冗長
- **能力成果物は世代還流**: フロー内で生産される skill・ツール等が自分の生産チェーン上流のプロセスに入るときは、位相に関係なく前世代スナップショットとして `>>?`（ADR-0011）
- **生成者の整合**: プロセスは自分が作るものだけ出力（面接が応募者の提出物を生成しない）。description と graph も一致させる
- **ドリフト耐性**: description に本数・他所のリストの複製を書かない。一次情報への参照にする — 数と列挙は同期漏れで腐る
- **parts メンバーもエッジ参加**: `[ch1, ch2] >> merge -> book`（spec §17.4）。エッジ無しは図上で孤立ノード化
- **組織学習パターン**: 観点表をレビュー入力に、指摘から `>>?` で観点表整備へ還流（samples 11-practical-web-dev）
- **点検**: `check` と `graph --format dot` を実行。終端成果物が全て意図した納品物か、各プロセスが「この入力だけで出力を作れるか」を確認

## Typical task: update artifact status

1. Find the artifact ID in the target `.pfdsl` file's frontmatter `artifact:` section
2. Change `status: todo` → `status: done` (or `wip`, `blocked`)
3. Validate: `npx @pfdsl/cli check <file>`

## References

Read these when deeper detail is needed:

- `references/spec.md` — full PFDSL spec v0.0.7 (syntax rules, grammar, all frontmatter fields)
- `references/samples.md` — annotated .pfdsl examples showing each language feature
- `references/examples.md` — realistic domain examples demonstrating the quality guide
- `references/review-prompts.md` — A/B 監査カタログ（レビュー時に PFD を問い詰めるプロンプト）


---

## assistant

仕様を確認したうえで、4設計の横断審査を行います。

---

# 横断審査レポート

## 1. 命名の揺れ

### 時間軸の分類語が統一されていない

4設計でいずれも「時間軸」を分類根拠に使っているが、同じパターンに異なる語が当てられている。

| 設計 | 使用語 | 指している実態 |
|---|---|---|
| Noodle `recipe_lifecycle` | 収束型 | 単一起点→複数終端 |
| Noodle `api_contract` | 収束型 | 差し戻しループあり、最終的に合意へ |
| Mentori `ecosystem` | なし（構造型と呼称） | 時間軸なし・静的マップ |
| Mentori `improvement_cycle` | 循環型 | ループ、`>>?`で表現 |
| FleetOps `data_pipeline` | 収束型 | 階段状変換チェーン |
| FleetOps `compliance_submission` | 循環型+ゲート型 | 月次ループ+承認ゲート |
| Zenith `cfp_to_schedule` | 収束型 | 多→一への絞り込み |
| Zenith `post_event` | 収束型+線形 | 複数rawデータ→複数成果物 |

「収束型」が指している実態が少なくとも3種類ある。

- Noodle: 単一起点・複数並列終端（扇形に広がる）
- FleetOps: 多段変換の階段（線形に近い）
- Zenith: 多起点→単一終端（真の収束）

Noodleの「収束型」とZenithの「収束型」は図の形が逆向きになる。同一語が使えない。

「構造型」（Mentori ecosystem）は他設計に出てこない独自語であり、定義不在のまま使われている。

### ファイル名の命名規則が統一されていない

- ドメイン概念名：`recipe_lifecycle`、`improvement_cycle`、`data_pipeline`
- フェーズ名：`cfp_to_schedule`、`post_event`
- 役割名：`api_contract`、`compliance_submission`、`event_operations`

命名の軸が混在しており、種別の区別を名前から読み取れない。

---

## 2. 分割基準の不整合

### 「合意プロセス」の扱いが設計間で割れている

Noodleは`api_contract`を独立ファイルとした。根拠は「主語がチームに変わる」。

しかしZenithの`cfp_to_schedule`内では`score_proposals`→`decide_acceptance`→`notify_speakers`という複数主体にまたがる合意プロセスが同一ファイルに混在している。「CFPフォーム」という入力成果物の主語はイベント参加者（応募者）であり、「選考基準ルーブリック」は運営チームが主語、採択通知は登壇者が受け取る。Noodleの基準を適用すれば「主語が変わる境界で分割すべき」となり、Zenith設計との矛盾が生じる。

Zenith設計者はこの点を意識しておらず、分割基準が「主語」ではなく「フェーズ（時間的区切り）」に切り替わっている。両者で分割基準が違う軸を使っている。

### FleetOpsの「3ファイル目を却下」の論拠が弱い

FleetOpsは「オペレーターへの参照をV002/V002違反にならないよう`>>?`で表現」として分割を回避したと説明している。しかしこの論拠は誤っている。`>>?`はフィードバック（下流から上流への逆向き）の記法であり、オペレーターがダッシュボードをリアルタイム参照するという「消費のみ」の関係を`>>?`で表現することは意味論的に不正確である。「ダッシュボードを参照して業務判断を行い、その結果がどこかに出力される」なら独立ファイルの根拠になり得る。その判断をせずに却下している。

### Mentoriの「ecosystem vs roadmap」の分割は他設計と基準が異なる

Mentoriだけが「寿命が違う（roadmapは完成したら参照が減る）」を分割根拠にしている。他3設計はこの軸を一度も使っていない。寿命という軸が正当な分割基準かどうかは、このレポートで後述する。

---

## 3. 分類しきれないケース

### FleetOps `compliance_submission`：「循環型+ゲート型」の複合

FleetOpsは`compliance_submission`を「循環型（月次サイクル）+ ゲート型（承認ゲート）」と説明している。これは単一の分類軸に収まらない。

月次ループは「時間的繰り返し構造」だが、承認ゲートは「条件分岐と差し戻し」であり、別の次元の概念である。PFDSLでは`>>?`で差し戻しを表現するが、「月次サイクルの中に承認ゲートがある」という入れ子構造は、どちらの時間軸分類でも説明しきれない。

このファイルはさらに「外部ステークホルダー（規制当局）との境界」という所有権境界を含んでいる。時間軸・条件分岐・所有権境界の3概念が交差しており、1つの分類軸で語れない。

### Zenith `event_operations`：時系列型の孤立

Zenith設計の「時系列型（開場→セッション→クロージング）」という分類語は他設計に出てこない。これは「収束型」「循環型」とは異なる第3カテゴリだが、Zenithのみが使用しており定義されていない。

スポーツイベント・公演・授業など時刻が実世界で固定されているプロセスは、成果物の変換グラフとして書くと「並列トラック」や「同期ポイント」が現れる構造になる。これがデータ変換チェーンと本質的に違う概念かどうかが未検討のまま放置されている。

### Mentori `ecosystem`：「構造型」は種別か用途か

Mentoriが「構造型・時間軸なし」と呼んだものは、PFDSLの文脈では成果物の静的依存マップである。これはデータの変換連鎖を記述する通常のPFDとは性格が異なる。しかしPFDSLという記法で書かれている以上、`>>`は「生成する」という変換を意味し、何らかの時間的順序を含意する。「時間軸なし」と言いながら`>>`エッジを書くことが自己矛盾を含む可能性がある。

---

## 4. 欠落の疑い

### Noodleにデプロイ・インフラ成果物が存在しない

Noodleは「iOSアプリ+バックエンド」の構成でElasticsearch、PostgreSQLが登場する。`recipe_lifecycle`はデータの変換を記述しているが、その変換を動かすインフラ（デプロイ済みバックエンド、Elasticsearch構成）が成果物として存在しない。`persistToDatabase`プロセスは何を入力として動くのかが不明であり、`StoredRecipe`の生産者としてPostgreSQLの「稼働状態」が暗黙依存になっている。PFDSLの「入力は全て明示」原則に反する疑いがある。

### FleetOpsにGPS端末の設定・設置プロセスが存在しない

`data_pipeline.pfdsl`の骨格では`gps_device -> location_stream`として、GPS端末を既存の入力源として扱っている。しかしGPS端末を車両に搭載し、送信設定を行うプロセス（あるいはその成果物としての「搭載済みデバイス台帳」）が設計上存在しない。「稼働中システムの機能追加」という前提があるため意図的かもしれないが、`gps_device`という`actor`がどこから来るかが不透明である。

### Zenithにキャンセル・中止フローが存在しない

イベント系のPFDとして、`cfp_to_schedule`の差し戻しループ（`acceptance_notice >>? gather_speaker_details`）は登壇者からの詳細情報返送として設計されているが、「登壇者が辞退した場合にスケジュールを再構築する」フローが存在しない。`session_schedule`の生産者は`build_schedule`のみ（V001準拠）だが、辞退後の再スケジュールは`build_schedule`が再度実行される必要があり、その入力となる「最新の確定情報」の生産元が設計上ない。

---

## 5. PFDSL制約違反の疑い

### V002疑い: Noodle `api_contract`の設計

Noodleは`api_contract.pfdsl`を「iOSチームとバックエンドチームの合意プロセス」と説明しているが、骨格を示していない。説明文によれば「差し戻しループ（iOSからの修正要求）が存在する」とある。差し戻しループを`>>?`で表現する場合、その`>>?`の起点となる成果物（修正要求書、またはAPIスキーマ修正版）が明示されていなければ、差し戻し受け取り先のプロセスがV002（入力なしプロセス）に近い状態になる可能性がある。骨格が示されていないため確認不能だが、設計上のリスクとして挙げる。

### V003疑い: FleetOps `compliance_submission`の差し戻しループ

FleetOpsは「提出したが受理されなかった場合の差し戻しループが設計上存在しないことになる」と他の設計の問題として指摘している。しかし`compliance_submission.pfdsl`自体の骨格も示されていないため、その差し戻しループが実際に設計されているかどうか確認できない。設計意図と実装骨格の間にギャップがある。

### V001疑い: Zenith `acceptance_notice`の生産元

Zenithの骨格では`notify_speakers -> acceptance_notice`と`notify_speakers -> rejection_notice`が明示されている。V001は満たしている。しかし`acceptance_notice >>? gather_speaker_details`の意味が問題である。`acceptance_notice`は運営チームが登壇者に送る通知であり、登壇者が詳細情報を返送するトリガーになるが、「登壇者が送り返してくる詳細情報」という新たな成果物は`gather_speaker_details`の出力として`speaker_info`に入るべきである。`acceptance_notice`自体がフィードバックエッジの起点になることは意味論的に不正確である（通知文書が返送されるわけではない）。「登壇者からの回答」という中間成果物が欠落しており、`acceptance_notice`の意味論的役割が曖昧になっている。

### V002疑い: FleetOps `data_pipeline`の`operator`消費

FleetOpsの骨格では`trip_log >>? operator`と`daily_report >>? operator`が書かれている。`operator`はactorとして定義されており、プロセスではない。PFDSLでは`>>`と`->` は原則として成果物とプロセスの関係を記述する。`>>?`でactorに向かうエッジが文法的に許容されるかどうか仕様を確認する必要があるが、仮に許容されないとすれば、この記述は無効である。許容される場合も、「オペレーターが参照するだけ」という行為がフィードバック（`>>?`の意味論）にあたるかは疑わしい。

---

## 自然に収束した分類軸

4設計を横断すると、3つの独立した分類軸が浮かび上がる。

### 軸A: 時間的構造

| カテゴリ | 実態 | 該当例 |
|---|---|---|
| 収束（多→一） | 多起点が1つの成果物に絞り込まれる | Zenith `cfp_to_schedule` |
| 発散（一→多） | 単一起点から複数終端に変換が広がる | Noodle `recipe_lifecycle` |
| 線形変換チェーン | 直列の多段変換 | FleetOps `data_pipeline` |
| 定常ループ | 終端が起点に戻る繰り返し | Mentori `improvement_cycle`、FleetOps `compliance_submission` |
| 静的マップ | 時間的変換なし、依存の地図 | Mentori `ecosystem` |

※「収束型」という語は上記のうち少なくとも3カテゴリに誤用されていた。

### 軸B: 主語（変換の主体）

| カテゴリ | 実態 | 該当例 |
|---|---|---|
| データ変換型 | 成果物（データ）が主語、人は黒子 | Noodle `recipe_lifecycle`、FleetOps `data_pipeline` |
| 人間活動型 | チーム・役割が主語、成果物は合意や判断の外化 | Noodle `api_contract`、Zenith `cfp_to_schedule` |
| 知識蓄積型 | スキル・ガイドなど能力成果物の世代的蓄積 | Mentori `improvement_cycle`、`roadmap` |

### 軸C: 寿命

| カテゴリ | 実態 | 該当例 |
|---|---|---|
| 実装フェーズ限定 | 完成したら参照が減る | Mentori `roadmap`、各プロジェクトの`sprint_delivery` |
| 定常運用 | 完成という概念がなく永続 | Mentori `improvement_cycle`、FleetOps `compliance_submission` |
| イベント固有 | 1回のイベントで完結し廃棄される | Zenith全3ファイル |

---

## どうしても1つの軸で割り切れなかった概念

### 「合意」の位置づけ

合意（契約・承認・採択）は成果物として外化されうるが、その生成プロセスは人間活動型の往復であり、時間的構造としては「収束（差し戻しループ付き）」になる。Noodleは合意を独立ファイルにし、Zenithは合意を収束フローの内部に埋め込んだ。どちらが正しいかは「合意の往復が何回起きるか」「主語の切り替わりが明示的な引き継ぎ点を必要とするか」という文脈依存の判断であり、普遍的なルールに帰着しない。

### 「外部境界（external boundary）」の扱い

FleetOpsの規制当局、Zenithの登壇者、NoodleのiOSチームはいずれも「外部」だが、その外部性の種類が違う。規制当局は制御不能な外部権威、登壇者は参加者として部分的に内部化できる存在、iOSチームは別チームだが同一組織内である。PFDSLの`actor`概念はこの区別を持っていないため、外部境界の種類が分類軸に浮かび上がることなく埋没している。

---

## 分類理論を洗練させるための追加の問い

**問い1: 「静的マップ」はPFDで書くべきか**
Mentoriの`ecosystem`は「時間軸なし」と明言されているが、PFDSLのエッジ`>>`は変換を意味する。成果物の依存関係マップをPFDSLで書くことは記法の意味論と衝突しないか。もし衝突するなら、ecosystemに適切な記法は別にあり、PFDSLは「変換がある場合のみ」使うべき記法として定義されるべきではないか。

**問い2: 分割の粒度はファイルで管理すべきか、groupで管理すべきか**
4設計はいずれもファイル分割を分類の道具として使っているが、PFDSLには`group`という内部分割機能がある。Zenithの3ファイルをgroupで1ファイルに収めることは技術的に可能である。「ファイル分割 vs group分割」の判断基準（読み手が異なる場合はファイル、同じ読み手なら group、など）が4設計を通じて一切議論されていない。この判断基準を明文化しないと、分割の粒度が設計者の感覚に依存し続ける。

**問い3: 定常ループと実装ロードマップは同一記法で書けるか**
Mentori `improvement_cycle`（定常ループ）とMentori `roadmap`（実装フェーズ限定）はいずれもPFDSLで書かれているが、roadmapは成果物のstatusが`done`に収束して完了する一方、improvement_cycleはstatusが`done`になる概念自体がない。statusフィールドの意味論が2つのPFDで異なる。「statusが意味を持つPFD」と「statusが意味を持たないPFD」という区別を明示しないと、statusStylesの色分けが一方には機能し、他方には機能しないという非対称が生じる。