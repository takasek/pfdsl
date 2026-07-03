# Agent: zenith

## user


あなたはPFD（Process Flow Diagram）の設計者です。
以下のプロジェクトに対して、どのようなPFDファイルを作成すべきかを設計してください。

## プロジェクト: FleetOps

物流会社向け車両管理システム。
- GPS端末からリアルタイムの位置データをストリーム受信
- 位置データ → 走行ログ → 日報 → 月次コンプライアンスレポートという変換チェーン
- 月次レポートは規制当局に提出が義務（外部ステークホルダー）
- 社内オペレーターチームと外部の規制当局という2種類の消費者
- システムは稼働中で、機能追加を継続中



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
  done:      { border: solid,   color: "#4caf50" }
  wip:       { border: dashed,  color: "#ff9800" }
  todo:      { border: dotted,  color: "#9e9e9e" }
  waiting:   { border: double,  color: "#f44336" }
  suspended: { border: dotted,  color: "#9e9e9e" }
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