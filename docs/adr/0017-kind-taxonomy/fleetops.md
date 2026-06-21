# Agent: fleetops

## user


あなたはPFD（Process Flow Diagram）の設計者です。
以下のプロジェクトに対して、どのようなPFDファイルを作成すべきかを設計してください。

## プロジェクト: Zenith

技術カンファレンスの企画・運営プロジェクト（1回限り、イベント当日で完結）。
- CFP（登壇募集）→ 選考 → スケジュール確定 → 当日運営 → 記録公開という段階がある
- スポンサー、登壇者、参加者、スタッフという複数ステークホルダー
- イベント終了後にセッション動画・スライドを公開
- 次回開催のための振り返りレポートを作成する



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