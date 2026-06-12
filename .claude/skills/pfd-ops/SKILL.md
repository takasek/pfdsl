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

- `.pfdsl/plan.pfdsl` — オープン issue の依存グラフ（issue が一次情報、図は依存構造のみ。同期規約と監査は `scripts/audit-issues-flow.mjs` — ファイル冒頭 description 参照）
- `docs/pfdsl_implementation_flow.pfdsl` — ツールチェーン実装ロードマップ
- `.pfdsl/ecosystem.pfdsl` — リポジトリ成果物の生成元と利用局面
- `docs/adr/` — 方法論の設計決定記録（改訂規約は同ディレクトリ README）
- `docs/pfd_payoff_log.md` — PFD が効いた局面の事例ログ
- `docs/review-prompts.md` — PFD を問い詰める A/B 監査カタログ（一次情報）

## 運用プロトコル

1. **着手判断**: 入力 artifact が全て done のプロセス = 着手可能。並列着手集合は status から機械的に導出する（優先順位の議論より先にまず列挙）
2. **新規作業の受け入れ**: issue 起票 → 依存グラフに1チェーン追加 → 並列性（どの作業と同列か）・接点（どこと干渉するか）・合流点（どこで統合されるか）を確定させてから着手する
3. **依存レビュー**: 「並列でいける」という直感は図に書いて初めてレビュー可能になる。決定が往復で形成される相互依存が見つかったら分割せず統合（ADR-0004 基準3。判定テスト: 上流方針の合否基準を下流作業なしで書けるか）
4. **進捗更新**: 作業完了 = 出力 artifact の status 更新。コミットと同時に行う。done の根拠が言えない場合は出力成果物の定義を疑う
5. **成果物の門番**: 消費者を書けない成果物は作らない（終端監査の運用適用）。新しい種類の成果物は `.pfdsl/ecosystem.pfdsl` に producer・consumer・利用局面を登録してから作る
6. **知見の振り分け**: 実践・レビューで得た知見は3経路に振り分ける — 即時ルール化（pfdsl スキルの品質ガイド改訂）/ 設計決定（ADR）/ 作業項目（issue + 依存グラフ更新）。PFD の効果を体感した局面は payoff_log に日付・局面・効果・参照で追記
7. **学習ループ**: 実践→レビュー→ガイド改訂→再実践。ラウンド比較で「ルールで消えたミス / 残ったミス」を分離計測し、残ったものは lint 要件（ツール側）へ送る（ADR-0006）
8. **定期監査**: 次のいずれかで pfd-retro を起動する — 設計対話が長く続いた後 / ADR が数本たまった時 / 同一 PFD に連続修正が入った時 / セッションの締め際。ユーザーの気付きを待たない。findings は本プロトコル6の経路で振り分ける

## ワークサイクル（/pfd-cycle の手順）

コンテキストのないセッションでも1サイクル回せる自己完結手順。範囲規則: **1サイクル = 1プロセス**。大きすぎる場合は粒度ルールで分割を計画 PFD に反映してから着手する。

1. **選択**: `.pfdsl/plan.pfdsl` と `docs/pfdsl_implementation_flow.pfdsl` から入力 artifact が全て done のプロセスを列挙。ユーザー指定があればそれを、なければ合流点を解放するもの（後続プロセスの最後の未完入力になっているもの）を優先して1つ選ぶ
2. **実行**: 対応する GitHub issue が一次情報。ブランチを切って作業する（main 直コミットしない — 生態系図の develop→PR→merge が正規経路）。PFD の読み書きは pfdsl スキルの品質ガイドに従う。まとまった執筆・実装は subagent に委譲し、本体は指示と評価に専念する
3. **反映 — 終端ゲート（全項目を明示的に確認。「該当なし」も判断として記録）**:
   - [ ] 出力 artifact の status を更新した（plan.pfdsl / implementation_flow）
   - [ ] 完了した issue をクローズし、進捗・新発見を issue に反映した
   - [ ] 知見を3経路に振り分けた（品質ガイド改訂 / ADR / 新 issue + 依存チェーン追加）。ADR 化した判断は適用ルールのガイド蒸留要否も判定した
   - [ ] PFD が効いた局面があれば `docs/pfd_payoff_log.md` に追記した
   - [ ] 実行中に発見した新プロセス・成果物を計画 PFD に追記した（消費者を明示できないものは作らない）
   - [ ] 変更した全 .pfdsl が `check` を通過する
   - [ ] 論理単位でコミットした
   - [ ] 変更束を PR にまとめた（マージで成果物・進捗・issue 更新が正本になる）
4. **報告**: 完了したプロセス、それにより解放された後続プロセス、更新後の着手可能集合

## References

- `docs/adr/` — 各プロトコルの根拠（特に 0004 粒度、0006 二層構造）
- `docs/pfd_payoff_log.md` — プロトコルが効いた実例
