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

## PFDファイルの種別（ADR-0017）

種別は「このPFDが答える問い」で区別する。プロジェクト開始時に問診リストを参照して必要な種別を選ぶ。

| 種別 | 答える問い | statusを使うか |
|---|---|---|
| **roadmap** | 何を何の前に作る必要があるか。今着手できる作業はどれか | 使う（todo→wip→done） |
| **workflow** | この作業はどう繰り返されるか。誰が何をトリガーに何を行うか | 通常書かない |
| **runtime-pipeline** | システムが動くとき、データは何に変換されるか。変換の境界はどこか | 通常書かない |

**問診リスト（YesならそのぶんPFDを作る）:**

- 実装すべき作業に依存関係があり、着手順を管理したいか？ → **roadmap**
- 定常的に繰り返す作業サイクルがあるか？ → **workflow**
- システムがデータを受け取り変換して出力するパイプラインがあるか？ → **runtime-pipeline**

workflow か runtime-pipeline か迷ったら: 人・チームの判断やトリガーが主役 → workflow / データの変換経路が主役 → runtime-pipeline。同一ドメインに両方存在してよい。

**1種別1ファイルを原則とする。** 同一種別内の細分はgroupで行う。同一種別を複数ファイルに分ける動機（読み手が完全に別・ファイルが実用上の限界を超えるなど）がない限り分割しない。

**外部ステークホルダーの表現:** 外部提出先・最終消費者など「変換グラフの参加者でない外部の読み手」は artifact / process の `externalStakeholders` フィールドに列挙する。変換グラフの出力ノードとして組織を artifact 扱いしなくてよい。`owner`（内部責任者）と対称のフィールド。

組織境界をまたぐ引き継ぎは独立種別にしない。workflow か runtime-pipeline に吸収し、組織境界は `owner` フィールドで表現する。

## 運用ファイルの所在（L2 ディスパッチ）

このスキルは固有名詞を持たない。運用対象と手段は次の規約で解決する:

- 各運用 `.pfdsl` ファイルには、同名 sibling の Markdown companion が任意で対になる。`<file>.pfdsl` を扱うときは sibling `<file>.md` も読んで従う
- **作業項目の一次情報と同期手段**: `.pfdsl/roadmap.pfdsl` とその sibling `.pfdsl/roadmap.md` に従う
- **知見の振り分け先・運用手続き**: `.pfdsl/workflow.pfdsl` の知識系成果物と、その sibling companion `.md`
- **issue バックエンド規約**: companion が指す references（例: `references/github-issues-backend.md`）
- **Claude 向け指示の置き場**: 配布スキルに同梱すべき規約（PR 本文規約等）は `references/` に置く。project CLAUDE.md は採用リポ固有の非配布設定のみ、global CLAUDE.md は全リポ横断設定のみ。「採用リポの Claude にも届けたい」指示は references/ へ
- **companion への書き分けルール**（どの companion に何を書くか）: `references/architecture.md` の「companion への書き分けルール」表が一次情報

## 運用プロトコル

1. **着手判断**: 入力 artifact が全て done のプロセス = 着手可能。並列着手集合は status から機械的に導出する（優先順位の議論より先にまず列挙）
2. **新規作業の受け入れ**: 作業項目を起票（手段は roadmap.md）。その作業が**成果物を生み他作業の着手をゲートするものだけ**依存グラフに1チェーン追加する（他作業をゲートしない保守・基盤・修正 — バグ/hotfix・CI/ビルド/hook/tooling・図や doc の bookkeeping — は roadmap に載せない）→ 並列性・接点・合流点を確定させてから着手する
3. **依存レビュー**: 「並列でいける」という直感は図に書いて初めてレビュー可能になる。決定が往復で形成される相互依存が見つかったら分割せず統合する。判定テスト: 上流方針の合否基準を下流作業なしで書けるか（書けなければ上流方針は入力でなく出力 = 相互依存の証拠）
4. **進捗更新**: 作業完了 = 出力 artifact の status 更新。コミットと同時に行う。done の根拠が言えない場合は出力成果物の定義を疑う
5. **成果物の門番（双方向）**: 終端監査は両向きに行う。**(a) 消費者側** — 消費者を書けない成果物は作らない。**(b) 後続側** — 終端を名乗れるのは真の納品物（公開物・外部提出物・運用される成果物）のみ。**手段成果物（仕様・設計・計画・提案）は終端たりえない**。それを出力・計画した時点で、消費する後続プロセスをプレースホルダ（todo）でもグラフに登録する。明らかに必要な後続が欠けた終端 artifact は門番違反（例: `spec_vN` に実装プロセスが繋がっていない）。新しい種類の成果物は `.pfdsl/workflow.pfdsl` に producer・consumer を登録してから作る（外部消費者は `externalStakeholders` フィールドで明示）。変換コンポーネントを追加・変更・削除する場合は `.pfdsl/runtime-pipeline.pfdsl` にも反映する。根拠は ADR-0018
6. **知見の振り分け**: 実践・レビューで得た知見を記録先成果物へ振り分ける。宛先候補は `.pfdsl/workflow.pfdsl` の知識系成果物、振り分け手続きは sibling companion `.md`
7. **定期監査**: `/pfd-cycle` コマンド経由では毎サイクル終了後に pfd-retro が自動実行される。直接 pfd-ops を呼んだ場合は次のいずれかで手動起動する — 設計対話が長く続いた後 / ADR が数本たまった時 / 同一 PFD に連続修正が入った時 / セッションの締め際。ユーザーの気付きを待たない。findings はプロトコル6の経路で振り分ける

## ワークサイクル（/pfd-cycle の手順）

コンテキストのないセッションでも1サイクル回せる自己完結手順（`.pfdsl/` 配下の各ファイルと sibling companion を読めば動ける）。範囲規則: **1サイクル = 1プロセス**。大きすぎる場合は粒度ルールで分割を `.pfdsl/roadmap.pfdsl` に反映してから着手する。PFD の読み書きが生じたら `pfdsl` スキルを invoke する。

1. **選択**: まず `git fetch origin` でリモートの最新状態を取得する（サイクル開始時の判断はすべて origin の現状を前提にする）。**CI やツールが自動生成した PR が open のままであれば、新規作業より先にマージを確認する** — open のまま作業を始めると選択判断が stale な状態に基づく（どのような PR が自動生成されるかはリポ固有 — companion の roadmap.md に記載する）。次に `.pfdsl/roadmap.pfdsl` から、入力 artifact が全て done のプロセスを列挙。ユーザー指定があればそれを、なければ合流点を解放するもの（後続プロセスの最後の未完入力になっているもの）を優先して1つ選ぶ。**ユーザー指定で入力 artifact が done でないプロセスを選んだ場合、「前提条件未達で着手する」とその理由を記録してから実行する。**選択後、そのプロセスの issue 本文（一次情報）を読み、「design TBD」「設計未確定」等の設計未合意フレーズ、または複数の実装方針案が列挙されており選択が明記されていない場合は、実装に進まず設計対話を行って方針を確定させる。
2. **実行**: 作業項目の一次情報は roadmap.md が指すバックエンド。ブランチを切って作業する（main 直コミットしない）。`.pfdsl/runtime-pipeline.pfdsl` が存在する場合は着手前に変換境界を確認し、実装スコープが境界を越えないか確かめる。PFD の読み書きは pfdsl スキルの品質ガイドに従う。まとまった執筆・実装は subagent に委譲し、本体は指示と評価に専念する。**GUI・エディタ拡張等の UI 変更は、ビルド後にユーザーと実際に操作して動作確認する。verify が BLOCKED になった場合も「確認手順をユーザーに渡す」で終わらず、ユーザーの確認結果を受け取るまで完了とみなさない。**
3. **反映 — 終端ゲート（全項目を明示的に確認。「該当なし」も判断として記録）**:
   - [ ] companion（roadmap.md 等）が定義するリポ固有の追加ゲート項目を確認した（**タイミング規約があれば以降の項目より優先**）
   - [ ] 出力 artifact の status を更新した（タイミングは companion の規約に従う。companion に規約がない場合は references/ 等の L3相当層で定義する）
   - [ ] 知見を `.pfdsl/workflow.pfdsl` の sibling companion の振り分け手続きに従って振り分けた
   - [ ] 実行中に発見した新プロセス・成果物を `.pfdsl/roadmap.pfdsl` に追記した（消費者を明示できないものは作らない）
   - [ ] 今サイクルの出力 artifact が手段（仕様・設計・計画・提案）なら、それを消費する後続プロセスがグラフに在るか確認した。無ければ todo プレースホルダで登録した（後続門番、プロトコル5(b)。真の納品物のみ終端を許す）
   - [ ] 変換コンポーネントを追加・変更・削除した場合、`.pfdsl/runtime-pipeline.pfdsl` に反映した（該当なしも明示）
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
