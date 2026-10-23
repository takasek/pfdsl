# GUI統合版の実機受入計画

2026-10-14の所有者指示により、実装完了・実機合格・公開完了を分離する。
要求の正本は各Issueと[#1444の採否記録](https://github.com/takasek/pfdsl/issues/1444#issuecomment-6145651652)、実行手順は本計画、結果は[受入記録](ACCEPTANCE.md)と既存evidenceである。
現在の対象Issue・担当・要求と試験IDの対応・対象版・公開範囲・進捗・残件は[GUI統合版の実機受入 #1445](https://github.com/takasek/pfdsl/issues/1445)で管理する。
本計画は製品版に対応する入力・操作・期待結果をGitで管理し、各試験の「対応」はこの計画版を作った時点の要求への参照である。
Issueの増減・担当変更だけではその参照や[2026-10-14の移管記録](ACCEPTANCE-MAPPING.md)を更新せず、共通受入Issueの管理表へ新旧の対応と理由を記録する。
既存試験を再利用できない操作・期待結果の変更は実装PRで本計画へ反映し、その版の計画を共通受入Issueから参照する。
本計画の登録は実装や実機受入の達成を意味しない。
各試験の「未実施」「未記入」は計画登録時の初期状態と記録項目を示す。
実行後の現在の進捗は共通受入Issue、版別の実結果は受入記録とevidenceに追記し、進捗だけを理由に本計画を更新しない。

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
GUI-42は承認された公開後の取得物と公開結果の読戻しで、共通受入Issueが参照する公開担当Issueの最終完了に残す。
GUI-42を候補作成や公開前合格の前提にしない。
開発版の合格を署名・公証済み配布物へ転写しない。
Linux正式対応・Linux保存・Windows・新しいテーマ対応は追加しない。
今回、製品実装・手動実機試験・個人設定変更・署名公証・公開は実行しない。

## 共通入力と記録欄

1. Mは通常起動のTauri実アプリ、Vは当該commitからbuildした拡張のDevelopment Hostを使う。
   ブラウザ試作・モデル・共有計算・CI・startup smokeの成功と区別する。
2. 使い捨てフォルダに、異なる本文の`one/same.pfdsl`（A）と`two/same.pfdsl`（B）、長い日本語名、空白・引用符・日本語path、保存不能先、外部変更／削除／rename用コピーを用意する。
   操作前後のディスク本文を独立して読む。
3. 全`docs/samples/`と、大きい図`docs/samples/pfdsl_implementation_flow.pfdsl`（原レビューでは313行）をコピーし、実行版の行数を記録する。
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
分割比10%・50%・90%でNormalized edgesを開閉し、開いたまま分割と画面幅を変えて、パネルが右図の幅に追従し左editorを覆わず、Close／Escapeで閉じられることも確認する。
1180×812と898×812、source50%・70%でも長いIDの12入力・12出力を末尾までスクロールし、minimapと一覧の領域が重ならず最終行まで読めることを確認する。
入口：`Source and diagram widths`分割線。左右キーは5ポイント、Shift併用は1ポイント、Home/Endは10/90%。6pxの分割線を除いた両paneを初期50:50にし、同じeditor/preview instanceの幅だけを変える。
期待：左editor／右図、初期50:50と可変幅が成立し、本文・dirty・Undo・カーソル・選択・図の視点を保つ。
毎回Fitへ戻らず、片側表示モードを追加しない。
代表幅800/900/1280pxではsidebarの有無と本文100/200%を区別し、source90%でもCloseの全文字が折返して読め、クリック／Escapeと起点へのfocus復帰が可能なことを確認する。
PR #1448の320px・source90%での文字欠け、sidebar併用時の最小26px幅による重なりは既知の不合格履歴として保持する。
この極小幅の過去結果を未実施へ戻さず、代表幅の修正やChrome probeの成功をnativeの合格へ転写しない。
状態：M未実施。記録：未記入。

### GUI-02：Recentとフォルダサイドバー

対応：#1444。対象・入力：M、フォルダ未選択、one/two、A/B。
操作：開始時にサイドバー切替ボタンが非表示でView > Show Sidebarが無効なことを確認する。Open Folder→ファイル選択→Filesボタン／menuでsidebar閉鎖・再開→File > Recentで文書／フォルダへ再アクセスする。
期待：フォルダ名・階層・選択が対応し、表示中はFilesボタンが現れ、閉鎖で作業幅が戻る。
Recentを左側や開始画面へ常設せず、本文とdirtyを保つ。
状態：M未実施。記録：未記入。

### GUI-03：開始画面と文書識別

対応：#1444。対象・入力：M、文書ゼロ、A/B、長い名前、既存起動ファイル経路。
操作：起動→キーでNew/Open→Try a sample→最後のtab閉鎖を行う。Newを複数回行って途中のtabを閉じ、最小空き番号の再利用とSampleのSave As既定名を確認する。実ファイル起動と同名文書の保存・閉鎖対象、完全な場所も確認する。
期待：自動Welcome＋sampleの2文書を開かず、文書ゼロだけ開始画面を示す。実文書を優先しNew後editorへfocusする。
文書名はtabとwindow titleに表示し、headerは短い状態とlocationを示す。locationは1行で省略表示し、titleから完全pathを確認できる。
native titleはDOM titleとは別にウィンドウ管理側で確認する（#1514）。文書ゼロのPFDSL、新規名、Open、Save As後の名前、dirtyの` •`、同名時の親path補足、片方を閉じた後の補足解除を確認する。連続切替後も最後の文書へ収束し、IPC失敗時は案内が出て編集を続けられることを確認する。
sampleはSampleと表示しSave As既定名をSample.pfdslにする。Untitledは現在開く文書名の最小空き番号を使う。
同名文書を区別し、長い名前・場所をtooltipだけに頼らず識別して、セッション復元を追加しない。
同名タブの補足は一意になる最短の親path末尾を使い、tooltipには完全pathを残す。同じ末尾folder名、root直下、片方の親pathが他方の末尾になる組合せ、Save Asと閉鎖後の再計算も確認する。
タブバーが横にあふれるまで開き、New／Open／既存文書の再選択／Previous・Next／閉鎖後の選択で、選択タブが自動的に見える位置へ移ることを確認する。
状態：M未実施。記録：未記入。

### GUI-04：メニュー・標準キー・単一実行

対応：#1444。対象・入力：M、文書なし／busy／対象nodeなし、A/B、editor・検索・候補。
操作：New/Open/Save/Save As/Find/Undo/Redo/Clipboard、Close Tab/Window、Format flows/flat、Normalized edges、sidebar、図操作、Previous/Next Tabをmenuと標準キー、残るbutton／右clickで実行する。
Ctrl+Tab／Ctrl+Shift+TabはWebView側が処理し、native menuの同名項目はキー表示のみとする。
2タブと3タブでeditorとFitから一回ずつ切り替え、二重実行がなく、IME変換中・dialog表示中・busy時は切り替わらないことを確認する。
切替直後と処理完了後のnative titleを記録し、古い文書名が後着しないことを確認する（#1514）。
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
時機：大きいAでSaveを開始し、native保存応答前にBのtabを選ぶ。保存応答前であることを観測できない場合は、この変種を未実施のまま残す。既存の`document-host-recovery.test.mjs`／`document-lifecycle-*.test.mjs`による応答保留と`workspace-host.test.mjs`の表示検査は自動検証の別証拠であり、nativeの遅延注入スイッチは追加しない。
操作：A編集→保存→B編集、A再編集、A保存処理中にB切替、A外部変更確認の取消、の4変種で本文・disk・dirty・Undo・表示を記録する。
期待：保存結果はAに帰属し、Bの本文・dirty・Undoを変えない。
BにAのSavedを現在状態として残さず、A再編集で表示を更新する。
通知消失で未保存／外部変更状態を消さず、取消でbufferと未解決状態を保つ。
`Current diagnostics`と`Last action`を区別し、後者の発生文書を確認する（#1516）。Aの一時通知はBに表示せず、A編集後は消える。`Dismiss action notice`で一時通知を閉じ、診断と本文は保持される。Aの保存失敗はBへ切替後もAのpath付き`Save needs attention`として残り、Aを編集しても消えず、保存・回復成功で解消する。時間経過や一時通知のdismissで保存失敗を消さない。politeな読み上げで同じ通知を描画ごとに繰り返さないことも確認する。
状態：M未実施。記録：未記入。時機未観測の変種は未実施。
読み上げの残件（#1516）：連続入力で `Checking…` と診断件数の変化が過剰に読まれないか、複数文書の保存失敗がある状態で新規通知を出すと既存の全行が再読されないかを VoiceOver 等で確認する。
DOM の aria-live 属性検査や診断統合テストだけでは、この確認を完了したと扱わない。

### GUI-07：外部変更の説明とテキスト比較

対応：#1444のR42〜44、#1258の既存保護。対象・入力：M、dirty A、独立writer、長い日本語・長い行・離れた挿入／削除／変更。
操作：外部変更→保存比較で対象・Editor content/Observed disk content・各選択の結果を読む。別コピーでKeep Editing/取消、Use Disk、明示Replaceを実行し、比較中再変更と外部削除も試す。
期待：対象path・比較版・保持／利用する版、buffer/disk/未解決状態への作用と左右行対応・前後文脈を追える。
read-only表示と色以外の差分区別を保ち、取消は内容と未解決状態を保持する。
再競合は再確認し、file不在ではUse diskを無効にする。
自動競合解決・確認削減を追加しない。
回復案内が必要な間は操作通知のdismissや現在診断の更新で失われず、回復後は解消済みの保存失敗が残らないことを確認する（#1516）。
入口：既存の`Review and Save Here…`／`Use Current Disk Version…`と保存前比較。比較はMonacoのread-onlyな左右diff editorを使い、変更gutter・行対応・overviewと独立した長行scrollを確認する。`Editor content`と`Observed disk content`は既存のOperationPlanに束縛された版で、表示部品自身は文書やdiskを書き換えない。
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
操作：fillなし／status色付きの各nodeの図形内側をclickして開き、左右内容をsourceと照合し、片側scroll、片側ゼロ・孤立も試す。
Tab→Enterと右clickでも開き、node上からのpan、移動後に起点へ戻るdrag、Cmd/Ctrl+click、minimap操作では閉じたConnectionsが開かないことを確認する。
閉じたConnectionsで図の下端付近のnodeをdouble clickし、2回目のclickまでpanelが開いて図の領域を縮めないこと、Enterと右clickには待ち時間がないことを確認する。
期待：直接前後だけを左入力／中心／右出力へ示し、pへq/cを混ぜずfeedback方向を保つ。
未定義・孤立でも中心を扱い、scrollは左右独立、中心と下部入力を固定する。
常設1行text＋／＋textと各＋のライン下の整列、読上げ方向を保ち可視Incoming/Outgoingを復活させない。
状態：M/V各未実施。記録：未記入。

### GUI-11：近隣移動と一時強調

対応：#1284/旧#1285/#1444。対象・入力：M/V、大きい図、p/a/r、reduced-motion通常／有効。
操作：Connectionsでp→a→rと連続移動し、editor操作（Mはkeyboard／mouseとGo to definition・検索結果などのAPI移動、Vはnode IDの選択）、図のclick／double clickも使う。
定義ありのGo to definitionと定義なしのCreate definitionを使い、本文編集の再描画、pan/zoom、tab切替とpanel再開を行う。
Connectionsから追加・削除・feedback切替・定義作成を適用し、editorのcursorが動いても中心が変わらないことを確認する。
期待：全体図を保って対象へ移動し、editor・図・Connectionsが同じnodeを指す。
editor操作はeditorのfocusを保ち、閉じたConnectionsを開かず、開いていれば中心を追従する。
Connectionsの近隣移動はeditorのcursorも移し、focusはConnectionsに残す。
図の単clickはdouble click判定の待ち時間後にConnectionsを開き、同期のechoではpanを変えず合図を繰り返さない。
図のdouble clickは単click処理を取り消し、Connectionsを同じnodeで開いてsourceへ移動しeditorにfocusする。
Vではsourceを閉じてからdouble clickとGo to definitionを各々試し、previewを覆わない別groupへsourceが開いてfocusすること、単click同期だけではsourceを開かないことを確認する。
Go to definitionは中心nodeの定義位置へ移動してeditorにfocusする。
Create definitionは`label: ""`を持つ定義を作り、editorへfocusして空の引用符の内側にcursorを置く。
そこからlabelを入力でき、既存の案内と、出力成果物に必要なcriteriaのW002案内を保つ。
labelがIDと同じ既存nodeは、`layout.maxWidth`の有無によらず図にIDを1回だけ表示する。
対象だけ短時間示し古い強調を残さず、再描画の再センタリングだけで再強調しない。
fill/status・zoom/panを保ち、reduced-motionではanimationを抑えた静的合図を使う。
状態：M/V各未実施。記録：未記入。

### GUI-12：候補絞り込みと既存接続

対応：#1444。対象・入力：M/V、工程／成果物中心、ID≠label、左右別入力。
操作：focus→ID/label絞り込み→キー／pointer選択、Escape、候補中幅変更、中心／文書変更を行う。
パネルをpointerで開いたときはfocusを移さず、node上のEnterでは見出しの最初の操作へ移し、どちらも候補を開かないことを確認する。
一覧・中心・候補の成果物は四角枠、工程は完全に丸い枠で示し、VoiceOverでID・label・種別・接続方向・操作名が伝わることを確認する。
通常接続は実線、feedbackは図と同じ灰色の破線で示し、候補のfeedback印をem dash連結で表示しないことを確認する。
macOSのオーバーレイscrollbarを表示し、一覧・候補・理由・menuの左右余白が内容との重なりを防ぎ、各行と入力＋が一つの外枠にまとまることを確認する。
`a >> p -> b`のp左側からb、b右側からpを選ぶときは、feedbackと明示された候補を選び、`b >>? p`を作成できることを確認する。
期待：逆種別だけを指定側へ接続し、成功側だけ空にする。
選択成功後は入力focusを保ち、更新後の候補一覧を再表示する。
同じ側で接続済みの候補はinput／feedbackとも非表示とし、反対向きのoutputは除外判定に含めない。
通常接続が可能なら通常候補、V010で通常接続が不可能でfeedbackが可能な場合だけfeedback候補を表示し、V001等の不可能な候補は表示しない。
`draft -> doc`だけがあるとき、draftに入る側のdocをfeedback候補として選べることを確認する。
Escape後も入力を残し、同対象の幅変更で値を保つ。
中心／文書変更は両値・古い候補をclearし、候補は入力／＋を覆わない。
Enter確定だけで新規作成しない。
状態：M/V各未実施。記録：未記入。

### GUI-13：新規IDへの接続追加

対応：#1444/#1466。対象・入力：M/V、両種別中心の左右、有効新ID、コメント／metadata、接続拒否となる新producer。
操作：＋で作成・接続しsource/図/一覧を照合しUndo/Redoする。拒否変種も行う。
期待：＋が逆種別の新IDへの接続だけを一操作・一Undoで追加し、front matterの定義やlabelを書かない。
editorの選択位置は候補選択による追加と同じく追加した接続位置とし、定義が必要なら新nodeのCreate definitionを使う。
失敗で未接続新node、dirty/Undoの部分変更を残さず、既存コメント／metadataと後の編集導線を保つ。
状態：M/V各未実施。記録：未記入。現APIとの差分は#1444。
API差分：`addConnector`の`create: true`は新IDの検査に使い、共有`applyPreviewEdit`は既存IDを拒否してedgeだけを挿入する。候補選択は`create: false`、常設＋だけが`true`を送る。両hostが既存のsource/revision/dispose検査と単一editor edit／WorkspaceEditで適用する。

### GUI-14：拒否と古い対象への非適用

対応：#1444、統合済み#1432。対象・入力：M/V、空／既存／不正ID、重複edge、種別違い、別producer、無関係な既存V001、一時的入出力不足。
操作：不正候補の非表示と＋の拒否理由、候補中source・種別・中心・tab変更／閉鎖後の旧要求確定を試す。非同期結果の再現は実装PRで具体化する。
自動再現：`connections-panel.test.ts`で旧候補を保持してsource更新後に確定し、共有のsource一致検査で拒否する。ホスト拒否・無関係な応答・閉鎖後の遅着応答も同じテストで操作する。`connector-producer.test.mjs`は描画を更新しないままMonacoの現在sourceを変更してから＋を確定し、host側で再拒否する。実hostの非同期時機を観測できなければ、その実機変種は未実施とする。
期待：理由付き拒否でsource・dirty・Undo・入力を保ち、単一producerは共通判定を使う。
無関係な既存エラーや一時的不足を一括遮断せず、stale要求・描画・dispose後の結果を別文書／次対象へ適用しない。
開始した編集の応答を保留したまま中心を移動、またはパネルを閉じて再開しても、応答までConnectionsから次の編集を送信しない。
成功／拒否の応答後は再操作でき、移動先で入力した値と現在のフォーカスを保つ。
状態：M/V各未実施。記録：未記入。

### GUI-15：edge削除とfeedback切替

対応：#1444。対象・入力：M/V、p中心の左input/右output、b中心の左output/右input、同endpointのprimary/feedback。
操作：lineのclick／右clickでその位置のmenuを開き、Delete、切替可能なinput↔feedback、outputの項目を試す。共有計算が切替を拒否する条件（通常inputへ戻すとV010になる、または切替先が既にある）では、切替項目と理由を表示せずDeleteだけが残ることを確認する。
画面端でmenuがはみ出さず、項目が1つだけの場合もArrow／Home／Endでその項目へfocusでき、Enter／Spaceで選択できることを確認する。Escapeで起点lineへ戻り、menu外clickで閉じることを確認する。
期待：選んだedgeだけ削除しnodeを消さない。
最後の接続が無くなる未定義nodeは、labelの無い空のmapping定義で種別を保持する。
成果物→工程の向きを保持し、outputのmenuはDeleteだけで、方向反転を起こさない。
切替後は同じ接続のbutton、削除後は同じ側の次の行（末尾なら前の行、行が無ければ同じ側の入力欄）へ戻し、候補は開かない。
左右列だけで判断せず共有適用条件で検証する。
状態：M/V各未実施。記録：未記入。現APIにない編集要求は#1444。
API差分：`deleteConnector`／`toggleFeedback`は`nodeId/source/artifact/process/kind`を渡す。共有計算がsemantic edgeの全authored occurrenceを対象に、該当する集合／chain文だけを再構成し、文外・内部コメントと端点のkindを保つ。最後のedgeを消してkindが失われる端点はCST経由の最小定義を保持する。切替先重複、outputのfeedback化、新しいprimary cycleを拒否し、無関係な既存V001/V010は一括拒否しない。

### GUI-16：同期・Undo・表示寿命

対応：#1444/#1284。対象・入力：M/V、A/B、追加／削除／切替／作成＋接続後。
操作：各編集のUndo/Redo、panel開閉、連続移動、候補中resize、tab切替／閉鎖を交互に行う。
期待：source/図/左右一覧が同期し、Aの結果をBの本文・dirty・Undo・選択へ漏らさない。
古いmenu/cue/候補/timerを残さずmount/revision/dispose境界を維持する。
中心・文書切替と幅変更ではmenuを閉じ、再描画で操作要素が置換された場合も同じ側の近くにfocusを戻す。
#1515変種：AでConnectionsを開き、sourceのcriteriaを不完全なYAMLにしてpanelが閉じた後、Bへ切り替えて編集し、Aへ戻って修復する。
期待：Aの最新の正常図に同じIDがある場合だけConnectionsの中心を再表示し、Bの本文・Undo・選択・focusは変わらない。
候補入力と保留していた編集のUI状態は復元せず、遅れた応答も新しいpanelへ表示しない。
状態：M/V各未実施。記録：未記入。

### GUI-17：Fit・Actual size・倍率・案内

対応：#1352/#1259/#1444。対象・入力：M/V、大きい図、小さいsubflow、横長図、side-by-side狭幅。
操作：初回、Fit/Actual size/Zoom、wheel/drag/minimap/double click、pan後編集、resize→Fit、HelpとREADME照合を行う。
#1517変種：source検索でnodeを選び（Vはnode IDを選択）、Focus selected nodeを押す。
通常nodeは100%で中央へ、表示領域より大きいnodeは100%を上限として全体が収まる倍率で中央へ移ることを確認する。
Connectionsの表示中も残った図の領域で中央化し、panel・本文・Undoを変更しない。
未選択、groupだけの選択、エラー中、描画中は操作を無効とし、正常化だけでは古い選択を復元しない。
通常のsource選択は倍率を保ち、明示操作後の再描画だけで再ズームせず、FitとActual sizeは従来の意味を維持する。
期待：初回全体を把握しFitとActual sizeを区別して戻れ、倍率表示は従来どおり100%等を示す。
通常再描画は視点を不必要に戻さず、倍率・基本操作と説明が一致する。
minimap位置対応を保ち、resizeで図が切れるだけでは不合格にしない。
状態：M/V各未実施。記録：未記入。配置正本は#1444。

### GUI-18：診断とminimap回復

対応：#1352/#1444/#1259/#1475。対象・入力：M/V、zoom/pan後に末尾IDを除くsimple-chain、FM/lexer/parserエラー、`a >> p -> b`と`a >>? p`の併記（V036）、通常打鍵・IME。
操作：正常→エラー→正常、全文読取、Go to error、IME組成と復帰を行う。
#1515変種（GUI-11の近隣移動後にも実施）：Connectionsでpを開き、sourceのcriteriaへ閉じていない引用符を入力し、連続して不完全YAMLを編集してから修復する。
期待：エラー中はConnectionsから編集できず、修復後にpが存在すればConnectionsだけが戻る。
sourceへの入力focus、本文・Undo、pan/zoomを復帰処理が変更せず、選択解除だけでは復帰候補を失わない。
修復前にプレビューのエラー表示へfocusを移してEscape、エラー前の明示Close、別nodeへの明示選択、正常化時のpの削除／改名を別々に試し、この場合は旧pへ戻らないことを確認する。
削除／改名後にUndoで同IDを戻しても、自動復帰しないことを確認する。
V036では、エディタの波線が`a >>? p`の`a`から`p`までに出ることを確認する。
図が止まったerror表示の「Keep normal input」と「Keep feedback」をそれぞれ別の試行でkeyboardとpointerから選び、各1回のUndoで併記へ戻ることを確認する。
期待：診断はzoom/pan外の通常サイズで読め、古い図/minimapを現行として残さない。
文書別件数と行列から正しい位置へ戻り、修正後現在図と操作が回復する。
「Keep normal input」はfeedbackだけを、「Keep feedback」は通常入力だけを消し、どちらも既定として選ばれていない。
修復後、Mはステータス表示、Vは情報メッセージで、消した接続と新しく出た診断（通常入力を消した場合のW008）を示し、図が再描画される。
V036以外のerrorが先に表示されている場合は修復の操作を出さない。
毎打鍵modalで編集を遮らず、待機時間や診断抑制を本整理で決めない。
状態：M/V各未実施。記録：未記入。

### GUI-19：作成後の定義編集案内

対応：#1352、統合済み#1282、#1259。対象・入力：M/V、bodyのみnode、quoted key、produced artifact、コメント。
操作：Quick Fixとpreviewから定義を作り、位置・空の`label: ""`の引用符内のcursor・次項目を確認しUndo/Redoする。
期待：新labelと必要metadataを見つけ、空criteriaでW002だけを消さない。
UI最小labelとCLI完成sourceの契約を区別し、正しい文書で一Undo、重複なし。
状態：M/V各未実施。記録：未記入。

### GUI-20：既存gesture・巡回の非競合

対応：#1352/#1444、完了済み#1283/#483/#1282。対象・入力：M/V、quoted/同名field/反復/alias、VのmultiCursorModifier両設定。
操作：double click移動、pan/zoom、subflow、作成／接続、live/Problems/Undo/SVGを使う。VのN/D chord/context menuと組込定義／Alt+F12 Peek／Cmd/Ctrl+clickを対照する。
#1517変種：GUI-17の検索→選択→Focus selected nodeの後に、接続編集→Undo、Fit、Actual size、pan/zoomを順に行い、選択対象・本文・履歴と既存操作を保つことを確認する。
期待：既存動線が競合せず、巡回は定義→全本文出現→定義、途中・編集後増減も正しい。
field/alias use siteを誤巡回しない。
standaloneへ#1283専用巡回UIを追加要求しない。
Vのeditor上ではノードIDにカーソルを置き、context menuまたはcommand paletteの`PFDSL: Add Connector…`から`>>`／`>>?`／`->`と既存／新規IDを選び、本文への挿入・再描画・Undo／Redo・取消で無変更を確認する。
これは#482／PR #488で保留されたeditor QuickPickの実Host条件であり、Connections側の成功で代用しない。
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
#1517変種：Connectionsを開いた狭い図領域と長いlabelの巨大nodeでFocus selected nodeを使い、toolbarが折り返しても操作へ到達できること、倍率は100%以下で対象全体が収まることを確認する。
非表示tabで古い移動を予約せず、表示へ戻しただけでは勝手に再ズームしないことも確認する。
期待：主操作と重要名称／状態へ到達し、図zoomと文字拡大、選択とfocus、status色と操作色を区別する。
色以外の手掛かり、system font・余白・整列・意味色を揃え、px/pt数値だけや固定色からdark対応を推定しない。
状態：M/V各未実施。記録：未記入。対応外テーマを追加しない。

### GUI-26：言語設定・構文強調

対応：#1259。対象・入力：M/V、同じ日本語・未完成YAML/body・quoted key・括弧／コメント、host設定。
操作：入力・comment toggle・語選択・括弧補完・強調を基準拡張と照合し、エラーから戻す。
Mの言語支援接続版では文書先頭の`---`だけがYAML強調を開始し、終了フェンス後の`>>`／`>>?`／`->`、角括弧、quoted ID、Unicode ID、コメントを区別する。
先頭空行の後のフェンス、未閉鎖quoted ID、未閉鎖YAML、flow map・block scalarも入力し、修復後の強調と語選択を再確認する。
期待：言語仕様に合い入力を失わず回復する。
専用configurationなしでも言語設定・文法・キー・host設定を棚卸しから落とさない。
状態：M/V各未実施。記録：未記入。

### GUI-27：editor hover・Find all・hint

対応：#1259、#1518。対象・入力：M/V、未定義・schema定義済みの全metadata・quoted/flow key・同名field・反復ID・command。
schema外の拡張キーを含む文書も入力するが、任意の拡張キーのhover表示をこの受入条件には含めない。
操作：ソースhoverの情報／前後関係→定義移動→Find all→hint/inlayを読む。
MではソースのノードIDをhoverし、`Go to definition`／`Find all`を選ぶ。
artifact/processの`index`、processの複数`location`と`boundary`、groupの`color`／`parent`を含む文書で、それぞれの値がhoverへ表示されることを確認する。
block／flow mapのquoted group keyをhoverし、label・color・parent・artifact/processのmemberを読み、同じ行のmetadata field上には宣言hoverが出ないことを確認する。
group hoverの`Find all`と、artifact/processを対象とする定義移動・semantic巡回を区別し、既存の巡回・Undo・文書隔離を再確認する。
右クリックまたはF1から`Go to PFDSL definition`、`Next PFDSL node occurrence`、`Previous PFDSL node occurrence`、`Find all text matching this node`を実行する。
quoted/flow keyのID上と同じ行の`label`／`owner`等のfield上を区別し、定義＋body内の同一IDの巡回・折返し、定義なしの案内を確認する。
Find allは現行拡張と同じliteral文字列検索であり、metadata fieldを除くsemantic参照・巡回とは区別する。
processのcommand行末の`Command` hintをhoverして複数行の内容を読み、表示だけで実行されないことを確認する。
hoverを残したまま編集・文書切替・閉鎖し、旧版のリンクが新しい文書や版へ作用しないことを確認する。
2026-10-21の使用感レポートの15行fixtureでも、14行目のpackage_manifestでShow Hover→撮影→Escape→本文編集を行う。
labelのみ、criteriaのみ、groupとcriteria、descriptionを含む場合を分け、Linux nativeではWebKitWebProcessの存否・終了時刻・stderr・利用可能な終了理由を記録する。
Linuxで報告された3回の表示プロセス消失は原因未確定であり、Chromiumでの成功をWebKitGTKやMac nativeの合格へ転写しない。
期待：semantic nodeとfield、定義range、全出現が正しく、図hover廃止と混同しない。
表示hintと外部実行GUI-33を区別する。
Go to LineはCtrl+GとF1の`Go to Line/Column...`から開き、行と列を指定して移動する。
無効値は移動せず、範囲外の行・列はMonaco標準の有効範囲へ補正されることを確認する。
同名のred/blue文書を別フォルダから開き、blueでF1→Go to Line→`:3:1`→Enter→`changed_`入力→Undo、redへ切替→Ctrl+G→`:2:1`→Escapeを行う。
タブ往復を繰り返し、Escapeで入力欄が閉じ、開始位置と選択へ戻り、本文・Undo履歴・別文書の位置と選択が保たれることを確認する。
入力中のタブ切替・閉鎖、F1の`>`とGo to Lineの`:`の切替、候補の上下移動、既存FindのEscapeも確認する。
Chromiumでの自動検証はnativeの合格にせず、#1445の版・ホスト別受入結果へ記録する。
状態：M/V各未実施。記録：未記入。

### GUI-28：Quick Fix・定義移動・sort

対応：#1259。対象・入力：M/V、未定義・quoted/flow/alias/同名field、値・コメント・CRLF・補助平面文字。
操作：Quick Fix、直接移動、各選択方式のsort、拒否、Undo/Redo、保存後他hostでOpenを行う。
Mは未定義ID上のQuick Fixまたは右クリック／F1の`Insert PFDSL definition`を使い、挿入した`label: ""`の空の引用符の内側にcursorが置かれることと、produced artifactでcriteria案内が残ることを確認する。
`Sort metadata…`でPrimary keyとThenを順に選び、topological／group／index／idの単独と`group → id`を実行する。
重複キー・キーなしは編集せず理由を示し、Cancel／Escapeは本文・dirty・Undoを保ってeditorへfocusを戻す。
開いた整列フォームはその文書に所属し、他tabに切り替えても他文書を編集しない。
各成功後に1回のUndoで操作前の本文へ戻り、Redoで同じ結果へ戻ることを確認する。
Quick Fix候補の表示中に同じ文書を編集してから適用する時機を観測できた場合は、古い版の候補の拒否も記録する。
自動検査の版変更注入だけではこの実機変種を合格にせず、観測できなければ未実施として残す。
期待：token/rangeが正しく値・コメント・改行を保つ。
失敗は無変更、成功はUndo可能で、保存文書の意味が両hostで一致する。
状態：M/V各未実施。記録：未記入。

### GUI-29：整形・診断・extends

対応：#1259。対象・入力：M/V、LF/CRLF、FM跨ぎ選択、不完全入力、未保存entry、missing/cyclic/更新preset。
操作：全体／範囲をflow/flatで整形・Undo/Redoし診断code/severity/message/rangeを照合する。preset変更・欠落・循環と高速編集／tab切替を行う。
保存パスのあるentryで不存在の親、entry→親1→親2→親1の循環、不正な親YAMLを開き、Dependency problemsとGo to Next Problemでcode・対象file・理由を読む。
依存先の座標をentry本文の位置と誤認させず、正常なstatusStyles継承への修正後は依存表示が消えることを確認する。
期待：形式と選択境界が合い、authored未保存source/診断と依存診断を分離する。
lenient表示と一度読んだ同じ依存snapshotを使い、別tabへ古い結果を漏らさない。
Mでは`Current diagnostics`が最新snapshotの件数を示し、解析待ちは`Checking…`へ切り替わることを確認する（#1516）。定義追加後のW002入力案内が`Last action`に表示された後、criteriaを入力し、古い案内が消えて最新warning数が減ることを確認する。遅延した旧版の解析失敗と閉鎖済み文書の結果は現在診断へ表示しない。
状態：M/V各未実施。記録：未記入。

## 外部参照・構造差分・command

### GUI-30：参照の実到達先

対応：#1260。対象・入力：M、location/subflow/相対・絶対basePath、PFD/外部file/URL/複数候補directory、空白・引用・日本語path。Vは既存内部open回帰。
操作：sourceのCommand-click、node hoverのlocation/subflow link、previewのCommand-clickで起動先と実fileを照合する。
directory直下にfileがある場合と、直下にfileがなく子directoryを再帰する場合で候補選択／Escape／取消を試し、symlink directory、不在／権限拒否も確認する。
読める子directoryと権限拒否の子directoryを並べ、読める側の候補を選択・取消できることを確認する。
全候補が読めない場合は権限エラー、読めるが空の場合は`No files found`となり、本文・dirtyを変えないことを確認する。
相対locationはdocument directory＋相対basePath、絶対basePathは無視、subflowはdocument directory基準を照合し、Untitledの相対参照はSave案内になることを確認する。
候補読取中の編集／tab切替／closeと、preview更新前の参照操作では古い結果を開かないことを確認する。
期待：MのPFDは内部tab、他fileは既定app、URLは既定browserへ届く。
VをMの規則へ一律変更せず、取消・失敗で本文/dirtyを保ち理由を示す。
表示リンクやmock成功だけで完了にしない。
状態：M/V各未実施。記録：未記入。

### GUI-31：Git／別file構造差分

対応：#1260。対象・入力：M/V、repo/ref・別file・未保存A、node/edge差分・metadataだけの差分。
操作：F1またはeditor context menuの`Compare structure with file…`／`Compare structure with Git ref…`で比較し、baseline表示とbaseline→currentの方向を読む。
label/statusだけの変更とnode/edge変更を分けて確認し、比較後の編集反映、`Clear structural comparison`またはbannerの解除、読取中編集／tab切替／close、取消、不正ref／失敗を試す。
1180×812、sidebarなし、source50%でcriteriaだけ異なる1行の差分と複数行の差分を読む。
短いパスと長いパス、source70%・90%、898px幅でも、比較案内と差分一覧が別領域にあり、全行とClear comparisonへ到達できることを確認する。
期待：現在側は未保存内容で正しい対象を比較し、承認済みの現行VS Codeと同じmetadata比較を含める。
source/dirty/Undoを表示だけで変えず、古い結果を新対象へ適用しない。
GUI-07の保存競合text比較を前提にしない。
Mでは比較読取失敗を現在診断と混同せず`Last action`として読み、再比較成功またはClearでその通知が消えることを確認する（#1516）。比較読取中の本文編集・別tab切替・閉鎖後に旧処理が失敗しても、新しい文書や版へエラーを表示しない。
状態：M/V各未実施。記録：未記入。

### GUI-32：Git不在と単独file

対応：#1260。対象・入力：M、Gitあり／なしの試験環境、repo外単独file。
操作：通常起動と、検証用processだけのPATHからGitを除いた起動を分け、Git比較の理由／導入案内を読む。
例えば候補appのexecutableを絶対path指定し、その子processだけ`PATH=/nonexistent`で起動する。
system設定は変更せず、通常編集・保存・別file比較・全形式出力を続ける。
repo外単独fileではrepo判定失敗と別file比較の継続を確認する。
期待：定義したGit検出／repo判定に合い、Git非同梱で通常機能を阻害しない。
状態：M未実施。記録：未記入。不在を再現できなければ未実施。

### GUI-33：Terminal.app／Ghostty

対応：#1260。対象・入力：M、両terminal、空白・引用・日本語path/引数、複数行command、相対／絶対basePath、非秘密の環境値。
操作：commandを持つprocessへcursorを置き、F1/context menuの`Run process command in Terminal.app`／`Run process command in Ghostty`、Terminal.app用inlay hintの3導線で明示操作前の非実行と操作後の実到達先を確認する。
無害なprintfで引用符・日本語・複数行引数、pwdでcwdを照合し、`/bin/zsh -l -c`の通常login環境の非秘密値を確認する。
相対basePathのcwdと絶対basePath無視を確認し、cwd不在ならcommandが実行されず理由を示すことを確認する。
OSのAutomation許可／拒否、Ghostty不在・起動失敗、実行完了後に結果を読めることも試す。
期待：標準Terminal.app／選択Ghosttyの新しいterminalへ内容が届き、失敗理由と本文を保つ。
GUI processの環境や秘密値は転送せず、許可ダイアログの操作結果は自動検査の結果から推定しない。
内部terminalや終了codeによる自動進捗更新を追加せず、秘密値を記録しない。
状態：M未実施。記録：未記入。

## 書出し・配布・統合操作

### GUI-34：全形式の実出力

対応：#1261。対象・入力：M/V、全sample、日本語/font/style/status/preset/大きい図、未保存A。
操作：MはeditorのF1/context menuから`Export as DOT…`／`Export as SVG…`／`Export as PDF…`／`Export as PNG…`／`Export as TSV…`／`Export All (DOT, SVG, PDF, PNG, TSV)…`を実行し、basenameと保存先を選ぶ。
未保存編集後、previewのzoom/pan/focus/構造比較の各状態で全図を生成し、DOT構造/UTF-8、SVG全図/node/edgeと外部view、TSVの7列と値/tabを照合する。
MのSVG viewBoxを`x y W H`として、PNGのIHDR幅高は`ceil(W) × ceil(H)`pixel、DPR非依存・白背景を期待する。
MのPDFは1unitを72/96pointへ描画し、MediaBoxは`ceil(0.75W) × ceil(0.75H)`point、測定差は各軸0.1point以内、1page・全図・日本語の表示と文字抽出を期待する。
Vは既存Node/Puppeteerの寸法規約を維持し、PNGは各軸ceil pixel、PDFは`0.75W × 0.75H`pointを基準に各軸1point以内の印刷丸め差で照合する。
日本語はPDFKit/Preview等の外部viewerでも読み、SVGとPDF/PNGの全node・edge・長label・四隅を比較し、文字抽出だけで描画合格としない。
SVG/PDF/PNGのfont準備とpreset/style/statusを確認し、preset警告は結果へ残す。
期待：利用可能な実fileができ切れ・欠落がなく未保存対象が合う。
寸法規約は上記に固定し、両hostの意味／見た目／利用可能性で判定する。
Vの既存Node/Puppeteer公開APIとMのnative/browser経路を区別して記録する。
menu項目やbyte一致だけで完成にしない。
状態：M/V各未実施。記録：未記入。

### GUI-35：出力失敗と部分成功

対応：#1261。対象・入力：M/V、既存出力、新規／書込不能先、一部形式失敗、同名・日本語basename。
操作：Mのchooser／上書き確認の取消は全形式無書込と照合し、明示上書きは選んだ固定拡張子だけを置換する。
Allで既存の`<basename>.png`だけを読取専用にして選び、上書き確認後のPNG write-failedと他形式の成功・保存pathを独立に読む。
テスト後は使い捨てfileの権限を戻す。
Mは既存0600 fileの権限保持、symlink/非regular target拒否、選択後の外部更新、directory移動、stage失敗を試す。
Mの変換失敗は32768unit超の図によるPDF/PNG拒否を使い、DOT/SVG/TSV成功と区別する。
PNGの64megapixel超も黙って縮小しないことを確認する。
MのAllの保存開始後にtab切替／closeを行い、結果一覧へ元文書名・版・各形式の実保存pathまたは失敗理由が残り、明示Dismissまで読めることを確認する。
Mで保存先移動がpublication後に検出された場合は、書込み済みだがpath未確認の説明と実diskを照合し、成功pathとして扱わない。
Vは既存export chooserの取消、Puppeteer不在によるbinary変換失敗、読取専用PNGによる書込失敗を試し、Output channelと通知の形式別結果・実保存pathを実diskと照合する。
M専用のnative保存境界や結果panelをVへ要求しない。
期待：成功／警告／失敗と保存fileが一致し、部分成功fileを捨てず、source/dirty/Undoを変えない。
状態：M/V各未実施。記録：未記入。不在の故障APIを前提にしない。

### GUI-36：追加runtimeなしのMac出力

対応：#1261/#1262。対象・入力：M、Node/Graphviz/Puppeteer/独立browser/開発tool/Gitを追加導入しない検証Macと候補app。
操作：GUI-34の単体とAllを生成し、既定外部viewerで開きbundle/依存/font/WebKit/PDF APIを記録する。
PDFの専用WKWebViewとPNGのcanvasが使われ、Node sidecar/Puppeteer/Chromiumの実行・同梱がないことをbundleとprocessで確認する。
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
GUI-27のhover再試験も同じ対象版で行う（#1513）。配布物のSHA-256、OS・WebKitGTK版、CPU実行方式、X11/Wayland・描画環境、fixtureのSHA-256、操作時刻を固定する。撮影なし／撮影あり／自動キー操作を区別し、labelのみ・criteriaのみ・group＋criteria・descriptionありを比較する。アプリ・network・WebKitWebProcessのPIDと終了時刻、stderr、利用できるexit status・signal・crash/core・OOM情報を保存する。元ホスト、別Linux、Macの結果は別行に残す。プロセス存否だけで原因を断定せず、非再現だけで解消扱いにしない。
状態：L未実施。記録：未記入。Mac/V公開ゲート外で正式Linux対応に広げない。

## 実装時の具体化

GUI-06/14/31の時機再現、GUI-13/15の共有編集API差分、GUI-34/35の寸法・許容差・部分失敗、GUI-39/40/43の下限OS・更新・長時間条件を各担当PRで確定する。
試験対象と期待結果は上記を維持し、未確定の実行手段を合格とは扱わない。
通常の自動test・CIと、共通受入Issueから辿る担当Issueの実装契約を維持する。
新しい試験管理システム、状態機械、網羅性判定器や証跡基盤は導入しない。

#1444の変更束ではGUI-01〜07/09〜16の入口と共有APIを上記へ具体化した。
2026-10-15の開発browserで、新規入力、分割線50→60、Connectionsの中心移動、新規作成＋接続と1回のUndo/Redo、図からsourceへの移動、Fit/100%/zoomを別agentが盲検操作した。
実行時はこの変更束の未commit作業版であり、native menu・実ファイルI/O・VoiceOver/IME・VのExtension Development Host・公開済みbundleは未実施である。
ブラウザでは文書作成後のnative New入口がないため、2文書操作はこの観測の範囲外であり、自動hostテストのtab切替検査とも区別する。
試験中の開発サーバーreloadによる試験文書の消失は、再作成後に再試験し、製品の保存／復旧欠陥とは数えない。
GUIの状態欄と#1445の未実施は、このbrowser観測と自動検証だけでは合格へ変更しない。
