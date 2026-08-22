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
| Codex 向け追加指示（PR 本文規約等）| `.pfdsl/bindings/pfd-ops.md` |

この表が一次情報。`pfd-ops SKILL.md` の L2 ディスパッチ・`pfd-retro` の出力振り分け・`.pfdsl/bindings/pfd-retro.md` はすべてここを参照する。

### companion の記述言語（一次情報）

companion（`.pfdsl/*.md`・`.pfdsl/bindings/*.md`）は内部メンテナ向け資料なので、そのリポの**メンテナが読む言語**で書く。公開物（README・CLI 出力・外部提出物）の言語と一致させる必要はない。判断軸は「読み手が外部ユーザーか内部メンテナか」。
配布 scaffold は日本語で配布されるが、これは既定値であって規約ではない。採用リポは初期構築時に自リポのメンテナ言語へ翻訳してよい。翻訳する場合はファイル単位で統一する（見出しだけ原文を残す等の混在をしない）。

### 昇格先の判定ルール（L4 → 配布層、一次情報）

上の表は**どの companion に書くか**を決めるものであり、companion に溜まった汎用ルールを**配布層のどのファイルへ昇格するか**は決められない。昇格先は次の2段で決める。

**1段目 — どのスキルの管轄か。** 昇格元の companion がこれを決める。
PFD の sibling companion（上の表が宛先として挙げるもの）はすべて pfd-ops の管轄で、扱う PFD が違っても昇格先のスキルは変わらない。
`.pfdsl/bindings/<スキル名>.md` はファイル名が名乗るスキルの管轄。
companion の一覧をここに再掲しないのは、上の表と二重管理になり、companion が増えたとき片方だけ古くなるため。

**2段目 — そのスキルの中で SKILL.md 本文か reference か。** 固有名詞を含まず、そのスキルの全利用者に無条件で効く原則・プロトコルなら SKILL.md 本文（L1）。特定バックエンドの採用を前提にする規約なら L3 reference。手順の細目で、本文から手続きとして切り出されているものはその reference（pfd-ops のサイクル4手順なら `references/work-cycle.md`）。

固有名詞（リポ名・パッケージ名・ツール名・パス・issue 番号・ADR 番号）が残るものは、どの段でも配布層へ昇格できない。一般化してから昇格し、一般化できない具体例は companion に残す。

**ルール文が事実を主張している場合、その事実を一次情報で確認してから昇格する。** 固有名詞テストは文面だけで判定できるが、事実の真偽は文面から出ない — 両者を同じ工程で済ませると、検証されないまま配布層へ運ばれる。とくに落ちやすいのは、リポの外にあるもの（実行環境・harness・外部ツール）の仕様を述べる文である。自リポの実装なら誤りはいずれ実行時に露見するが、外部の仕様についての誤りは、その機能を使わない限り露見しない — 「使えない」と書いた文は、それを信じた読み手がその経路を試さなくなることで、自分の反証を封じる。確認できなかった場合は、ルール文からその事実への依存を外してから昇格する（能力の列挙をやめ、版に依存しない判断軸で書き直す）。

**一般形と元文を並べ、削った語を全部列挙する。** 一般化で削る対象は固有名詞だが、同じ作業で限定詞（「ことがある」「場合がある」「多くは」）も落ちる — どちらも「具体に属するもの」に見えるためである。落ちた結果、元文が正しく限定していた主張が一般形では無条件の断定になり、元の観測が1事例だったことは一般形からは読めなくなる。削った語に固有名詞でないものが混じっていたら、それが限定していた範囲を一般形へ書き戻す。観測が1事例なら、一般形にも1事例であることが残る書き方を選ぶ。

### バインディングファイルの命名規則

スキル固有の恒常指示・監査結果等は `.pfdsl/bindings/<スキル名>.md` に置く（例: `.pfdsl/bindings/pfd-retro.md`、`.pfdsl/bindings/pfd-ops.md`）。SKILL.md 側は「`.pfdsl/bindings/<スキル名>.md` が存在すれば読んで従う」とだけ書き、ファイルの中身（具体的な運用手続き）は書かない。1ファイルに集約しない（例えば全スキル分を `workflow.md` に集約しない）のは、companion がスキルと無関係な PFD 操作のたびに毎回丸ごと読まれる既存の読み込みモデルでは、集約するほど無関係な読み込みコストが増えるため。ファイル名（セクション名でなく）を規約にするのは、スキルが増えても既存ファイルへの追記でなく新規ファイル追加で済み、規約自体の変更が不要なため。
`bindings/<スキル名>.md` を読む規約を持つスキルの数だけ scaffold にファイルを用意する（内容が空でも実害のないファイル含む）。存在確認のコストは空ファイルでも実質変わらないため、都度作成でなく最初から揃えておく。
bundle 同梱スキル全数ではない — 自分の binding を読まないスキルの分を置いても、誰も読まないファイルが採用リポに増えるだけである。
スキルが新たに binding を読み始めたら、その時点で scaffold にも1ファイル追加する。

## L3: GitHub Issues バックエンド（`references/github-issues-backend.md`）

「PFD の作業項目を GitHub Issues で管理する」流儀。pfdsl 固有ではなく、採用したいリポが選択できる再利用可能プリセット。

`references/github-issues-backend.md` は pfd-ops スキルの一部として plugin に同梱される（ADR-0028）。

### 配布単位

pfdsl / pfd-grill / pfd-ops / pfd-retro / pfd-ecosystem の5スキルツリー・pfd-* コマンド群・pfd-lens agent は、Claude Code と Codex の両方で使える plugin（`plugin/pfdsl/`、`make gen-plugin` で組み立て）として marketplace 配布される（ADR-0028。旧 `pfdsl skill sync` は廃止）。
スキル間の相互参照（pfd-retro → pfdsl の review-perspectives、pfd-ecosystem → pfd-ops の scaffold、コマンド → 各スキル）はこの bundle 配布が担保する。
`hooks/`（PostToolUse retro リマインダ等）も同じ bundle に同梱される。plugin hook はインストール/有効化の同意機構を各ハーネスのプラットフォーム側に委ねる（`install/` + `check-install-sync.mjs --deploy` の配線を pfd-ops が自前で持たずに済む代替経路）。

L3 を採用するには `install/` テンプレートをリポルートへ実配置する（`/pfd-init` のステップ 3.5 が実行する）:

```bash
node <pfd-ops skill root>/scripts/check-install-sync.mjs --deploy
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
<pfd-ops skill root>/            ← plugin: ${PLUGIN_ROOT}/skills/pfd-ops、repo-local: .agents/skills/pfd-ops
  SKILL.md                     ← L1 + L2
  references/
    architecture.md            ← このファイル
    work-cycle.md              ← /pfd-cycle のサイクル4手順（L1 の手順本文を SKILL.md から切り出したもの）
    github-issues-backend.md   ← L3 プリセット規約
    scaffold/                  ← L4 雛形テンプレート
  scripts/
    check-install-sync.mjs     ← install/ の実配置・鮮度セルフチェック（ADR-0028）
    plugin-version-check.mjs   ← plugin version skew チェック（install/ 同期と無関係、check-install-sync.mjs から呼ばれる）
  install/                     ← L3 採用用テンプレート（リポルートへ実配置）
    .github/workflows/         ← pfdsl-flow-on-issue-close.yml
    scripts/pfdsl/             ← audit-issues-flow.mjs 等（配布物の由来を示す専用ディレクトリ、ADR-0032）
```

`install/` の canonical は plugin に同梱され、リポルートへの実配置・更新は `check-install-sync.mjs --deploy`（`/pfd-init` ステップ 3.5）が行う。
配置済みファイルと同梱 canonical の乖離は、pfd-ops 発火時のランタイムセルフチェック（SKILL.md「配置ファイルの鮮度セルフチェック」）が hash 照合で警告する。

## 「採用」とは

L3 バックエンド（GitHub Issues 連携ワークフロー）を使う設定を当該リポに展開した状態。`install/` 由来のファイルがリポルートに1つ以上存在すれば「採用済み」と判定する。

「L3」= GitHub Issues バックエンドプリセット、「バックエンド」= 作業項目管理の一次情報源と同期機構を指す。

## 配布物中の ADR 参照の解決

配布スキル・reference に現れる `ADR-\d+` は、上流リポ（github.com/takasek/pfdsl）の `docs/adr/` にある設計記録を指す。採用リポには同梱されない — 設計根拠を確認したいときは上流リポを参照する。
