---
# DO NOT EDIT — generated from scripts/skill-template/SKILL.md. Re-run: make gen-skill
name: pfdsl
description: |
  Use when working with .pfdsl (Process Flow DSL) files — reading, writing,
  editing, or validating them. Always invoke before touching any .pfdsl file,
  running pfdsl CLI tools, updating artifact status (done/wip/todo/waiting/suspended),
  adding artifacts or processes, or interpreting flow diagrams.
---

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
    description: ...
    status: done           # todo=未着手 | wip=PR open | done=main済み | waiting=外部要因待ち | suspended=自主保留
    criteria: ...           # 完了条件（todo/wip でも前宣言として書く）
    location: path/to/file  # 実体ファイル・URL へのポインタ。可視化でリンクになる。相対パスは「この .pfdsl ファイルからの相対」で書く
    owner: ...
    group: <group-id>
    tags: [tag1, tag2]
    parts: [sub-artifact-id, ...]
    revises: <artifact-id>  # 同ファイル内の改版元 artifact ID

process:
  <id>:
    label: ...
    description: ...
    owner: ...
    group: <group-id>
    tags: [tag1, tag2]      # Artifact / Process 両方に指定可（group と対称）
    command: npm run build  # 対応する実行コマンド
    estimate: 2d            # 工数見積もり（形式自由）

group:
  <id>:
    label: ...
    color: "#f0f0f0"

tag:                         # タグ定義（artifact/process/group と同階層）
  <tag-id>:
    label: ...
    description: ...
    style: { color: blue, penwidth: "2" }  # 許可属性は statusStyles と同じ

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  waiting:   { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }
```

## CLI

```bash
npx @pfdsl/cli check <file> [--audit] [--summary] [--strict] [--json]
npx @pfdsl/cli fmt <file> [--write] [--mode flat|flows]
npx @pfdsl/cli reindex <file> [--write] [--check] [--renumber] [--json]
npx @pfdsl/cli sort-meta <file> --by <keys> [--write] [--check]
npx @pfdsl/cli normalize <file>
npx @pfdsl/cli graph <file> [--format dot|svg|pdf|png]
npx @pfdsl/cli diff <file-a> <file-b> [--format text|dot|svg]
npx @pfdsl/cli ready <file> [--best] [--json]      # roadmap: list ready-to-start processes
npx @pfdsl/cli status-set <file> <artifact-id> <status>
npx @pfdsl/cli audit-sync <roadmap> <flow>... [--json]
npx @pfdsl/cli skill sync [--yes]
```

Full flag reference: `npx @pfdsl/cli help`. This section documents CLI v0.0.15. If a command above is reported as `unknown command`, the installed/published CLI is older than this skill — check `npx @pfdsl/cli@latest help`.

## Key constraints

- **V001 single-producer**: each artifact has at most one producing process (`->`)
- **V002 process needs inputs**: every non-isolated process needs ≥1 input (`>>`)
- **V003 process needs outputs**: every non-isolated process needs ≥1 output (`->`)
- **V020 declared process needs edges**: any process declared in frontmatter `process:` must participate in at least one edge

## Writing quality PFDs

PFD はタスクリストではなく成果物の変換グラフ。

- **最終成果物から遡って書く**: 前から並べる(push)と無意味な成果物・孤立プロセスが混入する
- **プロセス分割は依存で決める**: 時間的凝集で束ねない（束ねた全入力が全出力をゲートする偽依存）。「会場・スポンサー手配」「双方レビュー」等の並記名は束ねのサイン。分けても境界をまたぐ新依存が出ないなら割らない
- **相互依存は分割しない**: 決定が往復で形成される作業は1プロセス複数出力に。共有方針は出力の決定記録として外化する。下流作業なしで合否判定できる方針だけが上流 artifact になれる
- **所有権境界は正当な分割根拠**: 担当が替わる引き継ぎ点では artifact が契約になる — 依存上は不要でも分割してよい。単一所有者の内部では依存基準だけで決める
- **命名**: プロセスは変換が見える動詞句（「設計」「査読」。「対応」「作業」不可）、成果物は保管できるモノの名詞（「応急処置」は作業名 — 「暫定対応記録」に）。ID は短い英語スネーク、表示名は label
- **抽象度を統一**: 「システム開発」と「変数リネーム」を並べない。肥大したら別ファイルへ
- **グループは存在様式で切る**: 住処・寿命・消費局面の軸で分け、生成元では分けない — 生成関係はエッジが表現済み（ADR-0008）
- **横断的な性質は tag で束ねる（subroutine でなく）**: 同じ性質を持つノード群（成果物でも工程でもよい）は共通 tag を付ける。tag は Artifact / Process 両方に付与でき、`tag:` 定義ブロックで `label` / `description` / `style` を一元管理する。とくに構造が似た複数 Process は1ノードに畳まず（清水DFD の 1:1 leveling 維持）tag で束ねる。深い共有知識のみ companion `.md` に外化（ADR-0019）
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
- **フィールドを埋める**: artifact には `location`（実体パス/URL）・`criteria`（完了条件。todo/wip でも前宣言として書く）・`owner`（担当）を、process には `command`（実行コマンド）・`estimate`（工数）を、書けるなら書く。書かない選択も明示的に
- **点検**: `check --audit` を実行 — 終端 artifact と外部入力の一覧が2行で得られる。終端が全て意図した納品物か、外部入力に生成元を持つべきものが混ざっていないか、各プロセスが「この入力だけで出力を作れるか」を確認。図の視覚確認が必要なときだけ `graph --format dot` を使う（大きい図では dot 全読より --audit が安い）

## Typical task: update artifact status

```bash
npx @pfdsl/cli status-set <file> <artifact-id> <status>   # todo|wip|done|waiting|suspended
```

Sets the status in place and validates. Manual fallback: edit `status:` in the frontmatter `artifact:` section, then run `check`.

## References — which to read when

| 局面 | 読む場所 |
|---|---|
| status 更新・読解・小編集 | 本文で完結（references 不要） |
| 特定の構文・フィールドの書き方 | `references/samples.md`（機能別の最小例） |
| 新規 PFD の執筆・設計判断 | 本文の quality guide + `references/examples.md`（実戦ドメインの設計パターン） |
| check エラーの対処 | エラーコード（V/W）で `references/spec.md` を grep（ヒット先は §15 制約・§16 エラー方針・§20 変更履歴のいずれか） |
| フィールドの正確な仕様 | `references/spec.md` §3–5（モデル・識別子・型推論）・§14（正準順序） |
| PFD のレビュー・監査 | `references/review-prompts.md`（A/B カタログ。書くルールは本文、問い詰めはこちら） |

`references/spec.md` は full spec v0.0.11（20節・大型）— 全読せず、節見出し（`## N.`）とエラーコードで該当箇所だけ読む。
