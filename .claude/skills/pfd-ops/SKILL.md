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
- **作業項目の一次情報と同期手段**: `plan.pfdsl` とその sibling `plan.md` に従う
- **知見の振り分け先・運用手続き**: `ecosystem.pfdsl` の知識系成果物と、その sibling `ecosystem.md`
- **issue バックエンド規約**: companion が指す references（例: `references/github-issues-backend.md`）
- **Claude 向け指示の置き場**: 配布スキルに同梱すべき規約（PR 本文規約等）は `references/` に置く。project CLAUDE.md は採用リポ固有の非配布設定のみ、global CLAUDE.md は全リポ横断設定のみ。「採用リポの Claude にも届けたい」指示は references/ へ

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

1. **選択**: まず `git fetch origin` でリモートの最新状態を取得する（サイクル開始時の判断はすべて origin の現状を前提にする）。**自動生成 PR（flow-sync 等）が open のままであれば、新規作業より先にマージを確認する** — open のまま作業を始めると選択判断が stale な状態に基づく。次に運用対象の計画 PFD（`plan.pfdsl` とその他のロードマップ PFD。所在は sibling `.md` companion が定義）から、入力 artifact が全て done のプロセスを列挙。ユーザー指定があればそれを、なければ合流点を解放するもの（後続プロセスの最後の未完入力になっているもの）を優先して1つ選ぶ
2. **実行**: 作業項目の一次情報は plan.md が指すバックエンド。ブランチを切って作業する（main 直コミットしない）。PFD の読み書きは pfdsl スキルの品質ガイドに従う。まとまった執筆・実装は subagent に委譲し、本体は指示と評価に専念する
3. **反映 — 終端ゲート（全項目を明示的に確認。「該当なし」も判断として記録）**:
   - [ ] companion（plan.md 等）が定義するリポ固有の追加ゲート項目を確認した（**タイミング規約があれば以降の項目より優先**）
   - [ ] 出力 artifact の status を更新した（タイミングは companion の規約に従う — 例: マージ時）
   - [ ] 知見を ecosystem.md の振り分け手続きに従って振り分けた
   - [ ] 実行中に発見した新プロセス・成果物を計画 PFD に追記した（消費者を明示できないものは作らない）
   - [ ] 変更した全 .pfdsl が `check` を通過する
   - [ ] 論理単位でコミットした
   - [ ] 変更束を PR にまとめた
4. **報告**: 完了したプロセス、それにより解放された後続プロセス、更新後の着手可能集合

## References

- 各運用 `.pfdsl` の sibling `.md` companion — リポ固有のバインディングと手続き
- `references/github-issues-backend.md` — GitHub Issues バックエンドのプリセット規約（採用リポのみ）
