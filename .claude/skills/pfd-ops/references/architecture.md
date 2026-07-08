# pfd-ops アーキテクチャ

pfd-ops スキルは4層で構成される。各層の「配布可能性」が異なる。

## 層の概要

| 層 | 内容 | 配布可能性 |
|---|---|---|
| **L1** 汎用プロトコル | PFD という概念だけから導ける手順。固有名詞ゼロ | SKILL.md 本文に直接記載 |
| **L2** ディスパッチ | 汎用パターン。宛先はリポが供給する `.md` companion | SKILL.md 本文でディスパッチ先を規約化 |
| **L3** バックエンド・プリセット | 「GitHub Issues で管理する」流儀。採用リポが選択して利用 | `references/` に同梱して配布 |
| **L4** リポ固有 | 対象リポ専有の事項（payoff_log・品質ガイド改訂経路等） | 配布対象外。採用リポの companion に記述 |

## L1: 汎用プロトコル（SKILL.md 本文）

PFD の概念だけで導ける手順。固有名詞なし。
項目の内容は SKILL.md 本文（「運用プロトコル」「ワークサイクル」）が一次情報 — ここには複製しない（列挙ドリフト防止）。

## L2: ディスパッチ（SKILL.md 本文）

汎用スキルは「ここに従え」とディスパッチするだけで、宛先はリポが供給する。
ディスパッチ先の一覧は SKILL.md 本文「運用ファイルの所在（L2 ディスパッチ）」が一次情報 — ここには複製しない。

`.md` companion の機構（「sibling を読め」という規約）は L2 に属し SKILL.md に記載する。companion の中身は L4（リポ固有）に属す。

`.pfdsl/bindings/<スキル名>.md` はスキル固有の恒常指示を置く独立ファイルで、companion ではない（対応する `.pfdsl` グラフを持たず、sibling 規約の対象外）。スキルが自分の SKILL.md から直接参照する（詳細は次項）。sibling companion（`roadmap.md`・`workflow.md`・`runtime-pipeline.md`）に混ぜないのは、読み込み契機（PFD グラフを扱うタイミング）とスキル発火のタイミングが一致しないため。

### companion への書き分けルール（一次情報）

findings やゲート項目を companion に書くとき、**どの companion か**の判断基準:

| 書く内容の種類 | 宛先 companion |
|---|---|
| issue 固有ゲート・issue 管理バインディング・自動生成 PR 規約・issue バックエンド手続き | `roadmap.md` |
| 繰り返し手続き・知見振り分けルール・`develop` プロセスの運用規約・retro 宛先バインディング | `workflow.md` |
| 変換コンポーネントの追加・削除・境界変更に関する手続き | `runtime-pipeline.md` |
| Claude 向け追加指示（PR 本文規約等）| `.pfdsl/bindings/pfd-ops.md` |

この表が一次情報。`pfd-ops SKILL.md` の L2 ディスパッチ・`pfd-retro` の出力振り分け・`.pfdsl/bindings/pfd-retro.md` はすべてここを参照する。

### バインディングファイルの命名規則

スキル固有の恒常指示・監査結果等は `.pfdsl/bindings/<スキル名>.md` に置く（例: `.pfdsl/bindings/pfd-retro.md`、`.pfdsl/bindings/pfd-ops.md`）。SKILL.md 側は「`.pfdsl/bindings/<スキル名>.md` が存在すれば読んで従う」とだけ書き、ファイルの中身（具体的な運用手続き）は書かない。1ファイルに集約しない（例えば全スキル分を `workflow.md` に集約しない）のは、companion がスキルと無関係な PFD 操作のたびに毎回丸ごと読まれる既存の読み込みモデルでは、集約するほど無関係な読み込みコストが増えるため。ファイル名（セクション名でなく）を規約にするのは、スキルが増えても既存ファイルへの追記でなく新規ファイル追加で済み、規約自体の変更が不要なため。
実行記録等を常時ホストするファイル（例: `pfd-retro.md`）は scaffold に用意するが、内容が空でも実害のないファイル（例: `pfd-ops.md`）は scaffold に含めず、最初の恒常指示が生まれた時点で作成してよい。

## L3: GitHub Issues バックエンド（`references/github-issues-backend.md`）

「PFD の作業項目を GitHub Issues で管理する」流儀。pfdsl 固有ではなく、採用したいリポが選択できる再利用可能プリセット。

`skill sync` を実行すると `references/github-issues-backend.md` が `.claude/skills/pfd-ops/` に同梱される。

### 配布単位

`pfdsl skill sync` は pfd-ops 単体でなく、pfd-ops / pfd-retro / pfd-ecosystem / pfdsl の4スキルツリーと `.claude/commands/` の pfd-* コマンド群を採用リポへ一括配布する（実装は pfdsl CLI の skill-sync）。
スキル間の相互参照（pfd-retro → pfdsl の review-perspectives、pfd-ecosystem → pfd-ops の scaffold、コマンド → 各スキル）はこの bundle 配布が担保する。

L3 を採用するには `install/` テンプレートをリポルートにコピーする:

```bash
cp -r .claude/skills/pfd-ops/install/. .
```

採用済みかどうかは `install/` 由来のファイル（ワークフロー等）の存在で判定される。

主な規約:
- issue が一次情報。`roadmap.pfdsl` は依存構造のみ管理
- process id は `iN_` prefix（N = issue 番号）。恒久 — issue close 後も剥がさない。出力 artifact id は最初から plain
- `flow:managed` / `flow:exempt` ラベルで管理対象を分類
- issue close 時: 終端はチェーンごと削除、下流入力が残るものは process 側の `tags`/`updated_at` のみ削除
- `audit-issues-flow.mjs` で同期監査・機械修復

詳細: [`github-issues-backend.md`](github-issues-backend.md)

## L4: リポ固有（配布対象外）

採用リポ固有の事項。各リポの `.md` companion（`roadmap.md` / `workflow.md` 等）に記述する。

pfdsl 開発リポ固有の例:
- payoff_log: PFD の効果を収集する目的
- pfdsl 品質ガイド改訂経路（このリポが pfdsl スキルの上流だから存在）
- ADR 改訂規約
- 学習ループのラウンド比較・残存ミスの lint 要件送り
- review-perspectives の C 観点を適用した pfdsl 固有例: 配布カタログ `docs/review-perspectives.md` の当リポ instance（`.pfdsl/review-perspectives.md`）
- review-perspectives instance（`.pfdsl/review-perspectives.md`）自体は図-companion でなく、配布参照カタログの repo-local instance

## `install/` ディレクトリの役割

```
.claude/skills/pfd-ops/
  SKILL.md                     ← L1 + L2
  references/
    architecture.md            ← このファイル
    github-issues-backend.md   ← L3 プリセット規約
    scaffold/                  ← L4 雛形テンプレート
  install/                     ← L3 採用用テンプレート（リポルートへ cp -r）
    .github/workflows/         ← flow-on-issue-close 等
    scripts/                   ← audit-issues-flow.mjs 等
```

`install/` は `skill sync` によって `.claude/skills/pfd-ops/install/` まで同期される。リポルートへのデプロイは採用済みリポのみ自動更新される（L3 採用済みかどうかで挙動が分岐）。

## 「採用」とは

L3 バックエンド（GitHub Issues 連携ワークフロー）を使う設定を当該リポに展開した状態。`install/` 由来のファイルがリポルートに1つ以上存在すれば「採用済み」と判定する。

未採用リポで `skill sync` を実行すると次のメッセージが表示される:

```
GitHub Issues バックエンド (L3) は未採用です。採用する場合は次を実行してください:
  cp -r .claude/skills/pfd-ops/install/. .
```

「L3」= GitHub Issues バックエンドプリセット、「バックエンド」= 作業項目管理の一次情報源と同期機構を指す。

## 配布物中の ADR 参照の解決

配布スキル・reference に現れる `ADR-\d+` は、上流リポ（github.com/takasek/pfdsl）の `docs/adr/` にある設計記録を指す。採用リポには同梱されない — 設計根拠を確認したいときは上流リポを参照する。
