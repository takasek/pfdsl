# GUI要求・担当・試験の移管記録（2026-10-14）

2026-10-14、main `6d04e85534207f653005955d6c099b7a9a9aecc7`、各Issue本文・全コメント、#1444の[画面案](https://github.com/takasek/pfdsl/issues/1444#issuecomment-6143768523)と[全採否](https://github.com/takasek/pfdsl/issues/1444#issuecomment-6145651652)を基準に整理した。
本書はこの移管時点の照合記録であり、以下の担当・実装状態・移管先はその時点を表す。
現在の対象Issue・担当・要求と試験IDの対応・公開範囲・進捗・残件は[#1445](https://github.com/takasek/pfdsl/issues/1445)とそこから参照する要求Issueが正本である。
以後のIssueの追加・分割・統合・担当変更はIssue本文に記録し、本書を現在の管理台帳として更新しない。
版に結び付く操作は[計画](ACCEPTANCE-PLAN.md)、実結果は[版別受入記録](ACCEPTANCE.md)に置く。
下表の旧条件番号は取得時の各受入チェックリストを上から数えた識別子で、製品仕様の新しい採番機構ではない。
自動欄の「実装」は実装・必要なunit/DOM/host検証・独立レビュー・計画登録を担当Issueの完了条件に残すことを表す。
実機の合格を表す印ではない。
テストIDはすべて計画の見出しで解決し、各ホストの状態は未実施から個別に記録する。

## 移管時の担当と共有APIの境界

| Issue | 担当 | 別担当・維持条件 |
| --- | --- | --- |
| #1444（flow:exempt） | 画面構成・menu・文書状態・text hover・Connections表示、候補接続、新規作成＋接続、edge削除／feedback切替 | #1284の移動・cue、#1352のFit/診断回復/案内、#1259の言語支援を吸収しない。全体完了を他機能の開始条件にしない |
| #1284 | Connectionsの直接近隣確認・移動とeditor→図の共通cue | 旧hover graph方式は仕様置換。panel構成と編集入口は#1444 |
| #1352 | Fit/100%/倍率/操作案内、error/minimap回復、作成後編集案内、clone手順、既存操作の非競合 | 配置は#1444。旧UI完成・検収を先行条件にしない |
| #1259 | 言語支援・構造編集・整形・診断・extends・preview機能同等性 | ソースeditor hoverは図hoverと別。外部実行は#1260、実出力は#1261、保存は完了済み#1258 |
| #1260 | 外部参照・Git/別file構造差分・terminal | 保存競合のtext比較は#1444/#1258であり構造差分完成を前提にしない |
| #1261 | DOT/SVG/PDF/PNG/TSV/Allと失敗／部分成功 | menu登録だけでは出力実装完了でない。公開環境は#1262 |
| #1262 | 署名公証・候補DMG・下限OS・導入更新・公開と読戻し | 機能受入のM結果は#1445。V結果をMac公開のゲートにしない |

現行の`packages/editor/src/preview-edit.ts`の要求は`createDefinition`と`addConnector`であり、hostが現在sourceとの一致を確認して一つの編集をUndo可能に適用する。
新規IDへの現行connector追加は、frontmatter初期label作成と接続を一括適用する#1444の要求と同じではない。
edge削除とinput/feedback切替の共有要求も現行message契約にない。
#1444の実装はこれらの計算・message・host適用の差分を扱う必要があり、CSS変更だけとは扱わない。
単一producer判定は統合済み#1432の共通処理を利用し、#1438の保存能力も再実装しない。
共有層をOS・VS Code・Monaco・Tauri・filesystem・保存から独立に保ち、Undo/I/O/外部起動はhostが担当する。

## #1444の全受入条件

受入条件21項目と本文の維持条件を残し、実装確認は#1444、下記の実操作は#1445へ移す。

| 旧条件 | 保持する要求 | 自動・担当 | 実機テストID |
| --- | --- | --- | --- |
| U01 | 左editor/右図、初期50:50、幅調整と状態保持 | 実装 #1444 | GUI-01 |
| U02 | Recent/Folder、両入口sidebar、作業幅回復 | 実装 #1444 | GUI-02 |
| U03 | 両hostのtext hover、追従・端・非競合 | 実装 #1444 | GUI-09 |
| U04 | 右click、近隣移動、中心更新、全体図保持 | 実装 #1444/#1284 | GUI-10、GUI-11 |
| U05 | 独立scroll、固定中心／入力、片側ゼロ | 実装 #1444 | GUI-10 |
| U06 | 常設1行、＋とline整列、可視見出し省略 | 実装 #1444 | GUI-10、GUI-25 |
| U07 | ID/label絞込み、既存／新規接続、左右と古い対象 | 実装 #1444 | GUI-12、GUI-13、GUI-14 |
| U08 | 空／既存／不正ID、重複／種別／producer拒否、部分作成なし、無関係エラー許容 | 実装 #1444、#1432利用 | GUI-13、GUI-14 |
| U09 | edge削除、input/feedback、output不可・非反転、artifact中心 | 実装 #1444 | GUI-15 |
| U10 | Undo/Redo、三表示同期、tab/panel/cue/candidate寿命 | 実装 #1444/#1284 | GUI-11、GUI-12、GUI-16 |
| U11 | tab・zoom/pan/minimap・相互移動・保存出力・node操作・keyboard/focus | 実装各担当 | GUI-08、GUI-17、GUI-20、GUI-22、GUI-34 |
| U12 | 共有自動検査とM/V実操作を別記録、試作を転写しない | 自動検査を維持、記録 #1445 | 全IDのホスト別記録 |
| U13 | menuの役割・標準キー・共通処理・busy/文書なし・単一実行 | 実装 #1444 | GUI-04 |
| U14 | PFDSL native menuへのApp Shortcuts割当・IME非競合 | 実装 #1444 | GUI-05、GUI-23 |
| U15 | 文書ゼロ、最後のtab、New/Open/sample、自動2文書なし、New focus | 実装 #1444 | GUI-03 |
| U16 | 同名・長名・完全な場所・tooltip非依存 | 実装 #1444 | GUI-03、GUI-25 |
| U17 | A保存/B編集、再編集、保存中切替、外部変更取消・revision保護 | 実装 #1444、既存保存利用 | GUI-06、GUI-07、GUI-08 |
| U18 | 対象・比較版・保持結果、長文／長行／離れた差分、read-only、取消保持 | 実装 #1444 | GUI-07 |
| U19 | 診断から行へ、正常/エラー復帰、minimap、正規化の寿命・狭幅 | 実装 #1444/#1352/#1259 | GUI-18、GUI-21 |
| U20 | 文字200%・読上げ・keyboard・IME・contrast・選択/focus/状態 | 実装 #1444 | GUI-22、GUI-23、GUI-24、GUI-25 |
| U21 | 長日本語・同名・313行・native狭幅、実I/O全経路、証拠限界 | 実装各担当 | GUI-08、GUI-38、GUI-39、GUI-41、GUI-43、GUI-44 |

本文のmenu列挙、sidebar無効理由、sample/起動file優先、手動保存、file不在、metadata/コメント、候補入力寿命、読み上げ方向、非modal正規化、入力診断の強さは、対応する上表と計画の期待結果に含める。
未採用のSource/Split/Diagram、全右inspector、Liquid Glass、新brand色、独自キー設定、自動保存・Duplicate・別window化・復元は追加しない。

## #1444の採否記録との照合

| 採否ID | 現在の行き先 |
| --- | --- |
| R01〜R04、R07〜R09 | GUI-01、GUI-02、GUI-17、GUI-25、GUI-38 |
| R05、R06、R10 | 不採用を維持。片側modeや他app外観の丸ごと移植を試験条件にしない。既存相互移動はGUI-20 |
| R11〜R18 | GUI-02、GUI-03、GUI-06、GUI-07、GUI-08 |
| R19〜R27、R29〜R30 | GUI-03、GUI-04、GUI-05、GUI-22 |
| R28 | 開始画面のRecent常設を不採用、GUI-02/03でFileのみを確認 |
| R31〜R37、R39〜R41 | GUI-04、GUI-09〜21、GUI-24 |
| R38 | 全補助情報の常設右inspectorを不採用、Connections/一時正規化/図診断の所属をGUI-10/18/21で確認 |
| R42〜R44 | GUI-07、GUI-08。text比較の説明／差分だけ改善し保存保護を維持 |
| R45〜R56 | GUI-04、GUI-22〜25。単位・拡大・IME・readout・contrast・名称を保持 |
| R57 | Liquid Glass、新brand色、全icon化を不採用 |
| R58 | 別工程#1259のGUI-26。図hover廃止でeditor支援を削らない |
| R59〜R65 | GUI-08、GUI-38〜44と共通記録。初見・長時間・他OS・配布物・観測不能を分ける |
| R66 | 領域／文書状態／menu先行は推奨着手順。実機成功を補助表示／視覚仕上げのハード開始条件にしない |

画面案とM1〜M4の採否自体は維持する。
過去コメントの「仕様化のみ」「既存Issue本文を変更しない」「各工程の実機確認後完了」は当時の承認範囲・時機であり、2026-10-14の所有者指示で今回の管理整理と受入分離へ更新する。
過去コメントや観測を一括書換えせず、各Issue本文の現在条件と本変更記録から辿る。

## #1284と#1352の旧条件

| 旧条件 | 置換・保持 | 自動・担当 | 実機テストID |
| --- | --- | --- | --- |
| #1284 H01 | hover内の実graph必須をConnectionsの直接近隣へ仕様置換 | 実装 #1444/#1284 | GUI-09、GUI-10 |
| H02 | 方向・複数接続・feedback・孤立中心を保持 | 実装 #1284 | GUI-10 |
| H03 | 定義/locationなし、metadataを保持 | 実装 #1284/#1444 | GUI-09、GUI-10 |
| H04 | hover内pointer維持/click/端を情報hover＋安定panel移動へ置換 | 実装 #1444/#1284 | GUI-09、GUI-11 |
| H05 | 旧hover操作非競合を新hover/panelの非競合へ置換 | 実装 #1444/#1284 | GUI-17、GUI-20、GUI-22 |
| H06、H07 | editor→図とConnections→図の同じ一時強調 | 実装 #1284 | GUI-11 |
| H08 | 連続移動の旧cue取消、再描画だけ非再発火 | 実装 #1284 | GUI-11、GUI-16 |
| H09 | zoom/pan/fill/statusを保ちreduced-motionを尊重 | 実装 #1284 | GUI-11 |
| #1352 P01、P02 | 通常sizeの全文error、古いminimap排除と正常復帰 | 実装 #1352 | GUI-18 |
| P03、P04 | 初回全体、Fit/100%/倍率、view保持、Help/README | 実装 #1352、配置#1444 | GUI-17 |
| P05 | 定義作成位置・次項目、Quick Fix整合、空criteriaで消さない | 実装 #1352/#1259、#1282利用 | GUI-19 |
| P06 | root/拡張READMEから実build・起動 | 文書／起動検証 #1352 | GUI-37 |
| P07 | 旧hover移動をConnectionsへ置換、端の情報とcueを維持 | 実装 #1444/#1284 | GUI-09、GUI-11 |
| P08 | #1283巡回、既存gesture、#1282作成非競合 | 実装 #1352、完了基盤利用 | GUI-19、GUI-20 |
| P09 | 正常/エラー復帰、連続移動/panel、live/Problems/subflow/Undo/SVG | 実装各担当 | GUI-16、GUI-18、GUI-20、GUI-34 |
| P10 | unit/webview smokeと実host結果／未確認を分離 | 自動検査維持 #1352 | 上記IDのV結果を#1445へ |

## #1259・#1260・#1261・#1262の旧条件

| 旧条件 | 保持する要求と担当 | 実機テストID・行き先 |
| --- | --- | --- |
| #1259 F01 | 言語強調、診断、metadata、整形、正規化の実装・自動検査 | GUI-18、GUI-21、GUI-26、GUI-27、GUI-29 → #1445 |
| F02 | 定義移動/Quick Fix/connector/sort、Undo、保存後両host同義 | GUI-12〜16、GUI-19、GUI-28 → #1445 |
| F03 | live/zoom/pan/minimap/相互移動/extends更新 | GUI-11、GUI-17、GUI-20、GUI-29、GUI-38 → #1445 |
| F04 | 共通計算、既存#482/#483との非重複、将来機能との区別 | 自動host契約・独立レビューを#1259に維持。GUI-14/16/20で回帰 |
| F05 | 同じ入力／期待、言語設定・grammar・keys/host設定、全機能棚卸し | 自動比較と計画更新を#1259、GUI-26〜29を#1445 |
| F06 | Apple Siliconの日本語/不完全/大図/高速編集/tab隔離 | GUI-18、GUI-23、GUI-29、GUI-38 → #1445 |
| #1260 I01 | location/subflow/basePath、PFD内部・file外部・URL・directory候補 | 実装と解決/host自動検査は#1260、GUI-30 → #1445 |
| I02 | 未保存currentのGit/別file構造diff/解除、metadata非比較 | 実装と自動比較は#1260、GUI-31 → #1445 |
| I03 | Git検出・単独file・不在案内、通常機能を妨げない | 自動検査#1260、GUI-32 → #1445 |
| I04、I05 | Terminal/Ghostty、明示実行、shell/env/cwd/basePath、引用/日本語/複数行/失敗 | host自動検査#1260、GUI-33 → #1445 |
| I06 | 実app/browser/terminalとGit有無の到達証拠 | GUI-30〜33 → #1445。mock完了と実到達合格を区別 |
| #1261 E01、E02 | 全形式とAllの実装・共通結果model、追加runtime/独立Chromium不要 | 実装・自動出力/依存検査#1261、GUI-34/36 → #1445 |
| E03 | 全sample、日本語/font/style/preset/大図、寸法/抽出/可搬性/許容差 | 自動file検査#1261、GUI-34/36 → #1445 |
| E04 | 未保存対象、chooser/上書き/取消/権限/変換/部分成功 | 自動検査#1261、GUI-35 → #1445 |
| E05、E06 | 開発tool/Gitなしの外部viewer・file検査、両host証拠 | GUI-34〜36 → #1445。試作PDFで代用しない |
| #1262 D01 | 全対応表と基準拡張以降の差分・採否棚卸し | #1262に公開判断を維持、#1445のM対象試験結果を参照 |
| D02 | 最低OS・Apple Silicon・現行環境、Intel/Windows非対応 | GUI-39 → #1262/#1445 |
| D03、D04 | 関連付け・未起動/起動済み・通常起動・導入入替終了・更新確認/見送り/通信失敗/版比較 | 実装と自動検査#1262、GUI-40/41 → #1445 |
| D05 | 署名公証/DMG/notes/license/CI、版/commit/識別対応 | #1262候補準備、GUI-39/41で確認。候補準備は合格を待たない |
| D06 | 正式経路取得・開発環境なしGatekeeper/全機能/連携/全出力/更新 | 公開前GUI-41を#1445、公開後GUI-42は#1262最終条件 |
| D07 | 起動/多tab/大図/長時間/IME/競合、環境/未達、実size | GUI-23/38/43 → #1445、公開判断#1262 |
| D08 | 恒久URL/版/commit/DMG/OS/証拠、後から取得可能 | GUI-42 → #1262。実装完了や候補存在では完了にしない |

#1259本文の全機能表のeditor hover/Find all/hintはGUI-27、括弧・コメント・語境界はGUI-26、選択／形式別整形とextendsはGUI-29、定義range/sort/Quick FixはGUI-28、connector/正規化/tooltip/相互移動はGUI-12〜21へ対応する。
各Issueの共通採用条件（手動保存、OS範囲、WebKit、文書形式、terminal/外部app、非同梱Git、追加runtime不要、署名DMGと手動更新、未決の退避/復元/クラッシュ復旧）は元の担当に保持しGUI-08/30〜36/39〜42へ対応する。
初版にMarkdown viewer・内部terminal・Mac App Storeを追加しない。

## 移管時の統合済み基盤と残実装

| 根拠 | 現在の扱い |
| --- | --- |
| [PR #1431](https://github.com/takasek/pfdsl/pull/1431)、merge `29f3d0f4` | #1258/#1282/#1283/#483はCLOSED。保存/終了・定義作成・既存接続・V巡回の個別完了と証拠を維持する |
| [PR #1441](https://github.com/takasek/pfdsl/pull/1441)、merge `a3ae2f3c` | #1432はCLOSED。単一producerの拒否を共通編集で利用する |
| [PR #1440](https://github.com/takasek/pfdsl/pull/1440)、merge `6d04e855` | #1438はCLOSED。Mac保存能力／限定Linux読取専用を保持する |
| `src/language.ts`、`selection-format.ts`、`document-tab.ts`、`normalized-edges.ts` | language configuration、全体/選択・flow/flat整形、Monaco markers、共有作成/接続、相互移動、文書別非modal正規化は接続済み。古いplaintext・正規化未移植の記述を現状判定に使わない |
| 同上および拡張providerとの照合 | 構文強調、editor hover/Find all/command hint、Monaco Quick Fix、専用定義移動/sortは#1259に残る。#1444 Connections新編集・新配置も未実装 |
| `document-tab.ts`の`canOpenRelatedFiles: false`と非接続通知 | #1260の外部起動/Git比較は未接続。#1261の全形式保存と正式署名配布も未完了 |

旧hover局所SVGの実装と当時の受入は歴史的事実として保持し、GUI-09〜11の新方式を合格したとは扱わない。
新方式の実装前に旧方式を完成・検収する工程を置かない。
2026-10-05の可視editor/minimap不一致は後の表示同期修正と記録を対応させ、古い不合格／未確認を一括で未実施や合格へ変換しない。
現行版で未解決と判明した不合格は#1445に明記し修正・再試験を要求する。

## 依存の変更記録

既存実装artifactの実機条件を#1445のホスト別受入へ移し、名称とcriteriaを実装・自動検証・レビュー・計画登録へ明確化する。
既存statusと完了済み基盤は変更しない。
`hover_local_graph`は履歴IDを保持したままConnections近隣移動の実装を表し、`preview_focus_cue`は新しい移動経路へ合わせる。
#1259実装完了から#1260/#1261は独立して進め、#1444全体・前工程実機合格をハード入力にしない。
#1262の候補準備→M受入→公開を分け、V受入はVS Code公開だけへ接続する。
受入成功を受入対象appの生成条件にする循環を作らず、GUI-42の公開後検証は公開完了criteriaに残す。
