---
name: pfd-ops
summary: project operations
description: |
  Use when operating a project with PFDs — prioritizing or accepting issues,
  updating progress status after completing work, adding new artifacts or
  documents to the repo, or deciding where session learnings should be
  recorded. Also fires when the user asks to work on a bare issue or
  work-item number (e.g. `#123`) — route it through the work cycle even if
  the item is not managed in the roadmap. Complements the pfdsl skill
  (notation and quality of .pfdsl files); this skill covers how to run the
  project on top of them.
---

# PFD-driven project operations

記法・品質ガイドは pfdsl スキル。本スキルは汎用運用プロトコル。リポ固有のバインディングは各 `.pfdsl` の sibling `.md` companion・`.pfdsl/bindings/<スキル名>.md`・references に置く。

## 前提条件

本スキルの運用プロトコルは `.pfdsl/roadmap.pfdsl` が存在し、かつ scaffold のまま（プレースホルダ未置換）でないことを前提にする。scaffold か否かは、ラベルに雛形プレースホルダの締めくくり文字列が残っているかで機械判定できる:

```bash
grep -q 'に置き換える)' .pfdsl/roadmap.pfdsl && echo "scaffold のまま"
```

カレントプロジェクトに `.pfdsl/` が無い場合、または上記コマンドが「scaffold のまま」を出す場合は、運用プロトコルを実行せず pfd-ecosystem スキル（`/pfd-init`）で PFD セットを初期構築 / 実データへ育てるようユーザーに案内してセッションを終了する。

## 配置ファイルの鮮度セルフチェック（ADR-0028）

スキル発火時に一度、`install/` 由来の配置ファイル（GitHub Actions workflow・監査スクリプト）の drift を確認する:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/pfd-ops/scripts/check-install-sync.mjs --upstream
```

CLAUDE_PLUGIN_ROOT は plugin ロード時に実パスへ置換される変数（`${CLAUDE_PLUGIN_ROOT}` の形でのみ置換対象 — この説明文中の表記のように波括弧を外せば置換されない）。上のコマンド行がパス置換されず変数名のまま見えている場合は plugin 外（repo-local）ロード — `node .claude/skills/pfd-ops/scripts/check-install-sync.mjs --upstream` を使う。**どちらも解決しない場合**（変数名のまま見えており、かつ repo-local の `.claude/skills/pfd-ops/` も存在しない）は、いま読んでいるこのファイル自身の所在を skill root とみなして相対で辿る — このファイルが読めている以上その所在は判明しており、それが3つ目の分岐になる。この状態は skill 本文をファイルとして直接読んだときに起きる（置換はプロンプトへの取り込み時に行われるため、ファイルの中身は常に変数名のまま）。
GitHub Issues バックエンド未採用のリポでは何も出ない。
**警告が出たら対応する**: drift 警告は `--deploy` で refresh する。**ローカル編集が無いファイルのコピーと、ローカル編集が無い旧ファイルの削除は、追加フラグ無しで行われる**。追加フラグが決めるのは「途中に立ちはだかるローカル編集を捨てるか」だけで、`--overwrite-local-edits` は生き残るパスの編集を canonical で潰し、`--delete-edited-orphans` は消えるパスの編集ごと削除する。したがって旧ファイルの掃除が目的ならまず素の `--deploy` を実行し、編集済みとして残ったものだけを見て後者の要否を判断する。両方の意味を兼ねる単一フラグは、捨てるつもりのなかった編集まで巻き込む。
`Possible renames` の行が出たら、それは canonical 側のリネームで新旧パスが別々に `missing` / `orphaned` として現れている状態を意味する。**新パスの配置ファイルを信用する前に、旧パスのローカル編集を新パスへ引き継ぐ**。
plugin バージョンの上流差分警告は plugin の更新をユーザーに案内する。CI 強制ではなくこのランタイムチェックだけが採用リポの安全網なので、警告を黙殺しない。

このチェックと同じタイミングで、`.pfdsl/bindings/pfd-ops.md` が存在すれば読み、そこに追加のセルフチェック手順が定義されていればそれも実行する（binding は各リポ固有の追加自己点検の一次置き場 — SKILL.md 本文は個別スクリプト名を持たない）。

## PFDファイルの種別（ADR-0017）

種別は「このPFDが答える問い」で区別する。
種別の定義表・問診リスト・迷ったときの判定基準・1種別1ファイル原則は **pfd-ecosystem スキルの `references/kind-taxonomy.md` が一次情報** — 新しい PFD ファイルの追加・種別の見直しが必要になったら参照する。

**外部ステークホルダーの表現:** 外部提出先・最終消費者など「変換グラフの参加者でない外部の読み手」は artifact / process の `externalStakeholders` フィールドに列挙する。変換グラフの出力ノードとして組織を artifact 扱いしなくてよい。`owner`（内部責任者）と対称のフィールド。

組織境界をまたぐ引き継ぎは独立種別にしない。workflow か runtime-pipeline に吸収し、組織境界は `owner` フィールドで表現する。

## 運用ファイルの所在（L2 ディスパッチ）

このスキルは固有名詞を持たない。運用対象と手段は次の規約で解決する:

- 各運用 `.pfdsl` ファイルには、同名 sibling の Markdown companion が任意で対になる。`<file>.pfdsl` を扱うときは sibling `<file>.md` も読んで従う
- **作業項目の一次情報と同期手段**: `.pfdsl/roadmap.pfdsl` とその sibling `.pfdsl/roadmap.md` に従う
- **知見の振り分け先・運用手続き**: `.pfdsl/workflow.pfdsl` の知識系成果物と、その sibling companion `.md`
- **変換境界の定義と変更手続き**: `.pfdsl/runtime-pipeline.pfdsl`（採用時）とその sibling companion `.md`
- **issue バックエンド規約**: companion が指す references（例: `references/github-issues-backend.md`）
- **Claude 向け指示の置き場**: pfd-ops 運用に紐づく恒常指示（PR 本文規約等）は `.pfdsl/bindings/pfd-ops.md` が存在すれば読んで従う（命名規則は `references/architecture.md` 参照）。ファイルが無ければ該当なしとみなす。サイクル外でも常時届けたい指示は、root `CLAUDE.md` から当該ファイルへポインタを張ることを推奨する。project CLAUDE.md はこのリポでのみ有効な設定のみ、global CLAUDE.md は全リポ横断の設定のみ
- **companion への書き分けルール**（どの companion に何を書くか）: `references/architecture.md` の「companion への書き分けルール」表が一次情報

## 運用プロトコル

1. **着手判断**: 入力 artifact が全て done のプロセス = 着手可能。並列着手集合は `pfdsl status ready <roadmap.pfdsl> --best --json` で機械的に導出する（roadmap 全文 Read で手動判定しない。優先順位の議論より先にまず列挙）。**作業項目に着手する回は、この判断を下す前に下の「ワークサイクル」節へ入り、その4手順に従う** — 着手判断はその手順1の一部であり、単独では完結しない。どの起動口から来たかは問わない
2. **新規作業の受け入れ**: 作業項目を起票（手段は roadmap.md）。その作業が**成果物を生み他作業の着手をゲートするものだけ**依存グラフに1チェーン追加する（他作業をゲートしない保守・基盤・修正 — バグ修正・CI/ビルド/tooling・図や doc の bookkeeping 等 — は roadmap に載せない。ラベル運用などバックエンド固有の判定手続きは採用バックエンドの L3 reference に従う）→ 並列性・接点・合流点を確定させてから着手する
3. **依存レビュー**: 「並列でいける」という直感は図に書いて初めてレビュー可能になる。決定が往復で形成される相互依存が見つかったら分割せず統合する。判定テスト: 上流方針の合否基準を下流作業なしで書けるか（書けなければ上流方針は入力でなく出力 = 相互依存の証拠）
4. **進捗更新**: 着手時に出力 artifact を todo→wip に更新する（着手と同時。PR 作成・マージを待たない）。作業完了 = 出力 artifact の status 更新。コミットと同時に行う。done の根拠が言えない場合は出力成果物の定義を疑う。**criteria 未達を criteria 文言の書き換えで done に帳尻合わせしない** — criteria は元の作業項目（issue 等一次情報）の完了基準を反映するものであり、達成できなかった基準を後から緩めて達成済みに見せかける行為は、成果物の定義でなく成果物の状態を偽る。未達のまま状態を進めたい場合は wip を維持し、未達部分を独立した後続作業として切り出す。**基準そのものが達成不能だと実測で判明した場合に限り差し替えてよいが、人間の承認を得てから行う** — (a) 不能の根拠を実測で示し（「やってみたら別の理由で失敗した」ではなく、その基準が原理的に満たせないことの証拠）、(b) 差し替え後の基準が元の意図を別の手段で満たすことを述べ、(c) 承認を得る。この3つを欠いた差し替えは、上の帳尻合わせと外形上まったく区別がつかない — 差し替える側は常に「これは正当な変更だ」と考えているので、区別は自己申告でなく手続きに担保させる
5. **成果物の門番（双方向、ADR-0018）**: 終端監査は両向きに行う
   - **(a) 消費者側**: 消費者を書けない成果物は作らない
   - **(b) 後続側**: 終端を名乗れるのは真の納品物（公開物・外部提出物・運用される成果物）のみ。**手段成果物（仕様・設計・計画・提案）は終端たりえない**。それを出力・計画した時点で、消費する後続プロセスをプレースホルダ（todo）でもグラフに登録する。明らかに必要な後続が欠けた終端 artifact は門番違反（例: `spec_vN` に実装プロセスが繋がっていない）。終端 artifact 一覧は `pfdsl graph io <file> --json` で機械列挙できる（全文 Read での目視に頼らない。`externalTerminals` の別枠に artifact が入る条件と見方は pfdsl スキルの「読解と点検」が一次情報 — そちらも見る。手順の詳細は `references/work-cycle.md`）
   - **版 artifact を起こす契機**（(b) の系。終端監査の第3の向きではない）: 版を表す artifact（仕様書の版・パッケージの公開版・アプリのリリース版）を計画図に置く契機は2つに限る。(1) その版が後続プロセスをゲートする（版が上がらないと着手できないプロセスが図にある）、(2) その版自体が納品物であり、管理下の実装 artifact を消費する publish プロセスの出力である。どちらにも当たらない版は、実体が公開されていても起こさない。**手段成果物の版は納品物ではないため (1) にしか該当しえない** — 版が上がったこと自体は artifact を起こす理由にならない。判定は `pfdsl status blocked` / `status ready` の実測で行う（版待ちのプロセスが実在するかを見る。「そのうち要るはず」で起こさない）。この規定の帰結として、**図の版チェーンが実体の現行版より古いことは、それ自体では欠陥ではない** — 公開された版の履歴の一次情報は図でなくレジストリ・履歴ファイル・ストアであり、`revises:` チェーンは起こした版どうしを繋ぐものなので、飛んだ版番号の存在は線形性の違反にならない。既存の図に (1)(2) どちらにも当たらない版 artifact が残っている場合、それは消費者を持たない終端の手段成果物として (b) に掛かる — 規定の遡及適用対象外として温存すると、規定を読んだ者が現物の反例に当たるたびに散文へ戻らないと解釈できなくなる
   - **版 artifact の criteria は版一覧への包含で書く**（門番の向きではなく、上項で起こすと決めた artifact の完了条件の書き方）: criteria を判定できる形で書くこと、判定手段が実際に返す値を確かめてから名指すことは pfdsl スキルの品質ガイド「criteria は判定できる形で書く」が一次情報 — ここには複製しない。版に固有なのは形のほうで、「最新版を返す手段」（`npm show <pkg> version`・ストアの表示版など）でなく版一覧を返す手段への包含（`npm view <pkg> versions に X が含まれる` の形）で書く。同じレジストリに対しても呼び方ごとに返す件数が違うため、品質ガイドが求める確認はコマンドの単位でなく呼び方の単位で行う
   - 新しい種類の成果物は `.pfdsl/workflow.pfdsl` に producer・consumer を登録してから作る（外部消費者は `externalStakeholders` フィールドで明示）。`workflow.pfdsl` を採用していない、または scaffold のまま置いてあるリポではこの登録は該当なし — 採用済みの PFD の中で消費者を明示できれば足りる。**前提条件の scaffold 判定は `roadmap.pfdsl` しか見ない**ので、roadmap だけ実データで他が雛形という状態は判定をすり抜ける。登録先を探す前に、その PFD が実データかを自分で確かめる
   - 変換コンポーネントを追加・変更・削除する場合は、その変換を実際にモデル化している採用済み PFD の description・criteria・edge を更新する。「runtime-pipeline.pfdsl が存在しない = 該当なし」と即断しない — 別の PFD（多くの場合 `.pfdsl/workflow.pfdsl` の該当ノード・エッジ）が同じ変換を表現していないか確認してから N/A と記録する
6. **知見の振り分け**: 実践・レビューで得た知見を記録先成果物へ振り分ける。**構造的事実**（新しいエッジ・成果物の生成方式が変わった等、図に描ける変化）は対応する `.pfdsl` 本体のノード・エッジ・description・criteria を更新する。**手続き散文**（グラフで運べない運用ルール・振り分け手続き自体）は sibling companion `.md` に書く。両方に該当する変更（新成果物の追加等）は両方を更新する
7. **定期監査**: `/pfd-cycle` コマンド経由のセッションには pfd-retro 起動条件が2つある。両方を独立に確認する（一方の非該当がもう一方の免除にならない）:
   - **(a) done 付与時の自動起動**: 対象プロセスの出力 artifact に done が付与された時点（プロトコル4）で pfd-retro を自動実行する。直接 pfd-ops を呼ぶ対話セッションで `/pfd-cycle` を起動していない場合、done イベントという基準点が存在しないため (a) は適用対象外
   - **(b) サイクル終結時の能動的確認**: `/pfd-cycle` を起動した対話セッションでは、結論がまとまったタイミングでユーザーに「そろそろサイクルを締めるか」を確認する（ユーザーの気付きを待たず AI から能動的に問う）。**done の有無に関わらず必須** — (a) が不成立（exempt issue 等で done 付与がない）でも (b) は免除されない。
   findings はプロトコル6の経路で振り分ける

## ワークサイクル（選択・実行・終端ゲート・報告）

作業項目に着手する回は `references/work-cycle.md` に従う（選択・実行・終端ゲート・報告の4手順）。
**この節は特定の起動口に属さない** — どの起動口から入った回も同じ4手順に従う。起動口をここで列挙しないのは、列挙に無い経路で入った実行主体が再び「自分は該当しない」と読めるためである。

## References

- 各運用 `.pfdsl` の sibling `.md` companion — リポ固有のバインディングと手続き
- `references/work-cycle.md` — ワークサイクル4手順（選択・実行・終端ゲート・報告）
- `references/architecture.md` — スキルの層構成（L1〜L4・install/ の役割・採用とは何か）の説明
- `references/github-issues-backend.md` — GitHub Issues バックエンドのプリセット規約（採用リポのみ）
- `references/file-based-tracker-backend.md` — ファイルベース・トラッカーのプリセット規約（採用リポのみ）
