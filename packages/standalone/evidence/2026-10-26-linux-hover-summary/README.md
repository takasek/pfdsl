# Linux hover調査の要約（#1513、未解決）

[原記録](../2026-10-26-linux-hover-recovery/README.md)は、操作不能後の本体・network存続とpsでのWebKitWebProcess不在を裏づける。
終了瞬間、原因signal、OOM、原環境の実ロードWebKit版は不明である。
原因の特定・製品修正・GUI-27／GUI-44の合格には至っていない。

macOS 27.0.1／Apple Silicon上のDebian 13 amd64／Rosetta／Xvfbで、元377バイトfixtureと同じAppImageを使い、撮影×外部AX取得、metadata別、Find allを試した。
完遂20回は停止を再現しなかったが、観測はEscape後約2.5〜4秒だけである。
元Session05はhoverからps確認まで約46秒あり、発症瞬間は不明なので、遅延発症や各操作の原因性を排除できない。
元Dot環境との同等性も保証せず、非再現を修正確認には使わない。

[observer.c.txt](observer.c.txt)は、配布バイナリを変えずWebKitWebViewの標準終了通知へ接続する検証用libraryである。
別の使い捨て起動でWeb PID3624へ意図的SIGTERMを送り、本体3534・network3594存続と同じviewのreason=0/crashed通知を確認した。
[較正記録](observer-calibration.jsonl)は対象3 PID、送信時刻、接続と終了通知だけの抜粋で、API行は元stderrのまま保持する。
API区分は実際のsignal・OOMの証拠そのものではなく、この較正は原障害の再現でも全故障の捕捉保証でもない。
実行対象sourceは `b008ba8b43e5dc35f0c5d2b9d41f8ade2187a3c4`、AppImage SHA-256は `ce92083a00e8a494976205c35d0b23647de8064cb7b3582e9d76c4033309d268`。
次に自然停止の情報を採る場合は [採取手順](NEXT-LINUX-RUN.md) を使う。

各回の非再現ログ・派生fixture・付随観測は今回の差分から除いた。
必要になった場合は [縮小前の固定版](https://github.com/takasek/pfdsl/tree/fbecad945fc10e86b03eb3a2a75fb1a5898d6907/packages/standalone/evidence) から取得できる。
PRブランチは最終差分の1コミットへまとめ、元の回収ZIPと全量資料は手元で保全している。
