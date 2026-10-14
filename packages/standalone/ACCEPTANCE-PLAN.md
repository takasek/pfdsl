# GUI統合版の実機受入計画

2026-10-14の所有者指示により、実装完了・実機合格・公開完了を分離する。
要求の正本は各Issueと[#1444の採否記録](https://github.com/takasek/pfdsl/issues/1444#issuecomment-6145651652)、実行手順は本計画、結果は[受入記録](ACCEPTANCE.md)と既存evidenceである。
移管先は[GUI統合版の実機受入 #1445](https://github.com/takasek/pfdsl/issues/1445)、元条件の行き先は[要求対応表](ACCEPTANCE-MAPPING.md)。
本計画の登録は実装や実機受入の達成を意味しない。

## 実施と公開の境界

実装時は実装・必要な自動検証・独立レビューと対応試験の追加／更新を行う。
実機未実施だけを理由に実装PRのDraft維持・マージ待ち・次工程の停止を求めない。
既に実行できる項目は全機能・全ホストの完成を待たず確認できる。
Mac native（M）、VS Code Extension Development Host（V）、限定Linux native（L）を別々に判定する。
公開するホストの範囲を#1445に固定し、その範囲に必要な試験と不合格への対応が揃うまで受入成果物をdoneにしない。
他ホストの未確認は追加ゲートにしない。
公開に含む要求を未実装だから対象外にはできず、対象範囲の変更には要求元で所有者の判断を残す。
環境不足は未実施であり、既知のデータ消失・起動不能・表示不一致等の不合格を未実施へ戻さない。

GUI-39〜41と43は正式署名・公証済み候補を公開前に確認する。
GUI-42は承認された公開後の取得物と公開結果の読戻しで、#1262の最終完了に残す。
GUI-42を候補作成や公開前合格の前提にしない。
開発版の合格を署名・公証済み配布物へ転写しない。
Linux正式対応・Linux保存・Windows・新しいテーマ対応は追加しない。
今回、製品実装・手動実機試験・個人設定変更・署名公証・公開は実行しない。

## 共通入力と記録欄

1. Mは通常起動のTauri実アプリ、Vは当該commitからbuildした拡張のDevelopment Hostを使う。
   ブラウザ試作・モデル・共有計算・CI・startup smokeの成功と区別する。
2. 使い捨てフォルダに、異なる本文の`one/same.pfdsl`（A）と`two/same.pfdsl`（B）、長い日本語名、空白・引用符・日本語path、保存不能先、外部変更／削除／rename用コピーを用意する。
   操作前後のディスク本文を独立して読む。
3. 全`docs/samples/`と、大きい図`docs/pfdsl_implementation_flow.pfdsl`（原レビューでは313行）をコピーし、実行版の行数を記録する。
   長い行・離れた挿入／削除／変更のある比較文書、横長図、多数の接続、quoted／flow YAML key、同名field、反復ID、alias、LF／CRLF・補助平面文字を含む文書を用意する。
4. 周辺試験の本文は下の例とする。
   a〜dと孤立loneのartifact定義、p〜rのprocess定義と長いlabelを付け、別コピーではaの定義とlocationを外す。
   pの直接前後にq/cを混ぜず、bのfeedbackを区別する。
   missing／cyclic／更新可能なextendsと不完全入力も用意する。
5. 通常幅と狭幅は800×600、900×650、1280×720／800 CSS px相当を代表とし、native実寸とcontent領域の測定を分ける。
   本文200%相当、現在対応するテーマ、OS reduced-motion、実日本語IME、MのVoiceOver／Vの対応読上げを準備する。

```pfdsl
a >> p -> b
b >>? p
b >> q -> c
a >> r -> d
```

各試験の「記録：未記入」は、**テストID × ホスト × 必要な変種**ごとの、状態、対象commit／未コミット差分、ビルド識別（executable/frontendまたは拡張package）、OS/CPU/ホスト版、入力、実結果、証拠参照、残件／対象外理由の記入欄を指す。
未実施・合格・不合格・対象外を使い、対象外には要求上の根拠を記入する。
元の記録に不合格があれば、その版・症状・修正先を#1445の残件に保持する。
過去結果を使う場合は元の版、差分、変更のない経路と適用範囲を示し、新版を実測したと記録しない。
観測不能な変種を他変種の合格へまとめず、AX取得失敗や異常画像を製品欠陥・合格へ読み替えない。
初見／学習済み、短時間／長時間、開発版／配布版を区別する。

保存中切替・非同期結果の時機、出力の部分失敗等は各実装PRで再現方法を具体化する。
存在しない遅延スイッチ・故障注入APIを前提にしない。
自動検査の制御された遅延は別証拠とし、nativeで時機を観測できなければ該当変種は未実施とする。

## ワークスペース・文書・コマンド

### GUI-01：左右領域と状態保持

対応：#1444。対象・入力：M、編集済みA/B、大きい図、カーソル・選択・Undo・zoom/pan。
操作：起動時の左右実幅を測り、分割線をドラッグ／キーで調整し、リサイズとA→B→Aを行う。
期待：左editor／右図、初期50:50と可変幅が成立し、本文・dirty・Undo・カーソル・選択・図の視点を保つ。
毎回Fitへ戻らず、片側表示モードを追加しない。
状態：M未実施。記録：未記入。

### GUI-02：Recentとフォルダサイドバー

対応：#1444。対象・入力：M、フォルダ未選択、one/two、A/B。
操作：未選択時の無効理由を読む。Open Folder→ファイル選択→アイコン／menuでsidebar閉鎖・再開→File > Recentで文書／フォルダへ再アクセスする。
期待：フォルダ名・階層・選択が対応し、閉鎖で作業幅が戻る。
Recentを左側や開始画面へ常設せず、本文とdirtyを保つ。
状態：M未実施。記録：未記入。

### GUI-03：開始画面と文書識別

対応：#1444。対象・入力：M、文書ゼロ、A/B、長い名前、既存起動ファイル経路。
操作：起動→キーでNew/Open→Try a sample→最後のtab閉鎖を行う。実ファイル起動と同名文書の保存・閉鎖対象、完全な場所も確認する。
期待：自動Welcome＋sampleの2文書を開かず、文書ゼロだけ開始画面を示す。
実文書を優先しNew後editorへfocusする。
sample、同名文書、長い名前・場所をtooltipだけに頼らず識別し、セッション復元を追加しない。
状態：M未実施。記録：未記入。

### GUI-04：メニュー・標準キー・単一実行

対応：#1444。対象・入力：M、文書なし／busy／対象nodeなし、A/B、editor・検索・候補。
操作：New/Open/Save/Save As/Find/Undo/Redo/Clipboard、Close Tab/Window、Format flows/flat、Normalized edges、sidebar、図操作、Previous/Next Tabをmenuと標準キー、残るbutton／右clickで実行する。
期待：Fileは文書管理、Editは変更、Viewは表示、Windowはtab/windowを扱い、PFDSL/Helpの既存役割と英語名称を保つ。
同じ有効条件で正しい対象へ一度だけ働き、項目を残して無効理由を伝える。
標準キーを転用せずIME・入力欄・OS操作を奪わない。
tabとwindow閉鎖を区別し取消後は編集へ戻る。
状態：M未実施。記録：未記入。

### GUI-05：macOS App Shortcuts

対応：#1444。対象・入力：M、native menuの正確なコマンド名と非競合キー。
操作：OSのApp ShortcutsでPFDSL固有コマンドを一つ以上割当て、A/Bで実行し、editor・IMEと対照した後試験設定を戻す。
期待：正しい文書へ一度だけ作用し、標準キー・入力・IMEに競合しない。
Tauri採用だけで合格にせず、独自キー設定画面を追加しない。
状態：M未実施。記録：未記入。今回設定は変更しない。

### GUI-06：保存中切替と状態・通知

対応：#1444。対象・入力：M、A/B、ディスク独立読取。保存中と分かる再現方法は実装PRで確定する。
操作：A編集→保存→B編集、A再編集、A保存処理中にB切替、A外部変更確認の取消、の4変種で本文・disk・dirty・Undo・表示を記録する。
期待：保存結果はAに帰属し、Bの本文・dirty・Undoを変えない。
BにAのSavedを現在状態として残さず、A再編集で表示を更新する。
通知消失で未保存／外部変更状態を消さず、取消でbufferと未解決状態を保つ。
状態：M未実施。記録：未記入。時機未観測の変種は未実施。

### GUI-07：外部変更の説明とテキスト比較

対応：#1444のR42〜44、#1258の既存保護。対象・入力：M、dirty A、独立writer、長い日本語・長い行・離れた挿入／削除／変更。
操作：外部変更→保存比較で対象・Editor content/Observed disk content・各選択の結果を読む。別コピーでKeep Editing/取消、Use Disk、明示Replaceを実行し、比較中再変更と外部削除も試す。
期待：対象path・比較版・保持／利用する版、buffer/disk/未解決状態への作用と左右行対応・前後文脈を追える。
read-only表示と色以外の差分区別を保ち、取消は内容と未解決状態を保持する。
再競合は再確認し、file不在ではUse diskを無効にする。
自動競合解決・確認削減を追加しない。
状態：M未実施。記録：未記入。#1260の構造差分とは別。

### GUI-08：実ファイルの保存・終了回帰

対応：#1444、完了済み#1258/#1438。対象・入力：M、A/B、Untitled、Save As新規／既存、外部変更／削除／rename、書込不能先。
操作：Open/Folder/Recent、New→Save、Save As上書き／新規／取消、再Open、dirty tab/window/Cmd-Q/menu/Dock QuitのSave/Discard/Cancel、複数dirtyのDiscard→Cancel、保存失敗から回復を行う。
期待：選択した対象だけを保存し、取消・失敗で本文・dirty・保存先・未解決状態を保持する。
複数tab途中取消で両本文を保持し、Discardはdiskを変えない。
時間経過・tab/focus変更で自動保存せず、採用済み保存前検査の保証境界を維持する。
状態：M未実施。記録：未記入。基盤の完了を取り消さない。

## 共通hover・Connections・プレビュー

### GUI-09：図上のテキストhover

対応：#1444/#1284/#1352。対象・入力：M/V、metadataあり／なし、四隅、zoom/pan後。
操作：各nodeで情報を読み、hover中に既存click・pan・zoomと別の既存参照導線を使う。
期待：hover内graphがなく、カーソル追従のtextが端でも読める。
図操作を遮らずhoverを操作面にせず、metadataと参照導線を維持する。
状態：M/V各未実施。記録：未記入。editor hoverはGUI-27。

### GUI-10：Connectionsの方向と独立scroll

対応：#1444/#1284。対象・入力：M/V、p/b/lone、定義なしa、多数接続、長label、狭幅・幅を取るscrollbar。
操作：各nodeを右clickして開き、左右内容をsourceと照合し、片側scroll、片側ゼロ・孤立も試す。
期待：直接前後だけを左入力／中心／右出力へ示し、pへq/cを混ぜずfeedback方向を保つ。
未定義・孤立でも中心を扱い、scrollは左右独立、中心と下部入力を固定する。
常設1行text＋／＋textと各＋のライン下の整列、読上げ方向を保ち可視Incoming/Outgoingを復活させない。
状態：M/V各未実施。記録：未記入。

### GUI-11：近隣移動と一時強調

対応：#1284/旧#1285/#1444。対象・入力：M/V、大きい図、p/a/r、reduced-motion通常／有効。
操作：Connectionsでp→a→rと連続移動し、editor→図も使う。本文編集の再描画、pan/zoom、tab切替とpanel再開を行う。
期待：全体図を保って対象へ移動し中心を更新する。
対象だけ短時間示し古い強調を残さず、再描画の再センタリングだけで再強調しない。
fill/status・zoom/panを保ち、reduced-motionではanimationを抑えた静的合図を使う。
状態：M/V各未実施。記録：未記入。

### GUI-12：候補絞り込みと既存接続

対応：#1444。対象・入力：M/V、工程／成果物中心、ID≠label、左右別入力。
操作：focus→ID/label絞り込み→キー／pointer選択、Escape、候補中幅変更、中心／文書変更を行う。
期待：逆種別だけを指定側へ接続し、成功側だけ空にする。
Escape後も入力を残し、同対象の幅変更で値を保つ。
中心／文書変更は両値・古い候補をclearし、候補は入力／＋を覆わない。
Enter確定だけで新規作成しない。
状態：M/V各未実施。記録：未記入。

### GUI-13：新規作成＋接続の一括適用

対応：#1444。対象・入力：M/V、両種別中心の左右、有効新ID、コメント／metadata、接続拒否となる新producer。
操作：＋で作成・接続しsource/図/一覧を照合しUndo/Redoする。拒否変種も行う。
期待：＋が逆種別の新nodeをID＝初期labelで作り接続を一操作・一Undoで適用する。
失敗で未接続新node、dirty/Undoの部分変更を残さず、既存コメント／metadataと後の編集導線を保つ。
状態：M/V各未実施。記録：未記入。現APIとの差分は#1444。

### GUI-14：拒否と古い対象への非適用

対応：#1444、統合済み#1432。対象・入力：M/V、空／既存／不正ID、重複edge、種別違い、別producer、無関係な既存V001、一時的入出力不足。
操作：不正候補／＋、候補中source・種別・中心・tab変更／閉鎖後の旧要求確定を試す。非同期結果の再現は実装PRで具体化する。
期待：理由付き拒否でsource・dirty・Undo・入力を保ち、単一producerは共通判定を使う。
無関係な既存エラーや一時的不足を一括遮断せず、stale要求・描画・dispose後の結果を別文書／次対象へ適用しない。
状態：M/V各未実施。記録：未記入。

### GUI-15：edge削除とfeedback切替

対応：#1444。対象・入力：M/V、p中心の左input/右output、b中心の左output/右input、同endpointのprimary/feedback。
操作：line右clickでDelete、input↔feedback、outputの切替、通常inputへ戻せない条件を試す。
期待：選んだedgeだけ削除しnodeを消さない。
成果物→工程の向きを保持しoutputの切替は理由付き無効、方向反転を起こさない。
左右列だけで判断せず共有適用条件で検証する。
状態：M/V各未実施。記録：未記入。現APIにない編集要求は#1444。

### GUI-16：同期・Undo・表示寿命

対応：#1444/#1284。対象・入力：M/V、A/B、追加／削除／切替／作成＋接続後。
操作：各編集のUndo/Redo、panel開閉、連続移動、候補中resize、tab切替／閉鎖を交互に行う。
期待：source/図/左右一覧が同期し、Aの結果をBの本文・dirty・Undo・選択へ漏らさない。
古いmenu/cue/候補/timerを残さずmount/revision/dispose境界を維持する。
状態：M/V各未実施。記録：未記入。

### GUI-17：Fit・100%・倍率・案内

対応：#1352/#1259/#1444。対象・入力：M/V、大きい図、小さいsubflow、横長図、side-by-side狭幅。
操作：初回、Fit/100%/Zoom、wheel/drag/minimap/double click、pan後編集、resize→Fit、HelpとREADME照合を行う。
期待：初回全体を把握しFitと100%を区別して戻れる。
通常再描画は視点を不必要に戻さず、倍率・基本操作と説明が一致する。
minimap位置対応を保ち、resizeで図が切れるだけでは不合格にしない。
状態：M/V各未実施。記録：未記入。配置正本は#1444。

### GUI-18：診断とminimap回復

対応：#1352/#1444/#1259。対象・入力：M/V、zoom/pan後に末尾IDを除くsimple-chain、FM/lexer/parserエラー、通常打鍵・IME。
操作：正常→エラー→正常、全文読取、Go to error、IME組成と復帰を行う。
期待：診断はzoom/pan外の通常サイズで読め、古い図/minimapを現行として残さない。
文書別件数と行列から正しい位置へ戻り、修正後現在図と操作が回復する。
毎打鍵modalで編集を遮らず、待機時間や診断抑制を本整理で決めない。
状態：M/V各未実施。記録：未記入。

### GUI-19：作成後の定義編集案内

対応：#1352、統合済み#1282、#1259。対象・入力：M/V、bodyのみnode、quoted key、produced artifact、コメント。
操作：Quick Fixとpreviewから定義を作り、位置・label選択・次項目を確認しUndo/Redoする。
期待：新labelと必要metadataを見つけ、空criteriaでW002だけを消さない。
UI最小labelとCLI完成sourceの契約を区別し、正しい文書で一Undo、重複なし。
状態：M/V各未実施。記録：未記入。

### GUI-20：既存gesture・巡回の非競合

対応：#1352/#1444、完了済み#1283/#483/#1282。対象・入力：M/V、quoted/同名field/反復/alias、VのmultiCursorModifier両設定。
操作：double click移動、pan/zoom、subflow、作成／接続、live/Problems/Undo/SVGを使う。VのN/D chord/context menuと組込定義／Alt+F12 Peek／Cmd/Ctrl+clickを対照する。
期待：既存動線が競合せず、巡回は定義→全本文出現→定義、途中・編集後増減も正しい。
field/alias use siteを誤巡回しない。
standaloneへ#1283専用巡回UIを追加要求しない。
状態：M/V各未実施。記録：未記入。

### GUI-21：Normalized edges

対応：#1259/#1444。対象・入力：M/V、A/B、空edge／解析失敗、狭幅・minimap。
操作：表示→editor操作→再起動入口→編集→tab切替→Escape/Closeを行う。
期待：文書別・非modal・read-onlyを保ちsourceを書換えず、編集時古い結果をclearする。
閉鎖で起点へfocusし、minimap・主操作・Closeを塞がずscrollで読める。
状態：M/V各未実施。記録：未記入。

## 入力・言語支援・アクセシビリティ

### GUI-22：キーボードとfocus

対応：#1444/#1284/#1352。対象・入力：M/V、A/B、Connections・候補・補助表示・保存取消。
操作：pointerなしで文書→図→Connections→候補→補助表示、選択／＋／Escape／tab移動／close取消後編集を行う。
期待：主操作へ到達し選択とfocusを別の手掛かりで識別する。
Escapeと取消後は起点／編集継続位置へ戻り、常設入力を保つ。
状態：M/V各未実施。記録：未記入。

### GUI-23：日本語IME

対応：#1444/#1259。対象・入力：M/V、実IME、source/検索/左右接続入力、A/B。
操作：組成→候補変更→Enter確定/Escape→再入力、Undo/Redo、保存・再読込を行う。
期待：組成中に接続・新規作成・文書操作を誤起動せず、文字・対象・dirty/Undoを保持し診断で入力を遮らない。
状態：M/V各未実施。記録：未記入。

### GUI-24：読上げ

対応：#1444。対象・入力：M/V、実読上げ、p/b、無効候補、文書状態・menu。
操作：文書→node→Connections左右→edge/candidate/＋→無効項目／補助表示へ移動し操作する。
期待：ID/label/種別/状態/方向/操作名/無効理由が伝わる。
可視Incoming/Outgoing省略で意味を失わず、AX名の存在だけで合格にしない。
状態：M/V各未実施。記録：未記入。

### GUI-25：狭幅・本文200%・テーマ

対応：#1444。対象・入力：M/V、長い日本語名/label/行、代表寸法、通常／本文200%、現対応テーマ。
操作：拡大と各幅で保存／戻る／Close、候補・診断・比較を読み、文字と重要境界のcontrastを実測する。
期待：主操作と重要名称／状態へ到達し、図zoomと文字拡大、選択とfocus、status色と操作色を区別する。
色以外の手掛かり、system font・余白・整列・意味色を揃え、px/pt数値だけや固定色からdark対応を推定しない。
状態：M/V各未実施。記録：未記入。対応外テーマを追加しない。

### GUI-26：言語設定・構文強調

対応：#1259。対象・入力：M/V、同じ日本語・未完成YAML/body・quoted key・括弧／コメント、host設定。
操作：入力・comment toggle・語選択・括弧補完・強調を基準拡張と照合し、エラーから戻す。
期待：言語仕様に合い入力を失わず回復する。
専用configurationなしでも言語設定・文法・キー・host設定を棚卸しから落とさない。
状態：M/V各未実施。記録：未記入。

### GUI-27：editor hover・Find all・hint

対応：#1259。対象・入力：M/V、未定義・全metadata・quoted/flow key・同名field・反復ID・command。
操作：ソースhoverの情報／前後関係→定義移動→Find all→hint/inlayを読む。
期待：semantic nodeとfield、定義range、全出現が正しく、図hover廃止と混同しない。
表示hintと外部実行GUI-33を区別する。
状態：M/V各未実施。記録：未記入。

### GUI-28：Quick Fix・定義移動・sort

対応：#1259。対象・入力：M/V、未定義・quoted/flow/alias/同名field、値・コメント・CRLF・補助平面文字。
操作：Quick Fix、直接移動、各選択方式のsort、拒否、Undo/Redo、保存後他hostでOpenを行う。
期待：token/rangeが正しく値・コメント・改行を保つ。
失敗は無変更、成功はUndo可能で、保存文書の意味が両hostで一致する。
状態：M/V各未実施。記録：未記入。

### GUI-29：整形・診断・extends

対応：#1259。対象・入力：M/V、LF/CRLF、FM跨ぎ選択、不完全入力、未保存entry、missing/cyclic/更新preset。
操作：全体／範囲をflow/flatで整形・Undo/Redoし診断code/severity/message/rangeを照合する。preset変更・欠落・循環と高速編集／tab切替を行う。
期待：形式と選択境界が合い、authored未保存source/診断と依存診断を分離する。
lenient表示と一度読んだ同じ依存snapshotを使い、別tabへ古い結果を漏らさない。
状態：M/V各未実施。記録：未記入。

## 外部参照・構造差分・command

### GUI-30：参照の実到達先

対応：#1260。対象・入力：M、location/subflow/相対・絶対basePath、PFD/外部file/URL/複数候補directory、空白・引用・日本語path。Vは既存内部open回帰。
操作：各参照の起動先と実fileを照合し、候補選択／取消／不在／権限拒否を試す。
期待：MのPFDは内部tab、他fileは既定app、URLは既定browserへ届く。
VをMの規則へ一律変更せず、取消・失敗で本文/dirtyを保ち理由を示す。
表示リンクやmock成功だけで完了にしない。
状態：M/V各未実施。記録：未記入。

### GUI-31：Git／別file構造差分

対応：#1260。対象・入力：M/V、repo/ref・別file・未保存A、node/edge差分・metadataだけの差分。
操作：各比較→解除、読取中編集／tab切替、取消、不正ref／失敗を試す。
期待：現在側は未保存内容で正しい対象を比較し、metadata非比較の現仕様を明示する。
source/dirty/Undoを表示だけで変えず、古い結果を新対象へ適用しない。
GUI-07の保存競合text比較を前提にしない。
状態：M/V各未実施。記録：未記入。

### GUI-32：Git不在と単独file

対応：#1260。対象・入力：M、Gitあり／なしの試験環境、repo外単独file。
操作：Git比較の理由／導入案内を読み、通常編集・保存・別file比較・全形式出力を続ける。
期待：定義したGit検出／repo判定に合い、Git非同梱で通常機能を阻害しない。
状態：M未実施。記録：未記入。不在を再現できなければ未実施。

### GUI-33：Terminal.app／Ghostty

対応：#1260。対象・入力：M、両terminal、空白・引用・日本語path/引数、複数行command、相対／絶対basePath、非秘密の環境値。
操作：明示操作前は非実行を確認し、各terminalへ渡してcwd/引数/envを照合する。不在・起動失敗・権限拒否も試す。
期待：標準Terminal.app／選択Ghosttyの実到達先と内容が合い、失敗理由と本文を保つ。
内部terminalや終了codeによる自動進捗更新を追加せず、秘密値を記録しない。
状態：M未実施。記録：未記入。

## 書出し・配布・統合操作

### GUI-34：全形式の実出力

対応：#1261。対象・入力：M/V、全sample、日本語/font/style/status/preset/大きい図、未保存A。
操作：単体DOT/SVG/PDF/PNG/TSVとAllを実UIで生成し、DOT構造/encoding、SVG全図/node/edgeと外部view、PDFページ/縮尺/日本語/文字抽出、PNG pixel寸法、TSV値/tabを検査する。
期待：利用可能な実fileができ切れ・欠落がなく未保存対象が合う。
実装PRで寸法・許容差を確定し、両hostの意味／見た目／利用可能性で判定する。
menu項目やbyte一致だけで完成にしない。
状態：M/V各未実施。記録：未記入。

### GUI-35：出力失敗と部分成功

対応：#1261。対象・入力：M/V、既存出力、新規／書込不能先、一部形式失敗（再現方法は実装PRで確定）。
操作：chooser／上書き取消、明示上書き、権限／変換失敗、All部分失敗を行い保存fileを独立に読む。
期待：成功／警告／失敗と保存fileが一致し、部分成功fileを捨てず、source/dirty/Undoを変えない。
状態：M/V各未実施。記録：未記入。不在の故障APIを前提にしない。

### GUI-36：追加runtimeなしのMac出力

対応：#1261/#1262。対象・入力：M、Node/Graphviz/Puppeteer/独立browser/開発tool/Gitを追加導入しない検証Macと候補app。
操作：GUI-34全形式を生成し、既定外部viewerで開きbundle/依存/font/WebKit/PDF APIを記録する。
期待：app導入だけで利用でき独立Chromiumを同梱しない。
日本語・寸法が合い、最低OS制約をGUI-39へ渡す。
試作のPDF一例を全形式合格にしない。
状態：M未実施。記録：未記入。

### GUI-37：cloneから拡張build・起動

対応：#1352。対象・入力：V、clean checkout、root／拡張READMEの手順。
操作：記載の依存準備・build・`make vscode-dev`の起動経路を実行しDevelopment HostでPFDを開く。
期待：正しいpackage名とlaunch設定で実build・起動され、対象0件なのにexit 0という空振りがなく両READMEと挙動が合う。
状態：V未実施。記録：未記入。今回のCLI buildと区別する。

### GUI-38：代表作業の一連操作

対応：#1444のR59〜63、#1259。対象・入力：M/V、同名・長日本語・313行参照図・狭幅、初見／学習済みを区別。
操作：通常Open→編集→図からsource→保存→別文書→tab閉鎖、取消から再開、大きい図の通常打鍵とOpenを行う。
期待：対象誤認や変更喪失がなく可視本文・主図/minimapが一致する。
迷い・推測操作・focus喪失を記録し、短時間の学習済み操作から初見成功・速度改善を主張しない。
状態：M/V各未実施。記録：未記入。

### GUI-39：最低macOSと候補DMG

対応：#1262/#1261。対象・入力：M、#1262が確定する下限／現行OS、正式署名・公証候補、版/commit/hash。
操作：署名・公証・識別を検証し両環境で起動、Monaco/WebKit/ES2022/WASM/worker/CSP/IME/PDFを確認する。
期待：宣言範囲の実動作が合い、設定11.0やuserAgentを実測へ転写せずIntel/Windowsを対応表示しない。
状態：M未実施。記録：未記入。下限未確定／環境なしも未実施。

### GUI-40：関連付けと手動更新案内

対応：#1262。対象・入力：M、候補、未起動／起動済みPFD、更新版／失敗条件（#1262で確定）。
操作：OSからPFDを開き、通常起動／終了、更新確認時機・見送り・通信失敗・同版／新旧比較、手動取得／入替導線を確認する。
期待：正しい内部tabへ届き保存／取消を保つ。
更新は案内と手動取得で、自動download/置換/再起動をしない。
状態：M未実施。記録：未記入。

### GUI-41：署名配布物の導入と機能

対応：#1262。対象・入力：M、公開前の正式候補DMG、開発環境のないMac。
操作：導入／入替とGatekeeperを確認し、候補内appで必要なMのGUI-01〜36・38〜40と43を実行する。旧証拠利用は差分適用範囲を記録する。
期待：候補識別と実結果が対応し保存・連携・全形式が使える。
debug/ad-hoc署名appの成功を正式配布物へ転写しない。
状態：M未実施。記録：未記入。公開前に実施する。

### GUI-42：公開結果と取得物の読戻し

対応：#1262。対象・入力：M、別途承認された公開後のReleasesと実取得経路。
操作：恒久URL/版/commit/OS/notes/licenseを読み直しDMGを取得し候補hashと照合する。導入・起動・更新案内の最終確認を記録する。
期待：後から取得可能で候補受入と同じ識別／bytesへ対応する。
相違があれば合格を転写せず必要な再受入を行う。
状態：M未実施。記録：未記入。#1262の公開後最終条件である。

### GUI-43：長時間・多tab・大きい図

対応：#1444のR64/#1262。対象・入力：M、候補、大図・多tab・IME・保存競合。時間／操作回数は#1262で確定する。
操作：指定時間の編集／移動／切替／保存／競合取消を継続し、応答・資源・本文/dirty/Undoを観察する。
期待：データ喪失・起動不能・対象混在がなく継続でき、観測資源と実配布sizeを記録する。
試作値・短時間成功で長時間保証を主張せず性能閾値を本整理で創作しない。
状態：M未実施。記録：未記入。

### GUI-44：限定Linuxの保存能力回帰

対応：#1438の既存限定境界、#1444の証拠限界。対象・入力：L、識別済みAppImage/実native環境、編集文書。
操作：Save/Save As無効理由とキー非書込み、closeの保持既定／明示Discard、外部変更の採用取消を確認する。
期待：UI/nativeで保存不可を守り取消で本文を保つ。
露出しない独立Quit入口は未実施と分け、Mac保存／Quitを転写しない。
状態：L未実施。記録：未記入。Mac/V公開ゲート外で正式Linux対応に広げない。

## 実装時の具体化

GUI-06/14/31の時機再現、GUI-13/15の共有編集API差分、GUI-34/35の寸法・許容差・部分失敗、GUI-39/40/43の下限OS・更新・長時間条件を各担当PRで確定する。
試験対象と期待結果は上記を維持し、未確定の実行手段を合格とは扱わない。
通常の自動test・CIは[対応表](ACCEPTANCE-MAPPING.md)の実装契約とともに維持する。
新しい試験管理システム、状態機械、網羅性判定器や証跡基盤は導入しない。
