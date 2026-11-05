# Sol の評価環境

原本 README から pfdsl の評価条件を抜粋した保存版。
製品の結論は design-review.md、操作記録は task-log.md に保存している。

- 評価日：2026-10-27 JST。
- pfdsl：`d1b5db85ecdb9344a5ed6fff2f1b17632a8ec6e6`。
- macOS 27.0.1（26A434）、Apple Silicon。
- Node v26.12.1、pnpm 10.33.2。推奨 Node 24 での再現性は未確認。
- ブラウザ：チャット専用 IAB。エンジン・版は未取得。
- ブラウザ幅：800×650、600×650。ネイティブウィンドウ幅変更は未確認。
- ネイティブ：Tauri release build／WebView。OS 組込 WebKit の正確な版は未取得。
- 分離：専用 productName・identifier の config override。tracked config は無変更。
- 確認限界：既存製品の Recent・設定の移行は評価外。Open ダイアログは未確定で、Recent 再オープンは成功。

製品コードは変更していない。
この文書は環境の抜粋で、再実行に必要な全ファイルを同梱したものではない。
