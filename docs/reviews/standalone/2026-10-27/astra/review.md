# デザインレビューと改善提案

保存版注記：pfdsl に関する部分を抜粋し、その結論・優先度を保持した。絶対パスと資料リンクを保存先に合わせて加工した。収録していない根拠へのリンクは「原本限定資料」と表記する。原文のフォルダ・同梱への言及は全原本フォルダを指す。非リンクの相対ファイル名も、provenance.json の収録一覧にない場合は原本限定資料を指す。


優先するのは「小さい画面でも文書を読める」「診断から修正へ迷わず移れる」品質である。ソースと図の同期、標準ショートカット、ペイン調整には実用的な基盤がある。一方、ネイティブの Open/Save 完了は今回確認できず、日常の文書編集を合格とは判定しない。

## 優先順位付き提案

| ID / 優先度 | 観察事実と影響する作業 | 根拠 | 改善方向と確認条件 | 未確認・代替案 |
|---|---|---|---|---|
| R1 / P1 | 診断件数をクリックしても詳細へ移れない。構文エラーは図面に P006: Expected process identifier と出るが、修正行へ進む操作がここにない。F8 を知っていれば行へ進める。 | T2、04-native-warning.png。main.ts:33–38,146–148 は status の textContent。document-tab.ts:315 は Monaco markers を設定。 | 件数を「問題一覧を開く」操作にし、行・列・説明を持つ一覧からソースへ移動。F8 と同じ修正経路へ接続。ゼロ件への変化もその場で確認できるようにする。 | 常設の大きな問題パネルは不要。最小案は件数から次の問題へ移動＋ショートカット表示。未経験者で発見性を再評価。 |
| R2 / P1 | 600px幅、左右50%では Connections の Customer / Review / Approved が数文字ずつ縦に折れ、接続方向の一覧を読めない。 | 09-browser-connections-600.png。preview-shell.ts:52 の3列、:58/:64 の anywhere 折返し。 | 狭いペインでは「入力」「選択ノード」「出力」の縦並びか、選択対象の詳細だけを別ビューにする。操作の意味と方向は維持する。 | breakpoint値の確定には日本語・長いID・多数の隣接ノードが必要。文字を小さくして収める案は読解を悪化させるので採らない。 |
| R3 / P1 | 800px幅で長いソース行が切れ、Fit後は図が62.2%になる。600pxへ変更すると図の一部が外へ出る。比率変更は可能だが両方の可読性は同時に確保できない。 | 07-browser-fit-help-800.png、08-browser-600.png。T4/T5。 | Split / Source / Diagram の切替を明示し、選択・カーソル・未保存状態を保つ。図側で問題を選んだらソースを見せる。 | 自動で全画面切替するより利用者の選択を優先。表示切替の可読性改善は未実測。ネイティブの狭幅は未実測。 |
| R4 / P2 | 図の上部に同じ枠・強さのボタンが連続し、1000pxでも Help が次段になる。Help を開くと段落が図の高さを減らす。 | 01-browser-sample.png、07-browser-fit-help-800.png。preview-shell.ts:13–14。 | 拡大縮小＋Fit、選択対象操作、補助操作を役割でまとめる。補助操作を More にまとめ、ヘルプは短い操作別表示へ。メニュー経由も維持。 | 機能を全てアイコンにする案は意味の推測を増やす。まず頻度調査と文字ラベル付き小型案を比較。 |
| V1 / 最優先の検証事項 | Save Asで .pfdsl 名と自分の出力フォルダを指定しても Save 無効。Openでも自分の review.pfdsl を選択後 Open 無効。 | T1/T6。lib.rs:184,208 は標準ダイアログ＋pfdsl filter。03-save-disabled.png は白い画像となり視覚証拠に不適、AXの状態を観察根拠とする。 | 通常の署名／release構成と実ユーザー操作で同じファイルを開く・保存・再読込する。再現すれば最優先修正。 | 分離用識別子、debug bundle、OS、操作ツールの影響を切り分けていない。一般的な保存不具合と断定せず、全ユーザー向けP0とも分類しない。 |

P1は日常作業の回復・可読性への支障、P2は操作探索と視覚整理。単にHIGに似ていないことを優先度の根拠にはしていない。

## 確認済みの長所

- Start は New / Open / Try a sample に絞られ、空の状態から試せる。
- 編集後に図が更新され、検索で plan に移ると Connections も plan になる。操作対象がソースと図で共有される。
- F8 のエラー／警告移動と説明表示、Undo による正常図の復帰を確認した。
- Close Tab に Save / Discard / Cancel があり、Cancel は内容を保持する。変更印がタブとタイトルにある。
- 図のパン、ズーム、Fit が機能し、迷った位置から全体へ戻れる。ペイン境界の ArrowLeft で50%→45%へ調整できる。
- ネイティブ View メニューには Fit、Actual Size、Zoom、文字サイズ、Connections があり、画面内ボタンだけに依存しない部分がある。

## 操作記録

T1（native）: Try a sample → Cmd+Shift+S → 保存名 native-sample.pfdsl → Cmd+Shift+G → 専用出力先を指定。名前欄setValue・通常paste・Tab・ReturnでもSave無効。Cancelで戻った。保存成功なし。

T2（native）: サンプルを Customer request / Review request / Approved plan のfrontmatter付き文書に置換。criteriaなしにより1 warning。下部件数クリックは変化なし。編集面でF8により6:3のW002説明。Escape後に構文を idea >> -> plan に置換しP006を確認。F8で4:9へ。Escape→Cmd+Zで正常図へ復帰。05-native-error.png は縮小・変形したツール画像のため根拠画像には採用しない。

T3（native）: ConnectionsのGo to definition→Cmd+F→plan→Enter。検索1/3、Connectionsがplanへ変わる。AXノードへのダブルクリックは単クリックと区別できなかったためダブルクリックの成功とは数えない。

T4（browser）: 800×650→Help→閉じる→600×650→図のdesignを座標クリック。Connectionsの折返しを記録。1000×720へ戻しFit→Zoom in、87.2%。図の背景を(755,490)から(650,540)へドラッグ、移動を画像で確認。Fitで79.3%へ復帰。

T5（browser）: Source and diagram widths separatorへArrowLeft。50→45。ソースのみ／図のみ切替は画面にもnative Viewにも見つからない。

T6（native）: Cmd+O→Go to pathで documents/review.pfdsl を選択。Open無効。Cancel→Cmd+WでSave changes to Sample?。Cancelで元の文書に戻る。メニューはEscapeではAX表示が残る場合があり、公開されているCancel actionで閉じた。これは操作ツールとの相互作用として区別した。

## 第一印象から変わった理解

当初は細いボタン群と補助表示の重複が主問題に見えた。操作すると、ソースと図の選択同期、F8、Undo、メニューに既存の支援があった。したがって「検索や診断機能を新設」ではなく、既存機能への入口を見える位置へ接続する提案に絞った。ソース確認で診断はstatus、図の操作列はflex-wrap、Connectionsは固定3列とわかり、観察の原因候補を具体化できた。ソースから操作成功を補完してはいない。

## 判断に使った一次資料

2026-10-27にFirecrawlでApple本文を取得（同日キャッシュ）。[Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)の情報密度、ウィンドウ調整、キーボードとメニュー、[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)の適応・グループ化・段階的表示、[Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)の頻度と役割による分類・overflow、[Typography](https://developer.apple.com/design/human-interface-guidelines/typography)の可読性と階層を採用した。13ptというmacOS値をCSS pxの合否判定には使っていない。

指定の参考パックのREADME、galleryを確認した。過去の画像を現行製品の証拠にはしていない。比較対象を増やすより、今回の具体的な幅変化と復帰操作を優先した。

未確認: VoiceOver、コントラスト実測、ダークモード、日本語IME、巨大図、外部参照・subflow、複数文書間の状態保持、ネイティブ狭幅、実ファイル保存後の再読込、長時間利用。他のOSへの一般化はしない。
