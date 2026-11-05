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
元の回収ZIPと全量資料は手元で保全している。

## Dotクラウドでの追試（2026-10-27受領）

同じAppImage・元fixtureをDebian 13.6／Intel Xeon表示のx86_64／X11で通常2回・観測library付き2回試し、Escape後95.477／108.866／109.235／98.654秒で非再現と報告された。
全回自動キー・撮影あり、hover中の外部AX取得なし、Escape後AX取得ありで、本文確認は入力ファイルhashと全行の画面照合であり、エディタ内部バイト比較ではない。
受領した集約記録の前後PID・親子関係・起動識別は一致し、観測群の実app connectedと自然終了通知なしを確認したが、非再現4回の全量archiveは別保全で未受領のため、UI・応答の確認は短報と集約の範囲に限る。
別起動の較正資料は、識別済みWeb子へのSIGTERM送信、同じviewのreason=0/crashed通知、本体・network存続を裏づけるが、Web子wait-statusは未取得である。
較正のmaps・hashと同じlibraryのversion関数の逆アセンブルは配布物内WebKitGTK 2.54.0を示し、観測libraryも既存AppDirのGLib/GObjectを参照した。開発packageはビルド用に局所展開し、新しいruntimeは導入していない。
準備時のAMD表示は別環境で、実試験の仮想化・エミュレーション詳細、GPU renderer、Xvfb有無は不明。core無効、kernelログ権限不足、cgroup OOM情報未取得のため、遅延故障やOOM・原因候補の否定、修正確認には使わず、追加反復は終了した。
出典は手元保全の `pfdsl-1513-followup-result.zip`（SHA-256 `0b29acd646780fdca4a06414af5f08bab3a6091488ab60b62a6d966d22e54dcf`）。ZIP内19件と較正資料内77件のチェックサムを照合し、非再現ログの全量は本PRへ追加していない。
