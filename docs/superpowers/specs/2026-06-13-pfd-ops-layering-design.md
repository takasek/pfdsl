# pfd-ops 層分離 設計

## 背景・問題

現 `.claude/skills/pfd-ops/SKILL.md` は2つの異質な関心を混在させている。

1. **汎用 PFD 運用プロトコル** — 着手判断・依存レビュー・進捗更新・終端監査・ワークサイクル。PFD を使う任意のリポジトリに適用できる。
2. **このリポ固有の運用バインディング** — issue バックエンドが GitHub Issues であること、`scripts/audit-issues-flow.mjs` による同期監査、`iN_` prefix / `flow:managed` ラベル規約、payoff_log への効果収集、pfdsl 品質ガイド改訂経路、ラウンド比較計測。

混在のため、このスキルを他リポへ配布できない。固有事項を剥がし、汎用層を配布可能にする。

## 層の定義

成果物を生成元/消費局面で見る既存の `ecosystem.pfdsl` の発想に沿い、運用知を4層に分ける。

### L1: 汎用・無条件（配布スキル本文に直接書ける）

PFD という概念だけから導ける手順。固有名詞ゼロ。

- 着手判断: 入力 artifact が全て done のプロセス = 着手可能。並列着手集合を status から機械的に列挙する
- 新規作業の受け入れ: 依存グラフに1チェーン追加 → 並列性・接点・合流点を確定してから着手
- 依存レビュー: 相互依存（決定が往復で形成される関係）を見つけたら分割せず統合する。判定テスト = 上流方針の合否基準を下流作業なしで書けるか（現 ADR-0004 基準3 の文言を本文に蒸留。配布先は ADR を読めない）
- 進捗更新: 完了 = 出力 artifact の status 更新、コミットと同時。done の根拠が言えなければ成果物定義を疑う
- 終端監査: 消費者を書けない成果物は作らない。新種成果物は `ecosystem.pfdsl` に producer/consumer を登録してから作る
- ワークサイクル骨格: 選択 → 実行 → 反映 → 報告。範囲規則 = 1サイクル1プロセス
- 終端ゲートの汎用項目: 出力 status 更新 / 変更した全 .pfdsl が `check` 通過 / 論理単位コミット / 変更束を PR に集約
- retro 起動条件: 設計対話が長引いた後 / ADR が数本溜まった時 / 同一 PFD に連続修正 / セッション締め際

### L2: 汎用パターン・実装スロット（形は汎用、宛先はリポが供給）

汎用スキルは「ここに従え」とディスパッチするだけで、具体を持たない。宛先は L3/L4 が `.pfdsl` 内に書く。

- **作業項目の一次情報と同期手段**: 「`plan.pfdsl` は依存構造のみ。一次情報の所在と同期手段はそのファイルの `description` と `ecosystem.pfdsl` に従え」
- **知見の振り分け**: 「実践・レビューで得た知見は記録先成果物へ振り分けよ。宛先候補 = `ecosystem.pfdsl` に登録された知識系成果物（その producer プロセスが受け皿）」
- **終端ゲートの追加項目**: 汎用項目に、リポ固有チェック（issue クローズ等）を合成する。固有項目の出所も `ecosystem.pfdsl` / 各 description

### L3: バックエンド・プリセット（汎用ではないがベストプラクティスとして配布可能）

「PFD の作業項目を GitHub Issues で管理する」流儀。pfdsl 固有ではなく、採用したいリポが選べる再利用可能パターン。pfd-ops に同梱し、採用リポだけが参照する。

- issue が一次情報、`plan.pfdsl` は依存構造のみ
- `iN_` prefix（N = issue 番号）/ `flow:managed`・`flow:exempt` ラベル
- close 時の降格規則（終端はチェーンごと削除、下流入力が残るものは prefix を外し一般 done artifact へ）
- `audit-issues-flow.mjs` による同期監査（`--fix` 機械修復、ラベル・updatedAt・priority 突合）
- 採用手順: スクリプト設置、ラベル作成、`plan.pfdsl` への規約 description 記載

### L4: このリポ純粋固有（配布対象外。pfdsl 開発リポだから存在）

- payoff_log: PFD の効果を収集する動機ごと固有（pfdsl の効果実証が目的）
- pfdsl 品質ガイド改訂経路: このリポが pfdsl スキルの上流だから成立
- ADR 改訂規約 / review-prompts.md
- 学習ループのラウンド比較・残存ミスの lint 要件送り（ツールチェーン開発固有）
- implementation_flow ロードマップ

L4 のホストは既存の `ecosystem.pfdsl` と各運用ファイルの `description`。新規ファイルは作らない（`plan.pfdsl` が既にこのパターンを実証）。

## 配布物の構造

```
.claude/skills/pfd-ops/          ← 原本（このリポで開発・dogfood）
  SKILL.md                       ← L1 + L2 のみ。固有名詞ゼロ
  references/
    github-issues-backend.md     ← L3 プリセット規約と採用手順
  scripts/
    audit-issues-flow.mjs        ← L3 同梱
    lib/
      issues-flow-audit.mjs
      yaml-require.mjs
```

スクリプトは現在 `scripts/audit-issues-flow.mjs` + `scripts/lib/`（`issues-flow-audit.mjs`, `yaml-require.mjs`, テスト）にある。原本の置き場（リポ `scripts/` 残置 + 配布時コピー vs スキル `scripts/` へ移動）は実装計画で lib 依存とテスト配置を見て決める。このリポ内パス参照（plan.pfdsl description など）への影響も同時に判断する。

## このリポの移行

1. SKILL.md を L1+L2 に縮約。消える固有事項を L4 ホストへ移転:
   - payoff_log 追記条件 → 既に `payoff_log` artifact description にあり。重複を排し description へ寄せる
   - 品質ガイド改訂経路 → `skill_template` artifact / `maintain_template` process description
   - ラウンド比較・lint 要件送り → 該当 ADR/artifact description（実装計画で適切な居場所を特定）
   - 終端ゲートの issue 固有項目 → L3 reference へ
2. L3 規約を `references/github-issues-backend.md` に新設。現 SKILL.md と `plan.pfdsl` description の issue 規約をここへ集約
3. `plan.pfdsl` description: 現状の自己記述を維持しつつ、規約本体は L3 reference 参照に薄化可（実装計画で判断）
4. `ecosystem.pfdsl` の `ops_skill` description を層構造を反映して更新
5. このリポは L3 採用リポ第1号として dogfood する

## pfd-cycle / pfd-retro コマンド

薄ラッパーのまま。骨格は SKILL.md L1 に居住し、コマンドはそれを起動するだけ。変更は SKILL.md 参照先の追従のみ。

## 検証

- 思考実験: 「GitHub Issue を使わず plan.pfdsl だけで運用する架空リポ」が SKILL.md だけで1サイクル回せるか（L3 非依存の確認）
- このリポで実際に1サイクル（/pfd-cycle）を回し、L1+L2+L3 reference の合成で従来と同等に運用できるか
- 変更した全 .pfdsl が `check` を通過
- audit-issues-flow.mjs のテストが移動後も通る

## スコープ外

- 配布メカニズム自体（gen-skill 系での他リポ配布フロー）は本設計に含めない。pfd-ops を配布可能な形に整えるところまで
- L3 以外のバックエンドプリセット（Jira 等）は作らない（YAGNI）
