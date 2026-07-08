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
type: roadmap     # roadmap | workflow | runtime-pipeline（§2.10）。`ready` は roadmap のみ対象。省略可
extends: presets.yaml   # 表示系キー（statusStyles 等）のプリセット継承（§2.9.4）
basePath: ../     # location:/command: の解決基準ディレクトリ。省略時はこの .pfdsl のディレクトリ
layout:
  direction: LR   # LR | RL | TB | BT (default LR)
  maxWidth: 120   # label wrap width in px (optional)

artifact:
  <id>:
    label: 人間向けラベル
    description: ...
    status: done           # todo=未着手 | wip=生産中（ブランチ/PR open）| done=main済み | waiting=外部要因待ち | suspended=自主保留
    criteria: ...           # 完了条件（todo/wip でも前宣言として書く）
    location: path/to/file  # 実体ファイル・URL へのポインタ。可視化でリンクになる。相対パスは「この .pfdsl ファイルからの相対」で書く
    owner: ...
    group: <group-id>
    tags: [tag1, tag2]
    parts: [sub-artifact-id, ...]
    revises: <artifact-id>  # 同ファイル内の改版元 artifact ID
    externalStakeholders: [...]  # 変換グラフ外の読み手（外部提出先等。owner と対称。process にも指定可）
    index: 1                # 外部ツール向け採番（D{index}/P{index}。任意。process にも指定可）

process:
  <id>:
    label: ...
    description: ...
    owner: ...
    group: <group-id>
    tags: [tag1, tag2]      # Artifact / Process 両方に指定可（group と対称）
    command: npm run build  # 対応する実行コマンド
    estimate: 2d            # 工数見積もり（形式自由）
    subflow: child.pfdsl    # 子 PFD への展開リンク（§2.9.3）
    boundary: { parent_id: child_id }  # subflow の親→子 artifact ID 対応表（1:1）

group:
  <id>:
    label: ...
    color: "#f0f0f0"
    parent: <group-id>      # 入れ子グループ

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

その他のトップレベルフィールド（`version` / `dslVersion` 等）と各フィールドの正確な仕様は `references/spec.md` §2、機能別の最小例は `references/samples.md` を参照。

## CLI

```bash
{{cliCommands}}
```

Full flag reference: `npx @pfdsl/cli help`. This section documents CLI v{{cliVersion}}. If a command above is reported as `unknown command`, the installed/published CLI is older than this skill — check `npx @pfdsl/cli@latest help`.

## Key constraints

- **V001 single-producer**: each artifact has at most one producing process (`->`)
- **V002 process needs inputs**: every non-isolated process needs ≥1 input (`>>`)
- **V003 process needs outputs**: every non-isolated process needs ≥1 output (`->`)
- **V010 primary graph is a DAG**: no cycle via `>>` / `->` (feedback `>>?` is exempt)
- **V020 declared process needs edges**: any process declared in frontmatter `process:` must participate in at least one edge

Full V/W list: `references/spec.md` §15–16.

## Writing quality PFDs

PFD はタスクリストではなく成果物の変換グラフ。
新規執筆・ノード追加・構造変更の前に `references/quality-guide.md`（設計判断ルール）を必ず読む。

## 読解と点検

- **読解**: 大きい PFD は全読しない。`check --audit` の2行（終端 artifact と外部入力）で輪郭を掴み、対象ノードの frontmatter だけ読む。roadmap では `ready --best` が着手可能プロセスを返す
- **書いた後の点検**: 同じ --audit の2行で、終端が全て意図した納品物か、外部入力に生成元を持つべきものが混ざっていないかを確認。あわせて各プロセスが「この入力だけで出力を作れるか」を見る
- roadmap と flow ファイルが併存する構成では `audit-sync <roadmap> <flow>...` で flow 側 todo artifact と roadmap の整合も点検する
- 図の視覚確認が必要なときだけ `graph --format dot` を使う（大きい図では dot 全読より --audit が安い）

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
| 新規 PFD の執筆・設計判断 | `references/quality-guide.md`（必読）+ `references/examples.md`（実戦ドメインの設計パターン。先頭の Index で該当例の行範囲を特定し、そこだけ Read する） |
| check エラーの対処 | エラーコード（V/W）で `references/spec.md` を grep（ヒット先は §15 制約・§16 エラー方針・§20 変更履歴のいずれか） |
| フィールドの正確な仕様 | `references/spec.md` §3–5（モデル・識別子・型推論）・§14（正準順序） |
| PFD のレビュー・監査 | `references/review-perspectives.md`（A/B/C カタログ。A/B は図、C は normative 仕様文書（自リポ保守の仕様がある場合）の監査。書くルールは `references/quality-guide.md`、問い詰めはこちら） |

`references/spec.md` は full spec {{specVersion}}（20節・大型）— 全読せず、節見出し（`## N.`）とエラーコードで該当箇所だけ読む。
