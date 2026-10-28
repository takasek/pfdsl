# pfdsl standalone デザインレビューと課題分析

保存版注記：2026-10-28 の Claude 評価から pfdsl の論点を保存した。別製品の利用過程だけを省略し、model は提案モデル内の条件を表す。画像・操作の生記録はローカル原本に保持し、公開保存には含めない。モデル内の問題を実アプリの既存不具合として扱わない。


対象は pfdsl `d1b5db85ecdb9344a5ed6fff2f1b17632a8ec6e6` の standalone（Tauri）アプリ。
評価日は 2026-10-28、評価者は Claude（Opus 5.5）で、ほかの評価者の成果物・過去の pfdsl レビュー・`docs/reviews/`・`packages/standalone/ACCEPTANCE*.md`・`evidence/`・`acceptance-kit/` は読んでいない。
読んだ製品文書は `packages/standalone/README.md` の見出し一覧・1–58 行（起動前）と、実操作の後に読んだ 59–131 行・272–400 行、`docs/spec/spec.md` の見出しと §5（ID 種別推論）だけ。

## 証拠の種類

各観察に次の札を付ける。
札のない一般論は書かない。

| 札 | 意味 |
| --- | --- |
| native | release ビルドの .app を実画面で操作した観察（背景操作。キー入力は一部しか届かない） |
| browser | Vite dev server を Claude Code 内蔵ブラウザで操作した観察。保存不可の browser-only モード |
| code | 固定版のソースで確かめた挙動 |
| cli | 固定版の `pfdsl check` で確かめた結果 |
| model | 設計モデルの操作から得た条件（実装の正しさの証拠ではない） |
| 推測 | 上のどれでも確かめていない判断 |

browser での成功は native の保存・読込・ウィンドウ操作の成功として扱わない。
F1・F8・hover・右クリックメニューは browser でだけ確かめており、native の macOS で F キーが fn を要するか・システムに取られるかは未確認。

## 結論の要約

日常の「書く → 図で確かめる → 直す」の往復は、editor と図の双方向同期と Connections パネルのおかげで小さな文書では快適に成立している。
保存衝突でデータを失わない設計も、文言を除けば信頼できる。
一方で、次の3点が日常作業を最も妨げている。

1. 診断を見つけて直す作業が成立しにくい（A1）。件数しか出ず、グラフ検査の警告は 1 行目に付き、図には印がなく、typo は警告を減らしながら黙って新 node を作る。
2. 実務規模の図（700 行級）は Fit すると読めず、図の中を探す手段がない（A2）。
3. 書き出し・行移動・定義移動・比較などの機能が、F1 と editor の右クリックにだけあり、macOS のメニューバーから辿れない（A3）。機能が無いのではなく、入口が見えない。

重要度（作業を妨げる程度）は A1 → A3 → A2 → A4 → A5 → A6 → A7 とする。
着手順は重要度と少し違い、A3 を先にする（末尾の「推奨する順序」）。
A3 は既存コマンドをメニューへ配置し直すのが中心で、費用が小さく、A1 の診断一覧や A2 の図内検索の入口もそのメニューに載るためである。
A2 は効果が大きいが、概観表示には設計判断と費用の見積もりが要る。

## 最初の印象（コード・README を見る前）

- 空状態は静かで目的が一文で分かるが、3 つのボタンが素の HTML 風で主従がない（native `01`）。
- 文書を開くと、図が 18% に縮んで読めず、上下に絶対パスが繰り返され、下端に件数だけの診断と常駐の通知が出る。「読む場所」より「状態の文字」が先に目に入る（native `03`）。
- node をクリックすると editor と Connections が同時に追従し、ここで初めて道具の芯（ソースと図の往復）が伝わる（native `05`）。
- 時系列の記録はローカル原本の `work/observation-log.md` の「browser-dev: 初回」「native-release」節。

## 作業ごとの結果

| 作業 | 面 | 結果 | 補足 | 証拠 |
| --- | --- | --- | --- | --- |
| 文書を開く（フォルダ・Recent） | native | できた（条件付き） | Open パネルは自動操作の制約で完遂できず、Recent を事前に用意して開いた | native `02` |
| 文書を開く（Finder から） | code | 機能がない | open event・document type なし。実画面は未確認 | A6 |
| 編集して図を確かめる | native | できた | 打鍵で図と Connections が即時更新、dirty 表示も 3 箇所に出る | native `08` |
| 保存する | native | できた | File › Save でディスクへ反映（diff で確認）。Save As は未確認 | native `09` |
| 外部変更と衝突 | native | できた | データを失わない。語彙と起点別の結果表示に課題（A4） | native `10`–`13` |
| 診断を見つけて直す | native/browser | 詰まった | 一覧なし、位置は 1 行目、typo は警告を減らす。F8 の peek は browser でだけ確認 | A1 |
| ソース ↔ 図の往復 | native | できた | caret → 図、node → 定義行の双方向同期が強い | native `05`・`07` |
| 図全体と個別の対象 | native | 詰まった | 大きい図は Fit で読めない。Focus selected node で個別は読める | A2 |
| 検索・参照移動 | native/browser | 発見後に評価変更 | 最初はメニューに無く「無い」と判定。README と右クリックで Go to definition・occurrence 移動・Find all を見つけ「入口が見えない」に変更。図内検索は無い | A3 |
| 書き出し・比較・行移動 | browser | 発見後に評価変更 | F1 と右クリックにだけある。native での実行は未確認 | A3 |
| ウィンドウ・ペインの幅を変える | native/browser | 詰まった | splitter は動くが再 Fit なし。狭い窓で editor が先に潰れる | A5 |
| 閉じる（未保存） | native | できた | 標準 alert。衝突中は review を経て閉じる | native `12` |

## 守るべき既存の性質

提案はこれらを壊さないことを条件にする。

- P1 editor の caret 移動 → 図の選択・パン・Connections の追従、node クリック → editor の定義行への移動という双方向同期（native、`07`・`05`・`16`）。
- P2 Connections パネルで入出力を一覧し、その場で接続を編集できること（native `05`、README 59–79 行）。
- P3 保存衝突で editor 内容を捨てず、差分を見せてから明示的に決めさせること。閉じる途中の Save が衝突 review を経由し、決定後に閉じる意図を最後まで引き継ぐこと（native `10`–`13`、ディスク内容を diff で確認）。
- P4 未編集の文書は外部変更を自動で取り込み、Undo で Saved に戻ると dirty が解除されること（native）。
- P5 未定義 ID を許すラフな書き方（spec §5.1「未確定IDは Artifact とみなす」）。typo を error にする方向の解決は取らない。
- P6 VS Code 拡張と desktop の診断（位置を含む）の一致。README「Verification」は adapter snapshot で positions まで比較している。診断位置の修正は core で行い、両面を同時に変える。
- P7 図は bundled Graphviz WASM で描き、外部依存を持たないこと。

## 課題一覧

| ID | 課題 | 影響する作業 | 重さ | 主な証拠 |
| --- | --- | --- | --- | --- |
| A1 | 診断の発見・特定・修正の導線がない | 診断を見つけて直す | 高 | native, browser, code, cli, model |
| A2 | 大きい図が Fit で読めず、図の中を探せない | 図全体と個別対象の確認、参照移動 | 高 | native, code |
| A3 | 主要機能の入口が Monaco 内に閉じ、メニューバーにない | 書き出し・行移動・定義移動・比較・検索 | 高 | native, browser, code, HIG |
| A4 | 状態表示が分散・重複し、衝突 UI の語彙と起点が分かりにくい | 保存・衝突解決・閉じる | 中 | native, browser, model |
| A5 | 狭い幅で主作業領域が先に潰れる | ウィンドウ・ペイン幅の変更 | 中 | native, browser, HIG |
| A6 | Finder・Recent との統合が macOS の慣習とずれる | 文書を開く | 中 | native, code, HIG |
| A7 | 視覚言語の統一感と主従が弱い | 図とソースの読み取り全般 | 低〜中 | native, code |

## A1 診断を見つけて直す導線

### 観察

- native/browser: 下端に「Current diagnostics — <絶対パス>: 0 errors, 8 warnings, 0 informational messages」と件数だけが出る。押しても何も起きず、一覧を開く場所は見つからなかった（native `03`）。
- code: `document-tab.ts` は依存先の診断（`dependencyProblems`、81–83 行で section を作り 306–311 行で行を描く）には一覧要素を描くが、文書自身の診断には件数文字列と Monaco の marker（312–328 行）しか作らない。機能が「無い」に分類する。
- browser: typo `idea >> desgn` で出た警告「Process 'desgn' has no outputs (V003)」の波線は 1 行目の `---` に付き、typo のある 6 行目には印がない（browser `03`）。F8 の peek 見出しは「document-1 · 1 of 1 problem」と内部名を出す（browser `04`。未保存の Sample で確認。ファイルのある native の文書で同じ名前になるかは未確認）。
- code: core の検査ルールは診断の多くを `zeroRange()` で出す。静的に数えると、`rules/*.ts`・`validator.ts` 等で 41 コード（N001–N004、V001–V012、V014–V028、V030–V035、W001・W003・W006・W008）が位置 0 で出る箇所を持ち、実位置を持つのは V029・V035・V036・W002・W004・W007 の 6 コードだけ（集計結果は `evidence/diagnostic-ranges.txt`）。V002/V003 は `packages/core/src/rules/completeness.ts` の `processCompleteness`（36–38 行・46–48 行で `range: zeroRange()`）。集計は awk による静的な走査で、同じコードが別の箇所で実位置を持つ場合（V035 など）は両方に数えている。後段で位置を付け直す処理は core・editor・preview-engine に見当たらない。
- browser/native: 図の node には警告の印がない。node hover は「desgn / kind process」で警告に触れない（browser `08`）。
- native/cli: `venue_contract` を `venue_contractX` に打ち間違えると、図に新 node が group の外へ増えるだけで、行に波線はない。警告数は 8 → 7 に減った（native `20`）。cli で前後を比べると、`venue_contract` が「どこからも作られない成果物」になって W002（criteria 欠如）が消えたためで、typo そのものには診断が出ない。
- native: その行の電球の Quick Fix は「Insert artifact definition for "venue_contractX"」だけで、既存の `venue_contract` へ直す候補はない（native `21`）。
- model: 現状モデルで「typo を見つけて直す」を辿ると、件数表示から先へ進む操作が 0 件で、peek→閉じる→検索→打鍵の 7 操作になり、peek が示す位置と直す位置が一致しない。

### 影響する作業

診断を見つけて修正する作業全般。
とくに大きい文書では 1 行目に集まった波線から該当 ID を探す手間が増え、typo は件数の減少として現れるため「直った」と誤認しうる。

### 解決案

1. 診断一覧を設ける（無いものの追加）。下端の件数を押すと、editor 下か preview 下のペインに一覧を出す。各行は「重さ・コード・メッセージ・対象 ID」を持ち、選ぶと editor が参照行へ、図が該当 node を読める倍率で示し、Connections が開く。View メニューと ⇧⌘M 相当の項目も付ける（ショートカットの具体値は 推測）。
2. 診断の位置を core で付ける。V002/V003 なら対象 process の定義位置または flow 上の初出参照、V001 なら重複する `->` の位置など、ルールが既に持つ ID から source 位置を引く。VS Code 拡張も同時に改善される（P6）。
3. 図に診断を重ねる。警告・エラーのある node に小さな印を付け、hover に診断文を足す。
4. typo らしい ID を「見える」ようにする（P5 を守る）。対象は「定義がなく、かつ文書内の定義済み ID と綴りが近い ID」に限る。定義を一つも持たない Sample のようなラフな文書では何も変えない。該当 ID は図で点線枠などの別表現にし、editor では情報レベルの下線と「Did you mean venue_contract?」の Quick Fix を出す。Quick Fix は近い既存 ID への置換を先頭に、定義の挿入を二番目に並べる。
5. peek・一覧の見出しは「document-1」でなく文書名（未保存なら Untitled 等）を使う。

### 守る性質

P1（一覧の選択も同じ双方向同期に乗せる）、P5（未定義 ID は許したまま見える化する）、P6（位置は core で付ける）。

### 未確認事項と判断を変える条件

- native で F8・hover・peek が同じに動くか（browser でのみ確認）。native で F8 が届かないなら、一覧の必要性はさらに上がる。
- 位置 0 の各コードについて、正しい位置を一意に決められるか。V010（循環）のように複数箇所にまたがるものは「代表位置＋関連位置」の形が要る可能性があり、Monaco の relatedInformation で足りるかで実装量が変わる。
- 「定義済み ID と綴りが近い」の判定（編集距離・大小文字・区切り文字）の誤検出率。ID 命名が似通う実務図（`cli_release_request` と `libraries_release_request` など）で誤検出が多いなら、図の別表現はやめて Quick Fix の並び順だけを変える。
- model 由来の条件: 問題を解消したら、選択は「問題」から node（またはなし）へ落とし、一覧から行を外す。一覧は modal の衝突 review 中は不活性にする（下の「model から得た条件」）。

## A2 大きい図の読み取りと図の中の探索

### 観察

- native: `.pfdsl/workflow.pfdsl`（約 750 行）を開くと Fit で 11.6%、sidebar を隠し preview を全幅近くにしても 17.1% で、node の文字も group 名も読めない（native `14`・`15`）。conference-ops（138 行）でも初期表示は 18.5% で読めない（native `03`）。
- native: splitter で preview を広げても倍率は変わらず、Fit を押し直す必要がある。code: standalone/preview-engine に ResizeObserver による再 Fit は見当たらない。
- native: 図の中を検索する入口はない（無い）。Edit › Find（editor 検索）で語を探すと caret 追従で該当 node に青枠が付き図がパンするが、倍率は 17% のままで読めない（native `16`）。
- native: Focus selected node は 100% で中央に置き、読める（native `06`）。ただし選択と Focus が別操作。
- browser: caret が 1 行目へ移ると、5 node の小さな図でも左端が画面外に出るパンが起きた（browser `03`・`04`）。全体が見えている状態を caret 追従が崩す。
- native: Connections を開くと preview の高さの約半分を取り、図領域がさらに狭まる（native `05`）。

### 影響する作業

図全体の把握、個別の node の確認、参照の移動。
実務の運用図（workflow/pipeline/roadmap）は日常の主対象であり、そこで図が「地図」にしかならないのは本製品の中心価値（Write a process. See the flow.）を損なう。

### 解決案

1. 段階のある全体表示。Fit 後の倍率が読める下限（例えば文字が 9–10px 相当になる倍率。値は 推測）を下回るときは、node 文字の代わりに group 名と件数を大きく描く概観表示にし、group をクリックすると読める倍率でその group に寄る。
2. 図内検索（無いものの追加）。preview のツールバーに検索欄を置き、ID と label の部分一致で候補を出し、選ぶと読める倍率で Focus する。⌘F は editor と preview のうちフォーカスのある側に効かせる。
3. 選択と Focus の結合。editor 検索・一覧・Connections から node を選んだとき、現在の倍率で読めなければ読める倍率まで寄る。逆に、図全体が見えている間は caret 追従でパンしない。
4. 幅変更時の再 Fit。直前が Fit 状態なら、preview の大きさが変わったら Fit をやり直す。
5. Connections は図に重ねる浮動パネルか、editor 側へ寄せられる配置にし、図の高さを常時半分にしない（配置の最終形は 推測、比較が要る）。

### 守る性質

P1（同期）、P2（Connections の情報と編集）、P7（Graphviz 描画）。
概観表示は描画結果の拡大縮小で実現し、レイアウトを別エンジンに置き換えない。

### 未確認事項と判断を変える条件

- 実際の利用者が workflow 規模の図を「全体を読む」のか「一部を確かめる」のかの比率。後者が大半なら、概観表示より図内検索と自動寄せを先にする。
- Graphviz の SVG で group 単位の概観を描く費用。cluster の bbox が取れるなら安い。取れなければ図内検索を先にする。
- 読める下限倍率の値は、日本語 label を含む実図で実測していない。

## A3 機能の入口をメニューバーへ

### 観察

- native/code: メニューバーは File（New, Open…, Open Folder…, Recent, Close Tab, Close Window, Save, Save As…）、Edit（Undo〜Select All, Find, Format ▸, Create Definition）、View（Show Sidebar, Fit, Actual Size (100%), Zoom In, Zoom Out, Increase/Decrease Text Size, Normalized edges, Connections）、Window、Help（Diagram Help）だけ（`packages/standalone/src/native-menu.ts` 100–160 行）。Fit・Zoom にはショートカットがない。
- README 59–131 行と browser `05`・`06`: Export（DOT/SVG/PDF/PNG/TSV/All）、Go to Line/Column（Ctrl+G）、Go to PFDSL definition、Next/Previous PFDSL node occurrence、Find all text matching this node、Insert PFDSL definition、Sort metadata…、Compare structure with file…/Git ref…、Run process command in Terminal.app/Ghostty は、F1 の Command Palette と editor の右クリックメニューにだけある。機能は「有る」が入口が「見つからない」に分類替えした。
- browser: 右クリックメニューには Monaco 標準の「Go to Definition ⌘F12」と「Go to PFDSL definition」が並び、どちらを使うべきか分からない（browser `06`）。F1 のパレットには汎用 editor コマンドと PFDSL コマンドが混在する（browser `05`）。
- browser: browser-only モードでも「Run process command in Terminal.app/Ghostty」が出る。

### HIG との照合（2026-10-28 に Apple HIG の本文を取得。以下は要旨）

- The menu bar（HIG）: ほかの場所から使えるコマンドもメニューバーに載せることが大切で、高度・低頻度のコマンドでも外すと見つけにくくなる、という趣旨。
- 同ページの File メニューの標準項目に「Export As…」（名前・保存先・形式を尋ねる）と Open Recent（通常は Clear Menu を含む）がある。
- Keyboards（HIG）: Control キーを修飾キーに使うのは避けるよう求め、⌘G は選択の次の一致を探す標準ショートカットとしている。Ctrl+G の Go to Line はこの点で慣習から外れる。
- ⌘0／⌘+／⌘− によるズームは Keyboards の標準表に無かった。ズームのショートカットは HIG の規約でなく、他の図・文書アプリの慣習として扱う（記憶による・未照合）。

### 影響する作業

書き出し、行移動、参照・定義移動、比較、process command の実行。
README を読むまで、私はこれらを「無い機能」と判定していた。

### 解決案

1. File に「Export ▸」（DOT…, SVG…, PDF…, PNG…, TSV…, All Formats…）を置く。macOS の慣習に合わせ「Export As…」一項目から形式を選ぶ形も候補。
2. 新しい「Go」または「Navigate」メニュー（名前は 推測）に Go to Line…（⌘L 等、Control を使わないもの。具体キーは 推測）、Go to Definition、Next/Previous Occurrence、Find All Occurrences を置く。Monaco 標準の Go to Definition は PFDSL の定義移動に統合し、右クリックの重複を除く。
3. Edit に Insert Definition（既存の Create Definition と名前を揃える）、Sort Metadata…、Toggle Comment（⌘/）。
4. View に Compare Structure ▸（With File…, With Git Ref…, Clear）。Fit・Actual Size・Zoom In/Out にショートカットを付ける。
5. 新しい「Process」メニューか Edit 内に Run Process Command ▸。browser-only では出さない。
6. F1 のパレットは補助として残す。メニューにある項目は同じ名前で出す。

### 守る性質

Monaco の Command Palette（既存利用者の手順）を消さない。
menu の enabled 状態は既存の `MenuState` 更新の仕組みに載せる（code: `native-menu.ts` の `updatePendingState`）。

### 未確認事項と判断を変える条件

- native で F1・Ctrl+G・⌘F12 が実際に届くか。届かないなら優先度は A1 より上になる。
- Edit › Create Definition が背景操作で disabled だった理由（前面でない・caret 位置の条件）は未確認。

## A4 状態表示の整理と衝突 UI

### 観察

- native: 絶対パスの全文が上端右・下端の diagnostics 行・「Last action — <絶対パス>: Saved.」・「Application notice: Opened <絶対パス>…」に繰り返し出る（native `08`・`09`）。README は上端の位置表示を「1 行で末尾を省略、title に全文」と仕様化しているが、狭い幅ではファイル名側が切れる（native `17`、A5）。
- native: 保存後に下端が 1 行から 3 行に伸び、editor と preview が縦に動く（native `09`）。「Application notice … Save documents explicitly.」と「Dismiss action notice」は Open Folder 後ずっと常駐する。
- browser: 未保存の Sample では上端左「Not saved」と右「Not saved to a file」が並び、同じことを二度言っているように読める（browser `01`）。README の設計では左が状態・右が位置なので、位置欄が「ファイルがない」ことを状態の言葉で言っているのが原因。native の未保存文書で同じかは未確認。
- native: 衝突 review は見出し「Review the target」、長い説明段落、ボタン「Keep Editing / Choose Another File / Replace Observed Version」。Keep Editing 後の帯は「The disk changed. Your editor content is retained. Recovery target: <絶対パス>」（native `10`・`11`）。target・observed・recovery target は利用者の語彙でない。差分は先頭行から表示され、変更箇所（91・96 行）へは自分でスクロールした。
- native: 未保存で Close Tab すると標準 alert「Save changes to conference-ops-edit.pfdsl?」Save / Discard / Cancel（native `12`）。
- model/native: 保存から来た review と、閉じる途中から来た review は、見出し・説明・ボタンが同一だった（native `10` と `13`）。しかし「Replace Observed Version」の結果は、前者は保存して残り、後者は保存してタブが閉じる。設計モデルで両者を同じ確認画面として書いたら「閉じる途中」がモデルから消え、ここで初めて差に気付いた。

### HIG との照合

- Alerts（HIG）: ボタン名は押した結果を表す 1〜2 語にし、説明文は価値を足すときだけ付ける、という趣旨。今回取得した本文に「Don't Save」の規定は無かったため、Discard を Don't Save にすべきという主張はしない（記憶による・未照合）。
- 上の「結果を表すボタン名」の観点では、閉じる途中の review の「Replace Observed Version」は結果（保存して閉じる）を表していない。

### 解決案

1. 位置表示は上端だけに置き、「文書名 — 親フォルダ」とする。全文はツールチップと「Reveal in Finder」相当で出す。下端の各行からパスを外し、文書名にする（同名タブだけ親フォルダを足す既存規則を流用）。
2. 下端は高さ固定の 1 行にし、最後の操作の結果と通知は一定時間で消すか、件数の横の小さな履歴ボタンにまとめる。Open Folder の通知は一度出したら消す。
3. ファイルのない文書の位置欄は「Untitled」など位置の言葉にし、状態欄の「Not saved」と重ならないようにする。
4. 衝突 review の見出しとボタンを起点ごとに変える（model 由来）。保存から: 「The file changed on disk」＋「Keep Editing / Save As… / Overwrite」。閉じる途中から: 「Save your version and close?」＋「Don't Close / Overwrite and Close / Close Without Saving」等（文言は 推測、英語 UI の語感は要確認）。
5. 説明段落は一文にし、差分は最初の違いの位置で開き、違いの数を示す。
6. 「Recovery target」は「Saving to: <文書名>」程度の語にする。

### 守る性質

P3（データを捨てない、review の決定は観測した版にだけ効く、閉じる意図の継続）。
文言を変えても、決定が「その時点で見た editor とディスクの版」に限られる既存の厳密さ（README 324–325 行）は保つ。

### 未確認事項と判断を変える条件

- Save As… を含む native の保存ダイアログ（NSSavePanel）は操作できず未確認。
- 通知の自動消去は、保存失敗などの重要な通知を見逃す恐れがある。失敗系だけ残す規則で足りるかは、失敗時の表示を実画面で見ていないため未確認。

## A5 狭い幅への適応

### 観察

- native: Window › Move & Resize › Top Left（約 900×565）で、editor と preview の比は維持され editor は約 190px。sidebar を出すと sidebar は約 225px 固定のまま editor が約 145px になり、「label」「descr」しか見えない（native `17`・`18`）。
- native: 上端のパスは末尾から切れ「…/repo-pfdsl/wor…」となり、ファイル名が消える。下端は diagnostics が 2 行に折り返し、notice と Dismiss ボタンも別行で約 90px を取る。minimap は preview の 1/4 近くを占める。
- native: 狭い editor では Find widget が潰れ、入力欄に語の末尾しか見えない（native `16`）。
- browser: 幅 700px で preview の toolbar が 2 段に折り返し、図は 100% のまま右が切れる（browser `07`）。
- code: `tauri.conf.json` に minWidth/minHeight の指定はない。

### HIG との照合

- Sidebars（HIG）: ウィンドウの大きさの変化に合わせて sidebar を自動で隠したり出したりすることを検討するよう勧め、Mail の例を挙げている。

### 解決案

1. ウィンドウ幅が閾値を下回ったら sidebar を自動で畳む（再び広げたら戻す）。
2. editor と preview に最小幅を設け、両方が満たせないときは片方をタブ切替（Source / Diagram）にする。今の比率維持は、広い画面での使い勝手を保つため閾値以上でだけ使う。
3. パスの省略は中央省略にし、ファイル名を残す（A4-1 で上端の表示自体を短くするなら不要）。
4. preview の toolbar は幅不足時に二次項目を「…」メニューへ畳む。minimap は小さい preview では既定で隠す。
5. ウィンドウの最小サイズを設定する（値は 推測）。

### 守る性質

editor と preview を同時に見られること（広い画面）。splitter のキーボード操作（README 276 行）。

### 未確認事項と判断を変える条件

- 13 インチ画面での既定ウィンドウ（1280×800）と sidebar 併用時の実際の窮屈さ。既定サイズで editor が 400px を切るなら、閾値は既定サイズより上に置く必要がある。

## A6 Finder・Recent との統合

### 観察

- code: `src-tauri/src/*.rs` に `RunEvent::Opened` の処理がなく、`src-tauri/native/`（`pdf.m` のみ）にも `openFiles`/`openURLs` 等の処理がなく、`Info.plist`・`tauri.conf.json` に document type の宣言がない。Finder のダブルクリック・「このアプリケーションで開く」・Dock へのドロップで .pfdsl を開けない見込み（実画面は未確認）。
- native: File › Recent の項目は絶対パスの全文で、フォルダは「Folder: <absolute path>」。名前は「Recent」で Clear Menu はない。
- native: sidebar は .pfdsl だけを枠付きボタンで並べ、サブフォルダは「repo-pfdsl/pipeline.pfdsl」と平坦化し、companion の .md や .svg は出さない（native `02`）。長い名前は末尾が切れる。

### HIG との照合

- The menu bar（HIG）: File メニューの標準項目に Open Recent があり、通常は Clear Menu を含む。
- Sidebars（HIG）: 内容が多いときは disclosure で階層をまとめ、階層は概ね 2 段までにする、という趣旨。

### 解決案

1. .pfdsl の document type を宣言し、open event で既存のタブ機構へ渡す（既存の capability 管理を経由）。
2. 「Open Recent」に改名し、項目名はファイル名（同名のみ親フォルダ）、Clear Menu を付ける。
3. sidebar はフォルダ階層を disclosure で表し、項目は source list の行（枠なし）にする。.md 等は読み取り専用で外部アプリへ渡す選択肢を検討する（.pfdsl の companion を同じ場所で開ける利点がある。範囲は 推測）。

### 守る性質

選択したフォルダ単位の capability 境界（README 307–308 行）。Recent は内容を保存しない（README 315 行）。

### 未確認事項と判断を変える条件

- document type と open event の追加が、選択ディレクトリ単位の capability モデルとどう整合するか（Finder から渡されたファイルの親ディレクトリを capability として扱えるか）。整合しないなら、まず「Open Recent」の改善だけを行う。

## A7 視覚言語

### 観察

- native/code: 図は Times 系 serif（`packages/graphviz-exporter/src/label.ts` が Times New Roman の字幅表を持つ）、UI は system sans-serif。日本語 label は serif で描かれる。
- native: node は ID（英字）を上段、label（日本語）を下段に描き、ID が主になる（native `06`）。
- native/browser: ボタンは枠付きの素の外観で、空状態の New / Open… / Try a sample に主従がない（native `01`）。
- native: sidebar の各ファイルが枠付きボタンで、一覧として読みにくい（native `02`）。

### HIG との照合

- Typography（README.txt の要約経由。本文は今回取得していない）: 少数の書体による一貫性とシステムフォント。

### 解決案

1. 図の既定書体を system sans（日本語は Hiragino Sans 系）にし、字幅計算もそれに合わせる。書き出しの再現性のため、書き出しは同梱 font を使う選択肢を残す。
2. label がある node は label を主、ID を従（小さく灰色）にする表示設定を設け、既定を label 主にするかを検討する。
3. 空状態は主ボタン（New）を強調し、Open… と Sample を従にする。sidebar は A6-3。

### 守る性質

P7。書き出し（SVG/PDF/PNG）の再現性。

### 未確認事項と判断を変える条件

- label 主の表示で、ID を source と照合する作業（Connections・検索）が遅くならないか。ID を頻繁に打つ利用者が多いなら ID 主を既定に残す。
- 書体変更が既存の書き出し結果を変えることへの許容度。

## model から得た提案条件

設計モデルの検討で、実画面の観察だけでは出てこなかった条件を得た。
モデルが通ったことは実装の正しさや見た目の品質の証明ではない。

- M1（A4）: 衝突 review は起点（保存／閉じる）ごとに、決定の後に何が起きるかを見出しとボタン名で示す。現状は同一画面で結果だけが違う（native `10`/`13` で確認済み）。
- M2（A1）: 問題を解消したら、選択を「問題」から node（またはなし）へ落とし、一覧から行を外す。選択と診断は独立に変わる軸なので、解消時の遷移を明示的に設計する。
- M3（A1・A4）: 診断一覧は浮動 overlay でなくウィンドウ内のペインに置き、modal の review 中は不活性にする。overlay にすると review 中も一覧から node を選べてしまう。
- M4（A1）: 現状は下端の件数表示から先へ進む操作が 0 件。件数は入口でなく行き止まりになっている。

## 推奨する順序（着手順）

1. A3 のメニュー整理（既存コマンドの配置換えが中心で、発見性の効果が大きい）。同時に Monaco 標準の Go to Definition と PFDSL 版を統合する。
2. A1 の core 側の診断位置（VS Code 拡張も改善される）と、診断一覧ペイン。M2・M3 を条件に含める。
3. A1 の typo の見える化（未定義 ID の表現、近い既存 ID への Quick Fix）。
4. A4 の衝突 review の文言と起点別表示（M1）、下端の高さ固定とパス表示の整理。
5. A2 の図内検索と選択時の自動寄せ、幅変更時の再 Fit。概観表示は費用を見積もってから。
6. A5 の sidebar 自動収納と最小幅、A6 の Open Recent。document type は capability 設計と合わせて検討する。
7. A7 は書き出し互換の方針を決めてから。

## 実施した検証と限界

- native: 自分専用の release .app（識別子だけ `--config` で `dev.pfdsl.claudereview.20261028` に上書き、ファイル変更なし）を背景操作で使った。開く・編集・保存・外部変更（未編集／未保存）・衝突 review・閉じる確認・大きい図・Find・splitter・sidebar・1/4 ウィンドウ・Normalized edges・typo と Quick Fix を確認した。
- native で未確認: Open/Save パネルでの選択（全画面 Space と背景操作の制約。全画面操作の承認要求 2 回は応答なし）、Save As、⌘ ショートカット全般、F キー、hover、IME、VoiceOver、Quit（⌘Q）時の確認、Export、Compare、Run process command、Finder からの起動。
- 開く操作は、自分の bundle id の `recent-documents.json` を事前に作り File › Recent から行った。
- browser: Vite dev server（127.0.0.1:14328）で hover・F1・F8・右クリック・幅 700px・node hover を確認した。browser の成功は native の成功として扱っていない。
- 自動操作の待ちや入力の取りこぼし（日本語の raw 入力が届かない等）は製品の問題に数えていない。
- 実画面の証拠と時系列の生記録はローカル原本に保持している。本文中の `native 03` 等はローカル原本の `evidence/native-03-*.jpg` を指す。
