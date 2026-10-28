# 実操作・検証記録

保存版注記：pfdsl に関する部分を抜粋し、その結論・優先度を保持した。絶対パスと資料リンクを保存先に合わせて加工した。収録していない根拠へのリンクは「原本限定資料」と表記する。原文のフォルダ・同梱への言及は全原本フォルダを指す。非リンクの相対ファイル名も、provenance.json の収録一覧にない場合は原本限定資料を指す。


対象版・環境は README。第一印象は UI 実装より先に保存した。起動 README の操作説明は既に読んでいたため、完全な初見ユーザーの評価とはしない。後半で実装を照合し、過去のレビュー結論を開始時の評価軸にしていない。

## T1 — 開始とサンプル（browser / native）

Start → Try a sample。ソース5行と3ノード図が表示された。ブラウザは1280×720、nativeは1280×800相当（画像2560×1600）。browser証拠（原本限定資料）。明快な開始と軽い学習例を確認。

## T2 — 編集・Save As・再編集・保存・再オープン（native）

Sample のソースを `idea >> design -> plan` と `plan >> build -> result` にして5ノードへ変更。Save As… → `<evaluation-output>/review-flow.pfdsl` を選択。Saved、タイトル、タブ、パスを確認し、実ファイルをシェルで読戻した。

後に Connections → design → Create definition → 空 label へ `Design the plan` を入力 → Command-S。ファイルの label と図表示が更新された。Close tab → File > Recent > 同パスで再オープンし、Saved / No problems / ラベルが戻ることを確認。再オープン画面（原本限定資料）、[AX](evidence/native-reopened.ax.txt)。

詰まり: Save As の最初の試行では Save が無効で、パス入力も親の tmp に留まった。ウィンドウを明示的に Raise して再度 Save As を開くと有効となり、保存できた。Open… は同じファイルを行選択できたが Open が無効のままで確定できず、Cancel。Recent は成功。この差は製品・OS・自動操作の前面状態のどこに起因するか分離できず、Open… 全般の製品不具合とはしていない。

入力補足: 最初の Command-End の意図した末尾移動が成立せず、追記が frontmatter 前へ入った。全選択と貼付で正しい検証文書へ戻した。この操作誤りで出た8 errorsを製品欠陥に数えない。

## T3 — エラー発見・修正（native）

正常な5ノード図に `result >> design` を加える。V010、`result` と `design` の名前、1 error が表示される。図・minimap が消え、図操作が無効になった。後半では Connections を開いた状態から同じエラーを再現し、パネルが閉じることも確認した。

`result >>? design` に変更すると No problems と図が戻る。高解像度エラー画面（原本限定画像）、[error AX](evidence/native-cycle.ax.txt)、修正後 AX（原本限定資料）。初期の03〜05は縮小キャプチャなので視覚判断には使わない。

## T4 — ソースと図・定義を往復（native / browser）

ノード design を選択 → Connections → Create definition → label入力。ソースに process.design.label が追加される。Go to definition に切り替わる。入力した label が図と Connections の見出しへ反映し、ソースでの変更が見える。ネイティブの Command-F で design を検索すると1 of 2と4:9の表示。次の編集で図と診断が更新される。ジャンプ機能の全種類、外部参照、Peek の詳細操作は未確認。

## T5 — 図のパン・拡大・幅変更（browser）

サンプルで背景をドラッグし、Zoom in で110%へ変更、Fitで100%へ戻った。パン・拡大後（原本限定資料）。パン位置とminimapの見た目が動いた。ホイール・ピンチの全入力は未確認。

viewport を800×650 → Fit →600×650へ変更。800ではtoolbarが2行になっても全操作が残る。600で図の右側が領域外へ出るが、Fitで76.1%となり全体が戻る。ノード選択してConnectionsを開くと見出しと中心ラベルが途中分断した。800（原本限定資料）、600（原本限定資料）。viewport overrideは終了前にresetした。reset後の通常領域は994×1034になっていたため、画像08を1280幅と混同しない。

ブラウザの編集操作は AX editor と DOM textbox の両方で入力準備の timeout になり、キー入力は完了しなかった。エディタ内部APIを呼ぶ回避はしていない。そのため browser の文字編集性能は未判定。

## T6 — 13ノード・長いラベル・複数診断（native）

New → medium-flow.pfdsl（原本限定資料） の42行を貼付。7 artifact / 6 process。長い英語ラベルと日本語ラベルを含む。図は表示され、エラー0・警告6。criteria省略によるW002であり、評価に使う意図的なフィクスチャ。CLI check JSONでも6 warningsを確認した。

Fit →21%で全体表示。画像（原本限定資料）。reviewを選択してFocus selected node →100%。画像（原本限定資料）。100%への復帰は機能する。全体表示だけで長いラベルを読むのは困難。

ソースへfocus → F8。`1 of 6 problems` と `Artifact 'sources' has no 'criteria' field(W002)`、9:3を表示。Connectionsも sourcesへ追従。既存の問題移動能力があることを確認した。これらの操作はツール transcript とAX差分で確認し、診断UIの全方式を監査したとはしない。

## T7 — 閉じる確認（native）

変更のある Untitled 1 を閉じる → Save / Discard / Cancel → Cancel。元タブと文書が残る。取消後 AX（原本限定資料）。その後、証拠収集用に使った同じテストバッファを閉じ、Discardを選択。実ファイルは既に評価フォルダにあり、他者の文書は対象にしていない。

## 実行準備と範囲

PFDSL: fetch-origin、managed create_worktree の固定SHA指定、list_artifactsで登録確認、固定HEADから評価専用ブランチ命名、wrapper setup、setup-completion check、wrapper build、Tauri release build（識別子overrideのみ）。全て成功。ビルドログは `evidence/native-build.log`。standalone の製品ファイルは変更していない。


自動操作ツールに長い応答待ち（起動・download・file chooser）と一時的な画面キャプチャ失敗があった。製品内の処理時間として計測できないため性能結論に使わない。背景ウィンドウの一部キャプチャは228×222の縮小画像となった。高解像度証拠とは区別する。
