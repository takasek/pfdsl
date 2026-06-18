# Agent: polaris

## user

あなたはPFD（Process Flow Diagram）の設計者です。
以下のプロジェクトに対して、どのようなPFDファイルを作成すべきかを設計してください。

## プロジェクト: Polaris（社内プラットフォームSDK提供）

社内プラットフォームチームが複数プロダクトチームに SDK・ドキュメント・ランブックを提供するプロジェクト。
- SDKは TypeScript / Python / Go の3言語
- ドキュメントは API リファレンス・チュートリアル・移行ガイドの3種
- ランブックは障害対応・デプロイ・ロールバックの手順書
- 消費チーム: Aチーム（決済）、Bチーム（在庫）、Cチーム（配送）が独立して SDK を使う
- 各言語 SDK・各ドキュメント・各ランブックが「誰に読まれているか」を管理したい（使われていない成果物の検出）
- SDK のリリースサイクルは月次、ドキュメントは随時更新

## PFDファイルの種別（3種のみ）

種別は「このPFDが答える問い」で区別する。

| 種別 | 答える問い |
|---|---|
| **roadmap** | 何を何の前に作る必要があるか。今着手できる作業はどれか |
| **workflow** | この作業はどう繰り返されるか。誰が何をトリガーに何を行うか |
| **runtime-pipeline** | システムが動くとき、データは何に変換されるか。変換の境界はどこか |

**注意:** 「ecosystem」種別は存在しない。かつて ecosystem 種別が担っていた用途（成果物が誰に使われるかの消費者マップ）は、上の3種のいずれかで表現しなければならない。

**1種別1ファイルを原則とする。** 同一種別内の細分はgroupで行う。

workflow か runtime-pipeline か迷ったら: 人・チームの判断やトリガーが主役 → workflow / データの変換経路が主役 → runtime-pipeline。

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

1. このプロジェクトに必要なPFDファイルを列挙してください（ファイル名・種別・一言の目的）
   - 種別は roadmap / workflow / runtime-pipeline の3種から選ぶ
   - かつて ecosystem 種別が担っていた「成果物の消費者マップ」が必要と感じた場合、どの種別でどう表現したか説明する

2. 各PFDファイルについて特徴を説明してください
   - 種別の選定理由
   - 主語（何を/誰を中心に記述しているか）
   - このPFDが「ない場合に見えなくなること」

3. 最も重要な1つのPFDについて、実際のPFDSL形式で骨格を書いてください
   （frontmatter + 主要な5〜10エッジ程度、kindフィールドを含む）

4. 「ecosystem種別がないことで表現しにくかったこと」があれば正直に述べてください。なければ「なし」と書いてください。

## 制約
- 3種の定義に従うこと
- PFDSL構文の制約（V001/V002/V003）を守る

---

## assistant

## 1. 必要なPFDファイルの列挙

| ファイル名 | 種別 | 目的 |
|---|---|---|
| `polaris/roadmap.pfdsl` | roadmap | SDK各言語・各ドキュメント種・各ランブックの依存順序と着手可能作業の管理 |
| `polaris/release-workflow.pfdsl` | workflow | 月次SDKリリースサイクルで誰が何をトリガーに何を行うかの定義 |
| `polaris/doc-update-workflow.pfdsl` | workflow | ドキュメント随時更新のトリガー・レビュー・公開フローの定義 |
| `polaris/sdk-build-pipeline.pfdsl` | runtime-pipeline | SDKソースコードが各言語のリリースパッケージに変換される経路 |
| `polaris/consumption-workflow.pfdsl` | workflow | 各消費チーム（A/B/C）がSDK・ドキュメント・ランブックを使う局面と、使用実績フィードバックの経路 |

**ecosystem種別が担っていた「消費者マップ」の扱い:**
「各成果物が誰に読まれているか」は、消費チームを主語にした workflow で表現しました（`consumption-workflow.pfdsl`）。消費チームがSDK・ドキュメント・ランブックを取得・参照・フィードバックするプロセスを書くことで、「未読成果物の検出」はフィードバックエッジが欠けているartifactとして可視化されます。workflow の終端成果物として「利用実績レポート」を置くことで、使われていない成果物を監査できます。

---

## 2. 各PFDファイルの特徴

### `polaris/roadmap.pfdsl` — roadmap

**種別選定理由:** 問いが「何を何の前に作る必要があるか」。TypeScript SDK が先か Python SDK が先か、APIリファレンスはSDK実装後か並行可能か、といった依存順序を問うため roadmap 一択。

**主語:** 成果物同士の依存関係。誰が作るかより「何があれば何が作れるか」が中心。

**このPFDがない場合に見えなくなること:** 3言語×3ドキュメント×3ランブックの計9成果物がフラットに並び、着手可能な作業と依存待ち作業の区別がつかない。また、「共通インターフェース仕様書がないと3言語SDK全部がブロックされる」という単一障害点が見えなくなる。

---

### `polaris/release-workflow.pfdsl` — workflow

**種別選定理由:** 「月次リリースのとき、誰が何をトリガーに何を行うか」が問い。プラットフォームチームのエンジニアの判断・承認・通知行為が主役で、データ変換の経路ではない。

**主語:** プラットフォームチームのリリースエンジニア。月次タイミングをトリガーに行動する人。

**このPFDがない場合に見えなくなること:** リリース判断の承認者・通知先・Go/No-go基準が暗黙になる。新しいチームメンバーが「リリース前にどのチームに何を連絡するか」を知る術がない。

---

### `polaris/doc-update-workflow.pfdsl` — workflow

**種別選定理由:** 「APIが変わったとき、誰がドキュメントを更新し、誰がレビューし、どう公開されるか」が問い。人の判断（レビュー承認）とトリガー（APIリリース、バグ報告）が主役。

**主語:** ドキュメント作成者と消費チームのフィードバック。

**このPFDがない場合に見えなくなること:** SDKリリースとドキュメント更新のタイミングずれ（SDK v2.0出荷後もドキュメントがv1.x向けのまま、という状況）が構造的に可視化されない。また移行ガイドの起草責任者が不明確になる。

---

### `polaris/sdk-build-pipeline.pfdsl` — runtime-pipeline

**種別選定理由:** 「ソースコードがどのような変換を経てリリースパッケージになるか」が問い。OpenAPI仕様→コード生成→テスト→パッケージングという変換の境界が主役。人の判断ではなくデータの変換経路。

**主語:** SDKのデータ（ソース・中間生成物・パッケージ）。

**このPFDがない場合に見えなくなること:** 3言語で共通の変換フェーズ（コード生成）と言語固有のフェーズ（パッケージング形式）の境界が不明確になる。「コード生成ツールのバグが全言語に影響する」という依存が見えなくなる。

---

### `polaris/consumption-workflow.pfdsl` — workflow

**種別選定理由:** 「A/B/Cチームが実際にSDKを使うとき何が起きるか、フィードバックはどう返ってくるか」が問い。各チームのエンジニアが判断しながら成果物を使う行為が主役。消費者マップを workflow で表現する最適な候補。

**主語:** 消費チーム（A=決済、B=在庫、C=配送）の開発者。

**このPFDがない場合に見えなくなること:** 「どのチームがどの成果物を実際に使っているか」が不明になり、ランブックや古いチュートリアルが誰にも読まれていないことを検出できない。フィードバックループが断絶し、プラットフォームチームが一方的に成果物を出荷するだけになる。

---

## 3. 最重要PFDのPFDSL骨格

最重要は `polaris/consumption-workflow.pfdsl` です。「誰に読まれているか管理したい（使われていない成果物の検出）」というプロジェクトの中核要件に直接答えるファイルであり、ecosystem種別なしでこの問いに答えるための設計上の核心でもあるためです。

```yaml
---
title: Polaris SDK 消費ワークフロー
description: >
  消費チーム（A/B/C）がSDK・ドキュメント・ランブックを使う局面と、
  利用実績フィードバックがプラットフォームチームに戻る経路。
  フィードバックエッジが繋がっていない成果物が「使われていない成果物」の候補。
kind: workflow
layout:
  direction: LR
  maxWidth: 130

group:
  platform:
    label: プラットフォームチーム
    color: "#e8f4fd"
  team_a:
    label: Aチーム（決済）
    color: "#fef9e7"
  team_b:
    label: Bチーム（在庫）
    color: "#fdf2f8"
  team_c:
    label: Cチーム（配送）
    color: "#eafaf1"
  feedback:
    label: フィードバック
    color: "#fde8e8"

artifact:
  sdk_ts_release:
    label: TypeScript SDK リリース
    group: platform
    description: "npm パッケージ。月次リリース。消費チームが依存を更新することで採用"
  sdk_py_release:
    label: Python SDK リリース
    group: platform
  sdk_go_release:
    label: Go SDK リリース
    group: platform
  api_reference:
    label: API リファレンス
    group: platform
    description: "全エンドポイント・型定義の一次情報"
  tutorial:
    label: チュートリアル
    group: platform
  migration_guide:
    label: 移行ガイド
    group: platform
    description: "メジャーバージョン移行時の手順。主にバージョンアップ作業でのみ参照"
  runbook_incident:
    label: 障害対応ランブック
    group: platform
  runbook_deploy:
    label: デプロイランブック
    group: platform
  runbook_rollback:
    label: ロールバックランブック
    group: platform
  team_a_service:
    label: Aチーム サービス実装
    group: team_a
    description: "決済サービス。SDK採用後の本番実装"
  team_b_service:
    label: Bチーム サービス実装
    group: team_b
  team_c_service:
    label: Cチーム サービス実装
    group: team_c
  usage_report:
    label: 利用実績レポート
    group: feedback
    description: >
      どの成果物がどのチームに使われたかの集計。
      このレポートに登場しない成果物が「使われていない成果物」の候補。
      月次レビューでプラットフォームチームが廃止・統合を判断する。
  feedback_issues:
    label: フィードバック起票
    group: feedback
    description: "バグ報告・改善要望・ドキュメント誤記。消費チームからのプッシュ"

process:
  adopt_sdk_a:
    label: SDK 採用・バージョンアップ（Aチーム）
    description: >
      Aチームが新バージョンのSDKを依存に追加し、移行ガイドを参照しながら
      コードを更新する。採用完了後に利用実績をフィードバック
    group: team_a
  adopt_sdk_b:
    label: SDK 採用・バージョンアップ（Bチーム）
    group: team_b
  adopt_sdk_c:
    label: SDK 採用・バージョンアップ（Cチーム）
    group: team_c
  operate_incident_a:
    label: 障害対応（Aチーム）
    description: "障害発生時にランブックを参照し対応する。参照実績が利用実績に計上される"
    group: team_a
  aggregate_usage:
    label: 利用実績集計
    description: >
      各チームの採用記録・参照ログを集計し、成果物ごとの利用状況をレポート化する。
      月次リリースサイクルに合わせて実施
    group: platform

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  blocked: { fillcolor: "#f8d7da", style: filled }
---

# Aチーム（決済）の採用フロー
[sdk_ts_release, migration_guide, tutorial, api_reference] >> adopt_sdk_a -> team_a_service

team_a_service >>? adopt_sdk_a

# Bチームは Python SDK を使用
[sdk_py_release, migration_guide, tutorial, api_reference] >> adopt_sdk_b -> team_b_service

# Cチームは Go SDK を使用
[sdk_go_release, migration_guide, tutorial, api_reference] >> adopt_sdk_c -> team_c_service

# 障害時のランブック参照（Aチーム代表例）
[runbook_incident, runbook_rollback] >> operate_incident_a -> feedback_issues

feedback_issues >>? adopt_sdk_a

# 利用実績の集計（フィードバックループの閉じ）
[team_a_service, team_b_service, team_c_service] >> aggregate_usage -> usage_report

usage_report >>? aggregate_usage
```

---

## 4. ecosystem種別がないことで表現しにくかったこと

1点だけ正直に述べます。

**「runbook_deploy と runbook_rollback が誰にも参照されていない」を静的に表現しにくい。**

今回の設計では `operate_incident_a` を代表例として書きましたが、デプロイランブックとロールバックランブックを実際に参照するプロセス（Bチーム・Cチームの障害対応、全チームのデプロイ作業）を全部書くと、`adopt_sdk_b`・`adopt_sdk_c` 相当のプロセスがチーム×オペレーション種別の組み合わせ分だけ増殖します（3チーム×3ランブック種＝最大9プロセス）。

ecosystem種別（成果物を中心に「誰が使うか」を放射状に書く形式）であれば、`runbook_deploy` から `team_a`・`team_b`・`team_c` への消費エッジを1成果物あたり数行で書けました。workflow では「消費する側のプロセス」として書かなければならないため、類似プロセスの量産か、チームをまとめたグルーピングの抽象化（精度の低下）のトレードオフが生じました。

最終的には「Bチーム・Cチームの障害対応プロセスも追加し、runbook_deployはデプロイ採用プロセスの入力にする」という方針で解決できますが、記述量は確実に増えます。これが唯一、ecosystem種別の「成果物中心の放射状表現」が恋しかった点です。
