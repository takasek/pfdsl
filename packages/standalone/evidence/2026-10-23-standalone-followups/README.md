# #1513・#1514・#1516 の検証記録

## Linux hover の終了調査（#1513、未解決）

2026-10-23 14:11–14:15 UTC に、報告時の配布物を使って操作を再試行した。
GitHub Actions run `39477198995`、artifact `12291015516`、source `b008ba8b43e5dc35f0c5d2b9d41f8ade2187a3c4` が対象。
AppImage SHA-256 は `ce92083a00e8a494976205c35d0b23647de8064cb7b3582e9d76c4033309d268`、抽出した実行ファイルは `9fa189996971ffc34b21edd62c4d3944268ebea5b96387c390745179dae52e7b`。

macOS 27.0.1 / Apple Silicon 上の Apple container 1.5、Debian 13 slim amd64、Rosetta、Xvfb 1280×800 で起動した。
AppImage loader はこの環境で exec format error になるため、offset 944632 から SquashFS を展開し、一般ユーザー tester で AppRun を起動した。
サンドボックス無効化やアプリの権限追加は行っていない。
ロードされた WebKit は配布物内の `libwebkit2gtk-4.1.so.0`（SHA-256 `ea9fbeccfe53a285391bfdafc9021149bd369e6823adc25a588688d8b948c3d6`）で、ビルド記録は WebKit 2.54.0 / Debian package `2.54.0-1~deb13u2`。
コンテナにインストールした u3 と混同しない。

Issue の fixture をファイルとして開き、14行目の `package_manifest` で Ctrl+K → Ctrl+I、rich hover、Escape、編集継続を2回試した。
1回目は hover 表示中にスクリーンショットを取得し、2回目は途中の撮影を省いた。
両方で WebKitWebProcess PID 9289 が存続し、Escape 後の編集と dirty 表示を観測した。
原報告の終了は再現せず、終了コード・core・終了時スタックは得られていない。
この結果は原環境での不具合を否定せず、修正や受入合格を意味しない。

証拠は `fixture.pfdsl.txt`、`environment.log`、`sequence.log`、`control.log`、`fixture.png`、`hover.png`、`after.png`。
公開用 PNG は画素を保持したまま cHRM・bKGD メタデータを除去した。
IHDR と圧縮画素の IDAT は取得時と同一で、公開用コピーの表示も確認した。
追加の metadata 別4試行は入力ツールが改行を落とし、実際には1行の不正文書を操作していたため無効として除外した。
有効な試行は上記2回のみ。
元の Debian 実機、表示サーバー・GPU・WebKit の実ロード情報、stderr/core を得て同じ操作と条件別比較を続ける必要がある。
#1513 に対する製品コードの変更は行っていない。

## macOS の独立体験レビュー（#1514・#1516、部分確認）

別 agent が実装会話を引き継がず、2026-10-23 14:13:35–14:17:22 UTC に実際の PFDSL.app を操作した。
対象は base `af1d3d83ecbbe2d0af480a4eb85bca1cfbf2c33e` に今回の未コミット変更を加えてビルドした中間版。
実行ファイルの SHA-256 は `6cbf01108b8bbcb1ab0b4fd16dccd9fae954dbf5ae35c62c78c71b803e012a1d`。

- OS ウィンドウタイトルの PFDSL → Untitled 1 → dirty 表示、タブ切替、最後のタブを閉じた後の PFDSL を確認。
- New、編集、タブ往復、閉じる操作の cancel / discard、Undo による本文保持を確認。
- Sample で W002 を発生させ、criteria 追加で現在の診断が No problems に更新されることを確認。
- 操作通知を dismiss しても現在の診断表示が残ることを確認。

Save As はダイアログの Save / New Folder が無効で完了できず、保存・保存後のタイトルは未確認。
hover は利用した操作手段で到達できず未確認。
画面はレビュー時に直接確認したが、この節にはスクリーンショットを保存していない。
この中間版の観測後、非同期保存中の追加編集に古い Saved 通知を残さない修正と、保存先選択の失敗を永続通知にする修正を加え、回帰テストの Red → Green と独立再レビューで確認した。
それらの追加変更を native 実機で確認したとは扱わず、#1445 の残件とする。
人間による全受入、Linux の修正版タイトル・通知、読上げ、署名・公証済み配布物は未確認。
