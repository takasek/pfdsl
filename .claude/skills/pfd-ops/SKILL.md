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

記法・品質ガイドは pfdsl スキル。本スキルは汎用運用プロトコル。リポ固有のバインディングは各 `.pfdsl` の sibling `.md` companion・`.pfdsl/bindings/<スキル名>.md`・references に置く。

## PFDファイルの種別（ADR-0017）

種別は「このPFDが答える問い」で区別する。
種別の定義表・問診リスト・迷ったときの判定基準・1種別1ファイル原則は **pfd-ecosystem スキルが一次情報** — 新しい PFD ファイルの追加・種別の見直しが必要になったら pfd-ecosystem を参照する。

**外部ステークホルダーの表現:** 外部提出先・最終消費者など「変換グラフの参加者でない外部の読み手」は artifact / process の `externalStakeholders` フィールドに列挙する。変換グラフの出力ノードとして組織を artifact 扱いしなくてよい。`owner`（内部責任者）と対称のフィールド。

組織境界をまたぐ引き継ぎは独立種別にしない。workflow か runtime-pipeline に吸収し、組織境界は `owner` フィールドで表現する。

## 運用ファイルの所在（L2 ディスパッチ）

このスキルは固有名詞を持たない。運用対象と手段は次の規約で解決する:

- 各運用 `.pfdsl` ファイルには、同名 sibling の Markdown companion が任意で対になる。`<file>.pfdsl` を扱うときは sibling `<file>.md` も読んで従う
- **作業項目の一次情報と同期手段**: `.pfdsl/roadmap.pfdsl` とその sibling `.pfdsl/roadmap.md` に従う
- **知見の振り分け先・運用手続き**: `.pfdsl/workflow.pfdsl` の知識系成果物と、その sibling companion `.md`
- **変換境界の定義と変更手続き**: `.pfdsl/runtime-pipeline.pfdsl`（採用時）とその sibling companion `.md`
- **issue バックエンド規約**: companion が指す references（例: `references/github-issues-backend.md`）
- **Claude 向け指示の置き場**: pfd-ops 運用に紐づく恒常指示（PR 本文規約等）は `.pfdsl/bindings/pfd-ops.md` が存在すれば読んで従う（命名規則は `references/architecture.md` 参照）。ファイルが無ければ該当なしとみなす。サイクル外でも常時届けたい指示は、root `CLAUDE.md` から当該ファイルへポインタを張ることを推奨する。project CLAUDE.md は当該リポ固有の非配布設定のみ、global CLAUDE.md は全リポ横断設定のみ
- **companion への書き分けルール**（どの companion に何を書くか）: `references/architecture.md` の「companion への書き分けルール」表が一次情報

## 運用プロトコル

1. **着手判断**: 入力 artifact が全て done のプロセス = 着手可能。並列着手集合は status から機械的に導出する（優先順位の議論より先にまず列挙）
2. **新規作業の受け入れ**: 作業項目を起票（手段は roadmap.md）。その作業が**成果物を生み他作業の着手をゲートするものだけ**依存グラフに1チェーン追加する（他作業をゲートしない保守・基盤・修正 — バグ修正・CI/ビルド/tooling・図や doc の bookkeeping 等 — は roadmap に載せない。ラベル運用などバックエンド固有の判定手続きは採用バックエンドの L3 reference に従う）→ 並列性・接点・合流点を確定させてから着手する
3. **依存レビュー**: 「並列でいける」という直感は図に書いて初めてレビュー可能になる。決定が往復で形成される相互依存が見つかったら分割せず統合する。判定テスト: 上流方針の合否基準を下流作業なしで書けるか（書けなければ上流方針は入力でなく出力 = 相互依存の証拠）
4. **進捗更新**: 着手時に出力 artifact を todo→wip に更新する（着手と同時。PR 作成・マージを待たない）。作業完了 = 出力 artifact の status 更新。コミットと同時に行う。done の根拠が言えない場合は出力成果物の定義を疑う
5. **成果物の門番（双方向、ADR-0018）**: 終端監査は両向きに行う
   - **(a) 消費者側**: 消費者を書けない成果物は作らない
   - **(b) 後続側**: 終端を名乗れるのは真の納品物（公開物・外部提出物・運用される成果物）のみ。**手段成果物（仕様・設計・計画・提案）は終端たりえない**。それを出力・計画した時点で、消費する後続プロセスをプレースホルダ（todo）でもグラフに登録する。明らかに必要な後続が欠けた終端 artifact は門番違反（例: `spec_vN` に実装プロセスが繋がっていない）
   - 新しい種類の成果物は `.pfdsl/workflow.pfdsl` に producer・consumer を登録してから作る（外部消費者は `externalStakeholders` フィールドで明示）
   - 変換コンポーネントを追加・変更・削除する場合は、その変換を実際にモデル化している採用済み PFD の description・criteria・edge を更新する。「runtime-pipeline.pfdsl が存在しない = 該当なし」と即断しない — 別の PFD（多くの場合 `.pfdsl/workflow.pfdsl` の該当ノード・エッジ）が同じ変換を表現していないか確認してから N/A と記録する
6. **知見の振り分け**: 実践・レビューで得た知見を記録先成果物へ振り分ける。**構造的事実**（新しいエッジ・成果物の生成方式が変わった等、図に描ける変化）は対応する `.pfdsl` 本体のノード・エッジ・description・criteria を更新する。**手続き散文**（グラフで運べない運用ルール・振り分け手続き自体）は sibling companion `.md` に書く。両方に該当する変更（新成果物の追加等）は両方を更新する
7. **定期監査**: `/pfd-cycle` コマンド経由では毎サイクル終了後に pfd-retro が自動実行される。直接 pfd-ops を呼んだ場合は、**前回 retro の実行記録**（`.pfdsl/bindings/pfd-retro.md` の「retro 実行記録」ログ末尾の最新1行。記録が無ければ「未実行」とみなす。当該ファイル自体が無いリポでは /pfd-cycle 経由の自動実行を基準点とする）を基準点に、次のいずれかで手動起動する — 前回以降に新規の設計決定記録（ADR 等。所在は `.pfdsl/bindings/pfd-retro.md` が指す。設計決定記録を運用しないリポでは本条件は対象外）が2本以上 / 前回以降に同一 PFD へ修正コミットが3回以上 / 設計対話が長く続いた後 / セッションの締め際。閾値は `git log --oneline --since=<前回記録の日付> -- <設計決定記録の置き場 / 当該 .pfdsl>` で機械的に数える。ユーザーの気付きを待たない。findings はプロトコル6の経路で振り分ける

## ワークサイクル（/pfd-cycle の手順）

コンテキストのないセッションでも1サイクル回せる自己完結手順（`.pfdsl/` 配下の各ファイルと sibling companion を読めば動ける）。範囲規則: **1サイクル = 1プロセス**。大きすぎる場合は粒度ルールで分割を `.pfdsl/roadmap.pfdsl` に反映してから着手する。PFD の読み書きが生じたら `pfdsl` スキルを invoke する。

1. **選択**:
   - **companion（roadmap.md 等）がサイクル・プリフライトの集約スクリプトを指す場合**、それを実行し出力（fetch 実施有無・base への遅れ・自動生成 PR の open 有無・着手可能プロセス一覧・best 推薦）に従う。指していない場合は以下を手動で行う:
     - まず `git fetch origin` でリモートの最新状態を取得する（サイクル開始時の判断はすべて origin の現状を前提にする）。新規ブランチは `origin/<base>` を起点に作成する — fetch は remote-tracking ref のみ更新し local ブランチは更新しないため、local 経由で切ると stale なまま気づかず作業してしまう
     - **既存ブランチ（前セッションから継続する worktree 等）で作業を再開する場合**、`git log --oneline HEAD..origin/<base>` で base が先行していないか確認し、先行していれば rebase してから続行する。stale なまま進めると無関係な PR diff（他 PR で先行 merge された変更の revert に見える差分）が混入する
     - **CI やツールが自動生成した PR が open のままであれば、新規作業より先にマージを確認する** — open のまま作業を始めると選択判断が stale な状態に基づく（どのような PR が自動生成されるかはリポ固有 — companion の roadmap.md に記載する）
     - `.pfdsl/roadmap.pfdsl` の着手可能プロセスを列挙する。`npx @pfdsl/cli ready <roadmap.pfdsl> --best --json` で、入力 artifact が全て done のプロセス一覧と `--best` 推薦（合流点を解放するもの＝後続プロセスの最後の未完入力になっているもの）が JSON で得られる
   - ユーザー指定があればそれを、なければ `best` の推薦を優先して1つ選ぶ。**ユーザー指定で入力 artifact が done でないプロセスを選んだ場合、「前提条件未達で着手する」とその理由を記録してから実行する**
   - 選択後、そのプロセスの issue 本文（一次情報）を読む。「design TBD」「設計未確定」等の設計未合意フレーズ、または複数の実装方針案が列挙されており選択が明記されていない場合は、実装に進まず設計対話を行って方針を確定させる
2. **実行**: 作業項目の一次情報は roadmap.md が指すバックエンド。ブランチを切って作業する（main 直コミットしない）。`.pfdsl/runtime-pipeline.pfdsl` が存在する場合は着手前に変換境界を確認し、実装スコープが境界を越えないか確かめる。PFD の読み書きは pfdsl スキルの品質ガイドに従う。ビルド・生成・全量 check 系のコマンドは出力が数百行に及ぶことがある — 結果確認は `git status --short <対象パス>` / `git diff --stat` で変更有無を先に見る（詳細ログが要る場合のみファイルにリダイレクトして絞る）。**GUI・エディタ拡張等の UI 変更は、ビルド後にユーザーと実際に操作して動作確認する。verify が BLOCKED になった場合も「確認手順をユーザーに渡す」で終わらず、ユーザーの確認結果を受け取るまで完了とみなさない。**
3. **反映 — 終端ゲート（全項目を明示的に確認。「該当なし」も判断として記録）**:
   - **companion がゲート集約チェッカーを指す場合**、まずそれを実行する。PASS/FAIL 判定が出た項目はその結果に従い、`MANUAL:` 表示・チェッカーが存在しない項目のみ以下を個別に確認する
   - [ ] companion（roadmap.md 等）が定義するリポ固有の追加ゲート項目を確認した（**タイミング規約があれば以降の項目より優先**）
   - [ ] 出力 artifact の status を更新した（タイミングは companion の規約が最優先。無ければプロトコル4のデフォルト — 着手時に wip・完了コミットと同時に done）
   - [ ] 知見を `.pfdsl/workflow.pfdsl` の sibling companion の振り分け手続きに従って振り分けた
   - [ ] 実行中に発見した新プロセス・成果物を `.pfdsl/roadmap.pfdsl` に追記した（消費者を明示できないものは作らない）
   - [ ] `check --audit` で終端 artifact 一覧を取得し、今サイクルの出力 artifact が手段（仕様・設計・計画・提案）なら、それを消費する後続プロセスがグラフに在るか確認した。無ければ todo プレースホルダで登録した（後続門番、プロトコル5(b)。真の納品物のみ終端を許す。グラフの手動走査より --audit の2行出力が安い）
   - [ ] 変換コンポーネントを追加・変更・削除した場合、それをモデル化している採用済み PFD（`.pfdsl/runtime-pipeline.pfdsl` または `.pfdsl/workflow.pfdsl` の該当箇所）に反映した（該当なしも明示。runtime-pipeline.pfdsl 未採用は自動的に N/A にならない — workflow.pfdsl 側を確認）
   - [ ] 作業中に偶発的に見つけたスコープ外の既存問題（バグ等）を起票した（ユーザーの指摘を待たない）
   - [ ] 変更した全 .pfdsl が `check` を通過する
   - [ ] コミット規約（粒度・メッセージ形式）に従ってコミットした（規約は CLAUDE.md または companion で定義する）
   - [ ] `/simplify` または `/code-review` を実施した（実装規模・品質基準は companion で定義。省略する場合はその理由を明示）
   - [ ] 変更束を PR にまとめた
4. **報告**: 完了したプロセス、それにより解放された後続プロセス、更新後の着手可能集合

## References

- 各運用 `.pfdsl` の sibling `.md` companion — リポ固有のバインディングと手続き
- `references/architecture.md` — スキルの層構成（L1〜L4・install/ の役割・採用とは何か）の説明
- `references/github-issues-backend.md` — GitHub Issues バックエンドのプリセット規約（採用リポのみ）
