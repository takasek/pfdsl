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

- **着手判断**: 入力 artifact が全て done のプロセス = 着手可能。並列着手集合を status から機械的に列挙する
- **新規作業受け入れ**: 依存グラフに1チェーン追加 → 並列性・接点・合流点を確定してから着手
- **依存レビュー**: 相互依存（決定が往復で形成される関係）は分割せず統合する
- **進捗更新**: 完了 = 出力 artifact の status 更新、コミットと同時
- **終端監査**: 消費者を書けない成果物は作らない
- **ワークサイクル骨格**: 選択 → 実行 → 反映 → 報告（1サイクル1プロセス）
- **retro 起動条件**: 設計対話が長引いた後 / ADR 数本蓄積 / 同一 PFD 連続修正 / セッション締め際

## L2: ディスパッチ（SKILL.md 本文）

汎用スキルは「ここに従え」とディスパッチするだけで、宛先はリポが供給する。

| ディスパッチ先 | 内容 |
|---|---|
| `<file>.pfdsl` の sibling `<file>.md` companion | リポ固有バインディング・手続き知 |
| `roadmap.pfdsl` + `roadmap.md` | 作業項目の一次情報と同期手段 |
| `workflow.pfdsl` + companion | 知見の振り分け先・手続き |
| `references/github-issues-backend.md` 等 | バックエンド規約（採用リポのみ参照） |

`.md` companion の機構（「sibling を読め」という規約）は L2 に属し SKILL.md に記載する。companion の中身は L4（リポ固有）に属す。

## L3: GitHub Issues バックエンド（`references/github-issues-backend.md`）

「PFD の作業項目を GitHub Issues で管理する」流儀。pfdsl 固有ではなく、採用したいリポが選択できる再利用可能プリセット。

`skill sync pfd-ops` を実行すると `references/github-issues-backend.md` が `.claude/skills/pfd-ops/` に同梱される。

L3 を採用するには `install/` テンプレートをリポルートにコピーする:

```bash
cp -r .claude/skills/pfd-ops/install/. .
```

採用済みかどうかは `install/` 由来のファイル（ワークフロー等）の存在で判定される。

主な規約:
- issue が一次情報。`roadmap.pfdsl` は依存構造のみ管理
- artifact id は `iN_` prefix（N = issue 番号）。オープン issue のみ参照
- `flow:managed` / `flow:exempt` ラベルで管理対象を分類
- issue close 時: 終端はチェーンごと削除、下流入力が残るものは prefix を外し一般 done artifact へ降格
- `audit-issues-flow.mjs` で同期監査・機械修復

詳細: [`github-issues-backend.md`](github-issues-backend.md)

## L4: リポ固有（配布対象外）

採用リポ固有の事項。各リポの `.md` companion（`roadmap.md` / `ecosystem.md` 等）に記述する。

pfdsl 開発リポ固有の例:
- payoff_log: PFD の効果を収集する目的
- pfdsl 品質ガイド改訂経路（このリポが pfdsl スキルの上流だから存在）
- ADR 改訂規約・review-prompts.md
- 学習ループのラウンド比較・残存ミスの lint 要件送り

## `install/` ディレクトリの役割

```
.claude/skills/pfd-ops/
  SKILL.md                     ← L1 + L2
  references/
    architecture.md            ← このファイル
    github-issues-backend.md   ← L3 プリセット規約
    ecosystem-setup-prompt.md  ← ecosystem.pfdsl 構築プロンプト
    scaffold/                  ← L4 雛形テンプレート
  install/                     ← L3 採用用テンプレート（リポルートへ cp -r）
    .github/workflows/         ← flow-on-issue-close 等
    scripts/                   ← audit-issues-flow.mjs 等
```

`install/` は `skill sync` によって `.claude/skills/pfd-ops/install/` まで同期される。リポルートへのデプロイは採用済みリポのみ自動更新される（L3 採用済みかどうかで挙動が分岐）。

## 「採用」とは

L3 バックエンド（GitHub Issues 連携ワークフロー）を使う設定を当該リポに展開した状態。`install/` 由来のファイルがリポルートに1つ以上存在すれば「採用済み」と判定する。

未採用リポで `skill sync pfd-ops` を実行すると次のメッセージが表示される:

```
GitHub Issues バックエンド (L3) は未採用です。採用する場合は次を実行してください:
  cp -r .claude/skills/pfd-ops/install/. .
```

「L3」= GitHub Issues バックエンドプリセット、「バックエンド」= 作業項目管理の一次情報源と同期機構を指す。
