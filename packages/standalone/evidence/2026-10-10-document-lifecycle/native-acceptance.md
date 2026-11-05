# #1431 の Mac 文書ライフサイクル受入

2026-10-10、親 agent が許可された Computer Use で通常起動の PFDSL を操作した。
環境は Apple Silicon / macOS 27.0.1 (26A434)、debug executable SHA-256 は `d8531c59661606297c0a6097c10c7f495c0b315fea69c3a154d801ef12b98f40`。
同梱ソースは `f304626f8e8b32daef3ddc36016a2178e96ba7b4` に本番 document-tab の find contribution import を追加したもの。
`5422b25536695f054fc8adb354dceb0b5d6e2537` の本番ソースは上記同梱ソースと一致し、build 後に加えた変更は文書・テストのみである。
起動 process の executable path と hash を照合した。

以下は Computer Use の AX・画面の観測と、専用使い捨てフォルダのディスク本文・metadata 検査から転記した記録である。
生の AX 全文やスクリーンショットを保存した記録ではない。
新規タブと専用ファイルだけを編集し、既存の Welcome・日本語サンプルは編集しなかった。
試験後に全試験タブを保存または明示破棄し、clean な Cmd-Q の終了と process 不在を確認した。

## 入力と結果

| 操作 | 期待結果と観測 |
| --- | --- |
| ファイル Open | chooser で日本語 frontmatter と `input >> build -> output` の文書を選び、editor と対応する図が表示された。 |
| Cmd-F・単発置換 | 日本語 label「入力」を検索して1/1を表示し、Replace で「受領」へ変更した。図と dirty 表示が更新され、保存前のディスク本文は元のままだった。 |
| 単発置換 Undo/Redo・Cmd-S | Cmd-Z で元の label と clean 状態、Cmd-Shift-Z で置換と dirty 状態へ戻った。Cmd-S 後は Saved・clean となり、ディスク本文も置換結果と一致した。 |
| 新規・検索の次結果・全置換 | Untitled に日本語2行を入力し、Cmd-F と Return で1/2から2/2へ移動した。Replace 欄で「受領」を指定し Cmd-Return の全置換で両方が変わり、Undo/Redo で図が戻り・復元した。保存後の本文は `受領 >> 処理 -> 成果` と `受領 >> 保存 -> 記録` の2行と一致した。 |
| Save As 取消・日本語ファイル名 | chooser の取消後も Untitled の本文と dirty 状態が残った。再実行して日本語ファイル名で保存し、clean 状態とディスク本文を確認した。 |
| 手動保存のみ | 未保存のコメントを加え、入力方式確認を試す間の時間経過とフォーカス移動、別タブへの切替後もディスクは前回保存した2行のままだった。 |
| タブ隔離・エラー回復 | 別文書は独自の本文と図を保持した。専用の第2文書に不正 YAML を入力すると FM002 と preview 操作の無効化を観測し、正常文書への切替でその図は保たれた。戻るとエラーが残り、Undo で元の本文・図・clean 状態へ復帰した。 |
| 長い文書の表示位置 | 同じ binary を再起動し、80行の番号付きコメントと1行の flow を専用 Untitled に入力した。文末から Up 10回で途中へ移動すると AX の editor はコメント52〜71と72の一部を表示した。Welcome へ切り替えて戻った後も同じ範囲だった。editor の AX element を click した後に試験用 MARK を貼り付けると71の次の行の先頭へ入り、Undo で戻った。click の caret への影響を分離していないため、この追加入力でタブ往復前のカーソル位置保持は認定しない。本文と図は専用文書のものを保持し、そのタブを Discard 後に clean な Cmd-Q で終了した。任意の zoom/pan や全カーソル操作を網羅した測定ではない。 |
| clean 文書の外部変更 | ディスクの label を「外部版」へ変更すると監視で再読込され、対応する図が更新された。 |
| dirty 文書の外部変更 | ローカル `local >> work -> unsaved` と外部 `external >> writer -> changed` を分けて保持し、変更通知と比較画面で両方の本文を確認した。 |
| 比較中の再競合 | 比較画面を開いた後に外部本文を `newer >> writer -> version` へ更新した。Replace Observed は拒否され、`The disk changed. Review it before replacing this version.` と表示された。Review Again で新しい外部本文を確認してから置換すると保存され、ディスクはローカル本文と一致した。 |
| 外部 rename・再作成 | 原本を別名へ移すと `The file was deleted or moved. Your editor content is retained.` が表示され、Use Disk は無効だった。比較後の Create File で元の名前へ再作成して clean となった。移動先も保持した。 |
| 書込み権限拒否・回復 | 専用 directory の書込み権限を外すと Permission denied (os error 13) で保存を拒否し、dirty buffer と回復先を保持した。権限を戻した後、metadata 変更の再競合を再確認して保存できた。ディスク本文も一致した。 |
| mode・owner/group・通常 ACL | mode 640、同じ所有者・group、everyone の読取 ACL を付けた文書を保存し、保存後もこれらが保持された。異なる所有者や複雑な deny ACL の試験ではない。 |
| 保護 flag による保存拒否 | immutable flag を付け、`protected >> work -> buffer` を編集すると Operation not permitted (os error 1) で保存を拒否した。dirty buffer を保持し、終了時の Save と比較後の置換でも拒否・保持された。後で flag を解除した。 |
| 複数 dirty タブの途中取消 | Cmd-Q で第1タブの Discard を選び、第2タブの Cancel を選ぶと、両タブと両方の未保存本文が残った。先行タブの破棄を途中取消で確定しなかった。 |
| 外部 delete・Save As 衝突 | 原本削除後も protected 本文が残った。既存の専用 collision ファイルを Save As 先に選び OS の Replace を選ぶと、アプリで両本文の比較へ進んだ。Keep Editing で取消し、衝突先の本文が不変でローカル本文も保持された。 |
| delete 後の別名保存 | 新しい recovered ファイルへ Save As で回復し、clean 状態とディスクの protected 本文を確認した。 |
| folder・重複 Open・recent | folder chooser で専用フォルダを開き、5つの `.pfdsl` が一覧に現れ、補助 `.txt` は対象外だった。既に開いた recovered を選んでもタブは増えず、第2文書と recent の再アクセスで対象文書を開けた。folder も recent に記録された。 |
| dirty タブ close・window close・menu Quit | 各入口の Cancel で未保存の本文とタブを保持した。menu は PFDSL の Quit を実際に選んだ。 |
| close の Save・Discard | 新規文書の Save でディスクへ未保存コメントも書かれ、そのタブだけ閉じた。第2文書を再 Open して変更し Discard するとそのタブだけ閉じ、ディスクは元の本文のままだった。 |
| clean アプリ終了 | 最後に Cmd-Q でアプリが終了し、対象 process が残っていないことを確認した。 |

最後のディスク検査で recovered は `protected >> work -> buffer\n`、衝突先は `existing >> task -> saved\n`、第2文書は `other >> process -> result\n` だった。
日本語名の新規文書は上記2行と `# IME: nihon` のコメントを保存した。
権限を変更した directory は mode 755 に戻した。
専用文書の rename・delete はこの試験の入力操作であり、利用者の原本には行っていない。

## 所有者による引継ぎ項目の受入

親の Computer Use では日本語の貼付・検索・置換は確認したが、日本語 IME の composition → 変換 → 確定は未確認だった。
入力切替を試した後も物理キーは Latin の `nihon` として入り、入力方式を証明できなかった。
SystemUIServer と Dock を選択する Computer Use 呼出しは timeout となった。
所有者が timeout した項目を手動で担当すると表明したため、同じ PFDSL.app で「日本語 IME の変換・確定→保存」と「未保存文書の Dock Quit→取消→本文保持」を依頼した。
2026-10-10、所有者は「どちらも問題なく動作」と報告した。
この2項目は所有者の通常アプリ操作による受入成功として記録し、親の Computer Use 追試や生の操作ログ取得とは区別する。
Dock の結果を Cmd-Q やメニュー Quit の結果から推定した判定ではない。

## 今回の実測に含めない範囲

ディスク容量不足、異なる owner/group、複雑な ACL の組合せ、最低 macOS、現行版全 native corpus は今回の実機試験に含めない。
タブ往復の表示範囲は観測したが、カーソル位置保持の独立した実測は残る。
これらの未実測を一般的な成功とせず、自動検査・旧固定版の証拠と分けて完了判定する。
保存最終検査後の外部 writer race と旧 FD writer は、採用済み保存前検査の保証境界に従う。
これらを一般的な実機成功へ拡張せず、以下の完了条件への対応と区別する。

## #1258 の総合完了判定

親の実アプリ操作、所有者の2項目の受入、変更のない Rust の28件と今回の全体・host 検査を合わせ、採用済み保存前検査の境界で #1258 の7条件を満たすと判定した。
会話を引き継がない独立 reviewer が現行 issue 要件・本番実装・受入記録と一次検査ログを照合し、追加実装・追加実機試験を必須とする欠落はなかった。
reviewer 自身の native 操作や検査再実行の結果ではない。

| #1258 の条件 | 対応する証拠 |
| --- | --- |
| 1. 新規・Open・folder・Save・Save As・recent・再 Open | 上の Open、新規、Save As、folder・重複 Open・recent の通常アプリ操作。 |
| 2. 文書ごとの本文・表示位置・図・描画隔離 | タブ隔離・エラー回復と80行の表示範囲保持。文書専用 editor と遅延描画の隔離は本番 document-tab と lifecycle 検査で確認。カーソル位置の独立実測成功は主張しない。 |
| 3. IME・検索置換・Undo/Redo・手動保存 | 親の検索置換・Undo/Redo・保存・非自動保存と、所有者の日本語 IME 変換・確定→保存の受入。 |
| 4. 未保存 close・終了・Save/Discard/Cancel | 親の各終了入口・保存失敗・複数 dirty 途中取消と、所有者の Dock Quit→取消→本文保持の受入。 |
| 5. 外部変更・rename/delete・衝突・保存失敗 | 上の通常アプリ操作と、Rust の実 partial staging-write failure・host の buffer/dirty/回復先保持。 |
| 6. 保存方式・再競合・保証範囲 | 比較中の外部再変更拒否・再比較後保存、最終検査後の writer と旧 FD writer を保証しない利用者採用境界。 |
| 7. 自動検査・実アプリ異常系・受入表 | 本記録と ACCEPTANCE、保存簡素化後の Rust 28/28、find 接続後の全体5,998 pass / 1 skip・型検査、体験統合後の実 Monaco 13/13。 |

容量系は `documents.rs` の write/sync 共通失敗経路と、子 process の書込みサイズ上限で実際に途中 write を失敗させる検査を確認した。
その検査は原本不変と一時ファイル cleanup を検査し、ENOSPC の実 volume 試験とは区別する。
Rust の一次ログは保存簡素化段階の実行であり、その後の Rust 不変を照合して再利用した。
`088bcf23b827778f65a01bdbb4d74c781eaafe61` の自動 CI は10成功・2 expected skipsで、smoke も成功した。
署名配布・最低 OS 保証・session/crash recovery は後続または未決の製品範囲であり、本工程で追加しない。
この完了判断は PR 内の成果物状態とマージ時の issue 連携へ反映し、即時 issue close や merge は実施しない。
