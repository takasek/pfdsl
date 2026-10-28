# Astra の評価環境

原本 README から pfdsl の評価条件を抜粋した保存版。
製品の結論と操作記録は review.md に保存している。

- 評価日：2026-10-27。
- pfdsl：`d1b5db85ecdb9344a5ed6fff2f1b17632a8ec6e6`。
- macOS 27.0.1（26A434）、Node v26.12.1、pnpm 10.33.2。
- ブラウザ：Codex in-app browser。版は未取得。
- ブラウザ幅：800×650、600×650等。ネイティブ狭幅は未実測。
- ネイティブ：評価専用 productName・identifier・port を指定した dev と debug bundle。
- 準備：専用 managed worktree の setup、setup-completion check、build 成功。
- 確認限界：配布用 release build の受入ではなく、Open／Save の確定も未完了。

製品コードは変更していない。
この文書は環境の抜粋で、再実行に必要な全ファイルを同梱したものではない。
