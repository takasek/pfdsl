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

記法・品質ガイドは pfdsl スキル。本スキルは運用プロトコル。

## このリポジトリの運用ファイル

- `docs/issues_flow.pfdsl` — オープン issue の依存グラフ（issue が一次情報、図は依存構造のみ）
- `docs/pfdsl_implementation_flow.pfdsl` — ツールチェーン実装ロードマップ
- `docs/artifact_ecosystem.pfdsl` — リポジトリ成果物の生成元と利用局面
- `docs/adr/` — 方法論の設計決定記録
- `docs/pfd_payoff_log.md` — PFD が効いた局面の事例ログ

## 運用プロトコル

1. **着手判断**: 入力 artifact が全て done のプロセス = 着手可能。並列着手集合は status から機械的に導出する（優先順位の議論より先にまず列挙）
2. **新規作業の受け入れ**: issue 起票 → 依存グラフに1チェーン追加 → 並列性（どの作業と同列か）・接点（どこと干渉するか）・合流点（どこで統合されるか）を確定させてから着手する
3. **依存レビュー**: 「並列でいける」という直感は図に書いて初めてレビュー可能になる。決定が往復で形成される相互依存が見つかったら分割せず統合（ADR-0004 基準3。判定テスト: 上流方針の合否基準を下流作業なしで書けるか）
4. **進捗更新**: 作業完了 = 出力 artifact の status 更新。コミットと同時に行う。done の根拠が言えない場合は出力成果物の定義を疑う
5. **成果物の門番**: 消費者を書けない成果物は作らない（終端監査の運用適用）。新しい種類の成果物は artifact_ecosystem.pfdsl に producer・consumer・利用局面を登録してから作る
6. **知見の振り分け**: 実践・レビューで得た知見は3経路に振り分ける — 即時ルール化（pfdsl スキルの品質ガイド改訂）/ 設計決定（ADR）/ 作業項目（issue + 依存グラフ更新）。PFD の効果を体感した局面は payoff_log に日付・局面・効果・参照で追記
7. **学習ループ**: 実践→レビュー→ガイド改訂→再実践。ラウンド比較で「ルールで消えたミス / 残ったミス」を分離計測し、残ったものは lint 要件（ツール側）へ送る（ADR-0006）

## References

- `docs/adr/` — 各プロトコルの根拠（特に 0004 粒度、0006 二層構造）
- `docs/pfd_payoff_log.md` — プロトコルが効いた実例
