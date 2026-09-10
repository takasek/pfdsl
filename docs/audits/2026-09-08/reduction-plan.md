# 監査時点の削減方針（2026-09-08）

> アーカイブ注記（2026-09-10）: この文書は固定コミット `827bcb1cb96238f918dad84dc6453176f131e029` を対象にした当時の監査記録であり、現行の不具合一覧や実装計画ではない。
> 最新の対応状況と残件は [#1055](https://github.com/takasek/pfdsl/issues/1055)、CLI 0.0.26 の公開完了記録は [#1138](https://github.com/takasek/pfdsl/issues/1138) を参照する。
> 観測・評価・提案は当時の内容を保持し、個人環境を含むパス表記は公開用の例示パスへ置換した。
> Markdown リンクは、このアーカイブ内の相対参照または監査対象コミットへの固定参照へ置き換えた。

対象は監査した `827bcb1cb96238f918dad84dc6453176f131e029`。
目的は、必要な成果物の品質を保ちながら、実質を保証しない強制・二重管理・重複実行を取り除くこと。
各機構を維持する前提で書いた初回監査の改善案を、この表で見直す。
製品コードはまだ変更していない。

## 最初に実装する削減単位

| 順 | 判断・対象 | 一緒に削るもの | 残すもの・失うもの | 受入条件 |
|---|---|---|---|---|
| 1 | 撤去: criteria の語句による合否判定（G5 の一部） | [判定 module](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/criteria-judgeability.mjs)、entrypoint、専用テスト、Makefile 呼出し、特定 accessor を必須にする規約 | 再確認可能な完了基準と実コマンドの検証を残す。latest-only の特定表記を自動で注意する効果は失う | version 固定 query を書いたことで停止しない。PFD の構文・参照検査と実際の公開物の確認は残る。代替の文章 parser や常時 warning を新設しない |
| 2 | 撤去: snapshot の重複再生成（G4） | [pre-commit の snapshot gate](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/drift-gates.mjs#L59)、terminal と CI の重複 `-u`、目的を失った [repo-local hook](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/flow-sync-local-hook.mjs)、その専用期待値・説明 | 通常 core test の snapshot assertion と明示的な snapshot 更新を残す。通常 test を省略した場合の補助検出は失う | 通常 test が snapshot 不一致で失敗することを保つ。operational PFD 編集だけで snapshot 更新や依存入替を起動しない。通常の PFD check/fmt は残る |
| 3 | 役割縮小: サイズは測定・表示だけにする | [size verdict](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/gate-check.mjs#L1764)、専用 step、`Size-Intent`/`Size-Override` の要求・解析・専用期待値 | 既存の byte/line 差分表示を残す。増加時の強制停止は失う。共有 trailer parser は他の利用先がある限り残す | 総量減・一部ファイル増で停止しない。サイズ表示は宣言なしでも出る。利用者が具体的な上限を明示した場合の検証は別途その依頼に従う |

3件は別々の論理単位にする。
汎用の採用先 hook 拡張点、size 以外にも使う issue 取得・判定経路、共有 trailer parser は残す。
削除を理由に通常の全件検証を重ねず、各変更で残す保証と、最後に統合した差分を検証する。
P1 の製品不具合を長期間放置する一括整理にはせず、C1 の整形破損・D1 の排他不備は独立した修正として進められるようにする。

## 次に責務を縮める単位

| 対象 | 方針と削減範囲 | 維持する保証・注意点 |
|---|---|---|
| issue metadata と登録ゲート（G2、追加の同期不可能例） | process の `updated_at` 必須保存・等値判定・修復を撤去。priority の完全一致も登録の合否から外す。登録ゲートは当該 issue の登録義務だけ確認する | issue 対応、成果物の status、入出力依存を保持する。priority を任意の表示値として残すかは表示利用先を確認して決める。closed 処理が tracking fields の有無を使うため、フィールドだけの単独削除はしない |
| close 時の pruning（G1） | close イベントのグラフ書換え・全体 `--fix`・正規化・修復 PR を外し、必要な整理を既存のサイクル終了時にまとめる。閉鎖済みというだけの finding は非 blocking にする | 未完了作業の依存と ready/blocked 全出力を保存する。候補表示を残す場合も誤判定の可能性を引き継ぐ。整理を忘れるリスクは増えるが、それを新しい常時監視や同量の手動チェックで埋めない |
| retro の command 検出 hook（G6） | Bash command の推測 hook、配線、専用テスト、重複保持の説明を撤去する | `/pfd-cycle` の終了時 retrospective を残す。直接 commit した利用者への自動 reminder は失う。共有 hooks 配線や別の managed-issue reminder は残す |
| Review trailer の必須ゲート | [review record](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/review-record.mjs) の必須判定、tool 名列挙、専用 CI、terminal verdict、記録方法の制約を外す | 実際のレビューと対象・結論の報告は残す。記録忘れを自動停止する機能は失う。CI を削る場合は hosted required-check 設定との整合確認が必要で、設定そのものは今回未確認 |
| Format 3 と時系列ゲート | 詳細形式を重要な方式選択のテンプレートへ縮小する。形式・節順序・語彙・編集時刻を理由に通常作業を止める制約を外し、書式訂正で着手を無効化しない | ユーザーが明示した承認待機点、決定理由、重要な代案比較は保持する。構造的な記入漏れと時刻逆転の自動検出は失う。旧記録を書き換えず、既存の判断の参照先として残す |

## 維持して修正する対象

C1（整形の意味保持）、C2（複数ファイル検査の範囲）、C3（YAML shape）、C4（継承解決）、R1〜R3（差分・リンク・表示の現在性）、D1/D2（生成の排他・配布 baseline）、G3（実入力と build freshness）は、必要な製品機能の保証を担う。
既存 parser/CST の再利用や責務統合で小さくできる余地はあるが、機能を撤去して問題を消す対象にはしない。
G5 の shell 実行防止は構造的な検査として残し、検出範囲と成功表示を一致させる。
Review trailer の撤去は、配布物のレビュー対象が現在の出力と一致するかを調べる distribution-review の検査まで含めない。
PFD の成果物依存、通常 test/typecheck、参照整合、生成元と配布物の一致、外部操作の承認境界も維持する。

## 削減の確認方法

削除後に「同じ義務を人が毎回確認する」「全部 warning にする」「新しい判定器を置く」という置換をしない。
消した実施義務・強制分岐・手動記録欄と、残った保証を確認する。
行数・byte 数は補助指標であり、短文化だけを成功としない。
正本、呼出し、固有テスト、現役の規約、生成された配布物を同じ変更単位で揃える。
履歴・過去の判断記録を単純検索で削除しない。

追加の [実測結果](evidence/reduction-results.json) では、複数 issue の metadata 修復が交互に反転すること、総量950 bytes減でも size gate が失敗すること、自己申告1行で review gate が成功することを実 pure function で確認した。
これらは削減の判断材料であり、自己申告や形式チェックが本来宣言していない意味を保証できないことだけで実装バグと数えたものではない。
初回15所見の観測事実は元レポートに残し、この表では対応方針を変更している。
