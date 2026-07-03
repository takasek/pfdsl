# Agent: mentori

## user


あなたはPFD（Process Flow Diagram）の設計者です。
以下のプロジェクトに対して、どのようなPFDファイルを作成すべきかを設計してください。

## プロジェクト: Mentori

AIメンタリングスキル（Claude Code スキル）の開発プロジェクト。
- ユーザーとの対話セッションから学習パターンを抽出し、スキル自体を改善していく
- スキルの品質ガイド文書、サンプル対話集、ADR（設計決定記録）を管理
- 改善サイクル: 対話 → 知見抽出 → ガイド更新 → スキル再生成
- スキルは gh skill install で配布
- 対話品質のレビューも定期的に実施



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

まず現在のリポジトリ構造とpfdslの文法規則を確認してから設計します。

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
    status: done       # todo=未着手 | wip=PR open | done=main済み | waiting=外部要因待ち | suspended=自主保留
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
  waiting:   { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }
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
2. Change `status: todo` → `status: done` (or `wip`, `waiting`, `suspended`)
3. Validate: `npx @pfdsl/cli check <file>`

## References

Read these when deeper detail is needed:

- `references/spec.md` — full PFDSL spec v0.0.7 (syntax rules, grammar, all frontmatter fields)
- `references/samples.md` — annotated .pfdsl examples showing each language feature
- `references/examples.md` — realistic domain examples demonstrating the quality guide
- `references/review-prompts.md` — A/B 監査カタログ（レビュー時に PFD を問い詰めるプロンプト）


---

## assistant

既存のリポジトリ構造も確認してから設計を行います。

---

## assistant

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
  waiting:   { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }
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