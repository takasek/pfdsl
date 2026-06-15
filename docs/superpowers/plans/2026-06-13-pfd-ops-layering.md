# pfd-ops 層分離 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pfd-ops スキルを汎用層（他リポ配布可能）とリポ固有層に分離し、issue 管理手段をリポごとにカスタム可能にする。

**Architecture:** 運用知を4層（L1 汎用無条件 / L2 汎用スロット / L3 GitHub Issues プリセット / L4 リポ純粋固有）に分け、汎用層を SKILL.md に、L3 を references に、L4 手続き知を `.pfdsl` と対になる sibling `.md` companion に置く。スクリプトはリポ `scripts/` に残置（物理同梱は #11 のスコープ外）。

**Tech Stack:** Markdown（スキル・companion・reference）、PFDSL（ecosystem.pfdsl / roadmap.pfdsl）、pfdsl CLI（`check`）、node:test（audit テスト）。コード変更なし。

**設計仕様:** `docs/superpowers/specs/2026-06-13-pfd-ops-layering-design.md`

**先送り事項の解決（計画段階の決定）:**
- スクリプト置き場: リポ `scripts/audit-issues-flow.mjs` に残置。`resolve(__dirname, "..")` がリポルート前提でパス解決しており、スキル内へ移すと `roadmap.pfdsl` 解決が壊れるため。L3 reference が文書化し、物理同梱は実配布フロー（#11 スコープ外）へ送る
- テスト扱い: `scripts/lib/issues-flow-audit.test.mjs` も移動なし。`node --test` で継続実行

**検証コマンド（共通）:**
- PFD 検証: `node packages/cli/dist/cli.js check <file>` → `OK`
- audit テスト: `node --test scripts/lib/issues-flow-audit.test.mjs` → `tests 30 / pass 30 / fail 0`

---

## File Structure

- Create: `.pfdsl/ecosystem.md` — L4 手続き知（知見振り分け・学習ループ・payoff_log 条件・終端ゲート根拠）
- Create: `.pfdsl/roadmap.md` — このリポの issue 管理バインディング（GitHub backend、スクリプト実パス、L3 reference ポインタ、issue 固有ゲート項目）
- Create: `.claude/skills/pfd-ops/references/github-issues-backend.md` — 再利用可能 L3 プリセット規約と採用手順
- Modify: `.pfdsl/ecosystem.pfdsl` — `ecosystem.md` / `plan.md` の artifact 登録、`ops_skill` description 更新
- Modify: `.claude/skills/pfd-ops/SKILL.md` — L1+L2 へ縮約
- Modify: `.pfdsl/roadmap.pfdsl` — frontmatter description をノード事実に絞る
- 変更なし（残置）: `scripts/audit-issues-flow.mjs`, `scripts/lib/`, `.claude/commands/pfd-cycle.md`, `pfd-retro.md`

---

## Task 1: ecosystem.pfdsl に companion 成果物を登録（終端監査ルール順守 — 新設より先）

設計 §3 手順1。消費者を書けない成果物は作らないルールを順序で守る。`.md` 新設より先に ecosystem グラフへ登録する。

**Files:**
- Modify: `.pfdsl/ecosystem.pfdsl`

- [ ] **Step 1: artifact 2件を追加**

`.pfdsl/ecosystem.pfdsl` の `artifact:` ブロック末尾（`readme:` の後、`process:` の前）に追加:

```yaml
  ecosystem_md:
    label: 生態系 companion
    status: done
    group: generation
    description: ".pfdsl/ecosystem.md。ecosystem.pfdsl のグラフが運べない運用手続き散文（知見振り分け・学習ループ・payoff_log 追記条件・終端ゲート根拠）。pfd-ops skill が読む L4 ホスト"
  plan_md:
    label: 計画 companion
    status: done
    group: planning
    description: ".pfdsl/roadmap.md。roadmap.pfdsl の sibling。このリポの issue 管理バインディング（GitHub backend、監査スクリプト実パス、L3 reference ポインタ）。pfd-ops skill が読む L4 ホスト"
```

- [ ] **Step 2: producer / consumer エッジを設定**

companion は ops_skill と同じく運用知の蒸留物（producer = distill_ops）であり、運用（develop）に読まれる（consumer = develop）。既存2行を書き換える。

既存:
```
[adrs, payoff_log] >> distill_ops -> [ops_skill, retro_skill, review_prompts]
```
↓ 出力に companion 2件を追加:
```
[adrs, payoff_log] >> distill_ops -> [ops_skill, retro_skill, review_prompts, ecosystem_md, plan_md]
```

既存:
```
ops_skill >>? develop
```
↓ consumer に companion 2件を追加:
```
[ops_skill, ecosystem_md, plan_md] >>? develop
```

これで両 companion は producer・consumer の双方を持つ（終端監査クリア）。エッジ方向は「蒸留物が運用に流れる」で ops_skill と一致。

- [ ] **Step 3: check を実行**

Run: `node packages/cli/dist/cli.js check .pfdsl/ecosystem.pfdsl`
Expected: `OK`

- [ ] **Step 4: コミット**

```bash
git add .pfdsl/ecosystem.pfdsl
git commit -m "feat(ecosystem): register .md companion artifacts before creation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: ecosystem.md を新設（L4 手続き知）

設計 §3 手順3。現 SKILL.md のプロトコル6・7（知見振り分け・学習ループ）と payoff_log 追記条件・終端ゲート根拠を、グラフと対になる散文として集約。

**Files:**
- Create: `.pfdsl/ecosystem.md`

- [ ] **Step 1: ファイルを作成**

`.pfdsl/ecosystem.md` に以下を書く（現 SKILL.md L17-18, L31-32, L44-45 の固有内容を正本とする）:

```markdown
# ecosystem.md — 運用手続き（ecosystem.pfdsl の companion）

`ecosystem.pfdsl` のグラフが運べない、複数ノードをまたぐ運用手続きをここに置く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## 知見の振り分け（3経路）

実践・レビューで得た知見は3経路に振り分ける:

1. **即時ルール化** — pfdsl スキルの品質ガイド改訂（`skill_template` artifact = scripts/gen-skill.mjs 内）。スキル改善は issue を通さず対話から直接行う（`maintain_template` プロセス）
2. **設計決定** — ADR 起草（`docs/adr/`）。ADR 化した判断は適用ルールのガイド蒸留要否も判定する
3. **作業項目** — issue 起票 + 依存グラフ更新（`roadmap.pfdsl`。手段は plan.md 参照）

このリポが pfdsl スキルの上流であるため経路1（品質ガイド改訂）が成立する。配布先リポでは経路1は存在しない場合がある。

## 学習ループ

実践 → レビュー → ガイド改訂 → 再実践。ラウンド比較で「ルールで消えたミス / 残ったミス」を分離計測し、残ったものは lint 要件（ツール側）へ送る。根拠は ADR-0006「品質担保の二層構造 — ルールで防げるミスと防げないミス」。

ラウンド比較・lint 要件送りはツールチェーン開発を持つリポ固有の運用。

## payoff_log 追記条件

PFD の効果を体感した局面は `docs/pfd_payoff_log.md`（`payoff_log` artifact）に **日付・局面・効果・参照** の形式で追記する。pfdsl の効果実証が目的（このリポ固有の動機）。

## 終端ゲートの根拠

汎用ゲート項目（status 更新 / check 通過 / 論理単位コミット / PR 集約）に加え、このリポでは issue 固有項目を合成する。issue 固有項目は `plan.md` を参照。
```

- [ ] **Step 2: コミット**

```bash
git add .pfdsl/ecosystem.md
git commit -m "feat(ecosystem): add ecosystem.md companion for L4 procedural knowledge

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: references/github-issues-backend.md を新設（L3 プリセット）

設計 §3 手順5。再利用可能な GitHub Issues バックエンド規約と採用手順。リポ固有のインスタンス値（実パス・URL）は含めない（それは plan.md 側）。

**Files:**
- Create: `.claude/skills/pfd-ops/references/github-issues-backend.md`

- [ ] **Step 1: ファイルを作成**

```markdown
# GitHub Issues バックエンド（pfd-ops プリセット）

PFD の作業項目を GitHub Issues で管理する流儀。pfdsl 固有ではなく、採用したいリポが選べる再利用可能パターン。採用リポは `plan.md` でこのプリセットを指す。

## 規約

- **一次情報**: GitHub issue 本体。`roadmap.pfdsl` は依存構造のみ管理する
- **id 規約**: issue 対応 artifact の id は `iN_` prefix（N = issue 番号）。`iN_` id はオープン issue のみ参照する
- **ラベル**: 登録 issue は `flow:managed`、対象外は `flow:exempt`
- **updated_at**: 同期時点の GitHub `updatedAt` スナップショット
- **close 時の降格**: issue close 時は flow から削除する。終端はチェーンごと削除、下流入力が残るものは `iN_` prefix を外し一般 done artifact へ降格する

## 同期監査

`scripts/audit-issues-flow.mjs` が GitHub issues と `roadmap.pfdsl` の同期を機械監査する（ラベル・updatedAt・priority 突合）。`--fix` で機械的修復。

スクリプトは `resolve(__dirname, "..")` をリポルートとして `.pfdsl/roadmap.pfdsl` を解決するため、リポ `scripts/` 配下に置く。

## 採用手順

1. `scripts/audit-issues-flow.mjs` と `scripts/lib/`（`issues-flow-audit.mjs`, `yaml-require.mjs`）をリポ `scripts/` に設置する
2. GitHub に `flow:managed` / `flow:exempt` ラベルを作成する（`audit-issues-flow.mjs --fix` が未作成ラベルを自動生成する）
3. `roadmap.pfdsl` を依存構造のみのグラフとして用意し、issue artifact に `iN_` prefix を付ける
4. リポの `plan.md` で本プリセットを指し、スクリプト実パス・リポ URL を記載する
```

- [ ] **Step 2: コミット**

```bash
git add .claude/skills/pfd-ops/references/github-issues-backend.md
git commit -m "feat(pfd-ops): add GitHub Issues backend preset (L3 reference)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: plan.md を新設（このリポの issue 管理バインディング）

設計 §3 手順4。GitHub backend 採用宣言、スクリプト実パス、L3 reference ポインタ、issue 固有ゲート項目。現 roadmap.pfdsl frontmatter の規約散文の移転先。

**Files:**
- Create: `.pfdsl/roadmap.md`

- [ ] **Step 1: ファイルを作成**

```markdown
# plan.md — issue 管理バインディング（roadmap.pfdsl の companion）

`roadmap.pfdsl` は issue 依存構造のみ管理する。issue の一次情報と同期手段はここに書く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## バックエンド

GitHub Issues（github.com/takasek/pfdsl/issues）。規約と採用手順は pfd-ops スキルの `references/github-issues-backend.md`（L3 プリセット）に従う。

## このリポのインスタンス値

- 一次情報: github.com/takasek/pfdsl/issues
- 同期監査スクリプト: `scripts/audit-issues-flow.mjs`（`--fix` で機械的修復）
- 監査対象: `.pfdsl/roadmap.pfdsl`

## 着手時の終端ゲート（issue 固有項目）

汎用ゲート（status 更新 / check 通過 / 論理単位コミット / PR 集約）に加え:

- [ ] 完了した issue をクローズし、進捗・新発見を issue に反映した
- [ ] close 時の降格規則を適用した（終端はチェーンごと削除、下流入力が残るものは `iN_` prefix を外す）
```

- [ ] **Step 2: コミット**

```bash
git add .pfdsl/roadmap.md
git commit -m "feat(plan): add plan.md companion for issue management binding

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: roadmap.pfdsl frontmatter description をノード事実に絞る

設計 §3 手順4。規約散文を plan.md へ移したので、description は依存構造グラフとしての最小事実に絞る。

**Files:**
- Modify: `.pfdsl/roadmap.pfdsl:2-9`（frontmatter の description フィールド）

- [ ] **Step 1: description を置換**

現在の description（issue 規約散文を全て含む長文）を、ノード事実のみに置換する:

```yaml
description: オープン issue の依存関係と着手可能順序。issue 本体が一次情報、本ファイルは依存構造のみ管理。issue
  管理規約・同期手段は sibling plan.md と pfd-ops スキルの references/github-issues-backend.md 参照
```

- [ ] **Step 2: check を実行**

Run: `node packages/cli/dist/cli.js check .pfdsl/roadmap.pfdsl`
Expected: `OK`

- [ ] **Step 3: audit テストが通ることを確認**（description 変更が audit ロジックに影響しないこと）

Run: `node --test scripts/lib/issues-flow-audit.test.mjs`
Expected: `tests 30 / pass 30 / fail 0`

- [ ] **Step 4: コミット**

```bash
git add .pfdsl/roadmap.pfdsl
git commit -m "refactor(plan): slim frontmatter description to node facts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: SKILL.md を L1+L2 へ縮約

設計 §3 手順6 + §5（pfd-cycle 固有パス書き換え）。固有事項を削除し L2 ディスパッチへ置換。ADR-0004 判定テストは本文に蒸留済み（現 L28）を維持。ワークサイクル §選択 の固有パスを companion 問い合わせに書き換え。

**Files:**
- Modify: `.claude/skills/pfd-ops/SKILL.md`（全面改訂）

- [ ] **Step 1: SKILL.md を以下に置換**

```markdown
---
name: pfd-ops
description: |
  Use when operating a project with PFDs — prioritizing or accepting issues,
  updating progress status after completing work, adding new artifacts or
  documents to the repo, or deciding where session learnings should be
  recorded. Complements the pfdsl skill (notation and quality of .pfdsl
  files); this skill covers how to run the project on top of them.
---

# PFD-driven project operations

記法・品質ガイドは pfdsl スキル。本スキルは汎用運用プロトコル。リポ固有のバインディングは各 `.pfdsl` の sibling `.md` companion と references に置く。

## 運用ファイルの所在（L2 ディスパッチ）

このスキルは固有名詞を持たない。運用対象と手段は次の規約で解決する:

- 各運用 `.pfdsl` ファイルには、同名 sibling の Markdown companion が任意で対になる。`<file>.pfdsl` を扱うときは sibling `<file>.md` も読んで従う
- **作業項目の一次情報と同期手段**: `roadmap.pfdsl` とその sibling `plan.md` に従う
- **知見の振り分け先・運用手続き**: `ecosystem.pfdsl` の知識系成果物と、その sibling `ecosystem.md`
- **issue バックエンド規約**: companion が指す references（例: `references/github-issues-backend.md`）

## 運用プロトコル

1. **着手判断**: 入力 artifact が全て done のプロセス = 着手可能。並列着手集合は status から機械的に導出する（優先順位の議論より先にまず列挙）
2. **新規作業の受け入れ**: 作業項目を起票（手段は plan.md）→ 依存グラフに1チェーン追加 → 並列性・接点・合流点を確定させてから着手する
3. **依存レビュー**: 「並列でいける」という直感は図に書いて初めてレビュー可能になる。決定が往復で形成される相互依存が見つかったら分割せず統合する。判定テスト: 上流方針の合否基準を下流作業なしで書けるか（書けなければ上流方針は入力でなく出力 = 相互依存の証拠）
4. **進捗更新**: 作業完了 = 出力 artifact の status 更新。コミットと同時に行う。done の根拠が言えない場合は出力成果物の定義を疑う
5. **成果物の門番**: 消費者を書けない成果物は作らない（終端監査）。新しい種類の成果物は `ecosystem.pfdsl` に producer・consumer を登録してから作る
6. **知見の振り分け**: 実践・レビューで得た知見を記録先成果物へ振り分ける。宛先候補は `ecosystem.pfdsl` の知識系成果物、振り分け手続きは sibling `ecosystem.md`
7. **定期監査**: 次のいずれかで pfd-retro を起動する — 設計対話が長く続いた後 / ADR が数本たまった時 / 同一 PFD に連続修正が入った時 / セッションの締め際。ユーザーの気付きを待たない。findings はプロトコル6の経路で振り分ける

## ワークサイクル（/pfd-cycle の手順）

コンテキストのないセッションでも1サイクル回せる自己完結手順。範囲規則: **1サイクル = 1プロセス**。大きすぎる場合は粒度ルールで分割を計画 PFD に反映してから着手する。

1. **選択**: 運用対象の計画 PFD（`roadmap.pfdsl` とその他のロードマップ PFD。所在は sibling `.md` companion が定義）から、入力 artifact が全て done のプロセスを列挙。ユーザー指定があればそれを、なければ合流点を解放するもの（後続プロセスの最後の未完入力になっているもの）を優先して1つ選ぶ
2. **実行**: 作業項目の一次情報は plan.md が指すバックエンド。ブランチを切って作業する（main 直コミットしない）。PFD の読み書きは pfdsl スキルの品質ガイドに従う。まとまった執筆・実装は subagent に委譲し、本体は指示と評価に専念する
3. **反映 — 終端ゲート（全項目を明示的に確認。「該当なし」も判断として記録）**:
   - [ ] 出力 artifact の status を更新した
   - [ ] 知見を ecosystem.md の振り分け手続きに従って振り分けた
   - [ ] 実行中に発見した新プロセス・成果物を計画 PFD に追記した（消費者を明示できないものは作らない）
   - [ ] 変更した全 .pfdsl が `check` を通過する
   - [ ] 論理単位でコミットした
   - [ ] 変更束を PR にまとめた
   - [ ] companion（plan.md 等）が定義するリポ固有の追加ゲート項目を確認した
4. **報告**: 完了したプロセス、それにより解放された後続プロセス、更新後の着手可能集合

## References

- 各運用 `.pfdsl` の sibling `.md` companion — リポ固有のバインディングと手続き
- `references/github-issues-backend.md` — GitHub Issues バックエンドのプリセット規約（採用リポのみ）
```

- [ ] **Step 2: 固有名詞が残っていないことを確認**

Run: `grep -nE "payoff_log|audit-issues|pfdsl_implementation_flow|iN_|flow:managed|ラウンド|lint|品質ガイド改訂|takasek" .claude/skills/pfd-ops/SKILL.md`
Expected: 出力なし（references 内の `github-issues-backend.md` という汎用ファイル名は許容、上記パターンには一致しない）

- [ ] **Step 3: コミット**

```bash
git add .claude/skills/pfd-ops/SKILL.md
git commit -m "refactor(pfd-ops): reduce SKILL.md to generic L1+L2 protocol

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: ecosystem.pfdsl の ops_skill description を更新

設計 §3 手順7。現 description（`.claude/skills/pfd-ops/ と /pfd-cycle コマンド。…手書き（生成対象外）`）に層構成への言及を1行加える。ノード事実の粒度を保つ。

**Files:**
- Modify: `.pfdsl/ecosystem.pfdsl`（`ops_skill` artifact の description、:123-127 付近）

- [ ] **Step 1: ops_skill description を置換**

現 description:
```yaml
    description: ".claude/skills/pfd-ops/ と /pfd-cycle コマンド。PFD によるプロジェクト運用プロトコルとワークサイクル（選択→実行→終端ゲート→報告）。手書き（生成対象外）"
```

更新後:
```yaml
    description: ".claude/skills/pfd-ops/ と /pfd-cycle コマンド。PFD によるプロジェクト運用プロトコルとワークサイクル。汎用層（L1+L2）= SKILL.md 本文、GitHub Issues プリセット（L3）= references/、リポ固有（L4）= 各 .pfdsl の sibling .md companion。手書き（生成対象外）"
```

- [ ] **Step 2: check を実行**

Run: `node packages/cli/dist/cli.js check .pfdsl/ecosystem.pfdsl`
Expected: `OK`

- [ ] **Step 3: コミット**

```bash
git add .pfdsl/ecosystem.pfdsl
git commit -m "docs(ecosystem): reflect layer structure in ops_skill description

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: 検証 — 思考実験・全 check・audit テスト

設計 §6 検証節。

**Files:** なし（検証のみ）

- [ ] **Step 1: 思考実験（L3 非依存の確認）**

新 SKILL.md だけを読み、「GitHub Issue を使わず roadmap.pfdsl だけで運用する架空リポ（plan.md なし）」が1サイクル回せるか机上で確認する。確認観点:
- ワークサイクル §選択 が固有パスなしで成立するか（companion 不在でも roadmap.pfdsl 直接参照で破綻しないか）
- プロトコル各項に GitHub/issue 固有の前提が残っていないか

破綻する記述があれば Task 6 に戻り修正。

- [ ] **Step 2: 全 .pfdsl の check**

Run:
```bash
node packages/cli/dist/cli.js check .pfdsl/ecosystem.pfdsl && \
node packages/cli/dist/cli.js check .pfdsl/roadmap.pfdsl && \
node packages/cli/dist/cli.js check docs/pfdsl_implementation_flow.pfdsl
```
Expected: 各 `OK`

- [ ] **Step 3: audit テスト**

Run: `node --test scripts/lib/issues-flow-audit.test.mjs`
Expected: `tests 30 / pass 30 / fail 0`

- [ ] **Step 4: audit 同期確認（roadmap.pfdsl description 変更が同期を壊していないこと）**

Run: `node scripts/audit-issues-flow.mjs`
Expected: `roadmap.pfdsl is in sync`（または既存の findings のみ。本変更起因の新規 finding がないこと）

- [ ] **Step 5: dogfood — implementation_flow に本作業を反映**

`docs/pfdsl_implementation_flow.pfdsl` に本作業（pfd-ops 層分離）が artifact/process として登録されているか確認し、status を更新する。未登録なら追記する（消費者を明示できる形で）。

Run: `node packages/cli/dist/cli.js check docs/pfdsl_implementation_flow.pfdsl`
Expected: `OK`

- [ ] **Step 6: コミット（implementation_flow 更新があれば）**

```bash
git add docs/pfdsl_implementation_flow.pfdsl
git commit -m "chore(flow): update implementation roadmap for pfd-ops layering

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: PR 作成

設計 §6 移行完了 + CLAUDE.md の正規経路（develop→PR→merge）。

**Files:** なし（PR 操作）

- [ ] **Step 1: ブランチを push**

```bash
git push -u origin refactor/pfd-ops-layering
```

- [ ] **Step 2: PR を作成**

```bash
gh pr create --title "refactor(pfd-ops): separate generic protocol from repo-specific issue management" --body "$(cat <<'EOF'
## 概要

pfd-ops スキルを汎用層（他リポ配布可能）とリポ固有層に分離。issue 管理手段をリポごとにカスタム可能にする。

## 層構造

- L1+L2 汎用 → SKILL.md（固有名詞ゼロ）
- L3 GitHub Issues プリセット → references/github-issues-backend.md
- L4 リポ固有 → .pfdsl の sibling .md companion（ecosystem.md / plan.md）

## #11 との関係

#11「配布可能スキル」の一部。本 PR で配布可能な構造に整える。実配布フローは #11 スコープ外。

設計: docs/superpowers/specs/2026-06-13-pfd-ops-layering-design.md
計画: docs/superpowers/plans/2026-06-13-pfd-ops-layering.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review チェック結果

**Spec coverage:**
- L1 汎用 → Task 6（SKILL.md プロトコル）✓
- L2 スロット → Task 6（ディスパッチ節）✓
- L3 プリセット → Task 3 ✓
- L4 手続き知 → Task 2（ecosystem.md）+ Task 4（plan.md）✓
- `.md` companion 規約 → Task 6（ディスパッチ節）+ Task 1（成果物登録）✓
- 終端監査順序（登録先行）→ Task 1 が最初 ✓
- ops_skill 更新 → Task 7 ✓
- roadmap.pfdsl description 縮約 → Task 5 ✓
- pfd-cycle 固有パス書き換え → Task 6 Step 1 ワークサイクル §選択 ✓
- スクリプト残置決定 → 計画ヘッダで明示、Task 3 reference に文書化 ✓
- 検証（思考実験・check・audit・dogfood）→ Task 8 ✓
- #11 close 条件 → Task 9 PR body ✓

**Placeholder scan:** TBD/TODO なし。各 .md の全文を草案として埋め込み済み。

**Type consistency:** artifact id（`ecosystem_md` / `plan_md`）、ファイルパス、プロセス名（`distill_ops`）はタスク間で一貫。
