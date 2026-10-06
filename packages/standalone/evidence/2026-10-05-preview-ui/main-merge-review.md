# PR #1394 main integration review

対象は `<checkout>` の解消済み working tree。
比較した両親は旧 head `3a5ac77e1a493cf287dcd8e408cd847f5a139261` と取り込み対象 main `9bcd6d6fd6711dac861adac385468aa292fd654b`。
観点1（品質）・観点2（correctness）を、実装側の会話・推論を引き継がず静的にレビューした。

## Findings

統合差分について、修正必須の finding は確認できなかった。
これは実行による動作保証ではなく、以下の一次 source・両親との差分を用いた反証レビューの結果。

## 両親との照合

- `packages/vscode-extension/README.md:19` は main の local location/subflow の開き方とファイルごとの preview の説明を保持し、旧 head の編集・巡回・局所 graph・cue の説明も保持する。
  重複していた修飾クリックの1文だけを取り除いている。
- `packages/vscode-extension/src/preview.test.ts:17` は旧 head の Position/Range/WorkspaceEdit・selection mock を保持し、`:61` と `:120` で main の openTextDocument/fs.stat/Uri.file を加えている。
  `:249` の編集・stale/disposed request のテストと `:280` の main のファイル移動テストが共存している。
  両親の literal test/describe 名を全量照合し、旧 head の13件、main の10件に脱落はなかった。
- `packages/cli/src/index.test.ts:220` は main の29コマンドから meta create 追加を含む30コマンドへ期待値を更新している。
  両親の literal test/describe 名を全量照合し、旧 head の499件に脱落はなく、main の504件では件数を含むこの題名のみ置換されていた。
  main の dependency closure・strict・preset graph rejection のテストも保持している。
- `packages/core/src/multifile.test.ts` は旧 head の103件、main の114件の literal test/describe 名に脱落がなかった。
  この件数は登録 test ケース数ではなくソースに直接書かれた literal 名の件数であり、it.each 展開件数ではない。
- `packages/core/src/multifile.ts`、`packages/vscode-extension/src/document-link-logic.ts`、`src/document-link.ts`、`src/hover-logic.ts` は main の blob と byte-for-byte 同一。

## 入力・状態による反証確認

- `/test/flows/parent.pfdsl`、`basePath: ../`、`subflow: child.pfdsl`、`location: docs/result.md` という入力で、`packages/vscode-extension/src/preview.ts:315` は subflow を親ファイルのディレクトリに解決し、`:321` と `:56` は location だけに basePath を適用する。
  document link の `document-link-logic.ts:31` も同じ区別を保つ。
  この具体例の新テスト `preview.test.ts:281` は期待する2パスを明示している。
- preview から子ファイルを開いた後でも panel の source は `preview.ts:232` の state.doc のまま。
  編集・source jump・再描画・editor selection はいずれもその doc を参照し、別の active editor を編集対象として取り直さない。
- 古い source を持つメニュー、存在しない node、すでに定義済みの node、parse不能な source、disposed panel を確認した。
  `packages/editor/src/node-operations.ts:139` は authored source を照合して対象を再解析し、`preview.ts:246` と `:260` は host の lifetime/source/version を確認してから1つの WorkspaceEdit にする。
  `:281` と `:292` は非同期処理後に selection が古い source を使わないよう確認する。
- node ID と同名の metadata field、quoted authored definition key、alias/ambiguous source range を確認した。
  `packages/editor/src/jump-logic.ts:31`、`:64`、`:83` は definition key と body ID を扱い、preview selection も `preview.ts:405` で同じ semantic lookup を使う。
- main の extends DAG resolver を新しい preview が消費する経路は `packages/vscode-extension/src/analyze.ts:62` → `packages/editor/src/document.ts:68` → `packages/core/src/multifile.ts:618`。
  直接使用している既存 export 用の `analyze.ts:54` と CLI 用の `packages/cli/src/index.ts:3114` も同じ effective resolver へ到達する。
  main の memoized resolver を外して旧 chain に戻す自動統合はない。
- main の child/grandchild/preset diagnostics は `packages/cli/src/index.ts:510` の共有 loader、`:530` の各 subflow 親の extends 読取、`:542` の各 dependency の診断収集に保持される。
  新しい meta create の local CST 操作とこの runCheck の変更は別関数に残っている。
- 直接近傍と feedback の局所 graph は `packages/editor/src/node-operations.ts:101` で中心に incident な edge のみに絞る。
  cue は `packages/editor/src/preview.ts:219` と `:728`、render の cue reset は `:751` と `:755` に保持される。
  新しい source-bound editing と main のファイル移動は別 message branch であり、gesture は `:650` と `:670` に保持される。

## 文書の事実主張

README の新ショートカットは `packages/vscode-extension/package.json:87` の登録と一致する。
Alt+F12/Option+F12 の Peek Definition、editor.multiCursorModifier による既存 gesture の説明も [VS Code default keyboard shortcuts](https://code.visualstudio.com/docs/reference/default-keybindings) と [Basic editing](https://code.visualstudio.com/docs/editing/codebasics#_multicursor-modifier) の現行一次資料で照合した。
make setup / vscode-dev / code PATH / F5 build の説明は Makefile:63 と packages/vscode-extension/.vscode/launch.json / tasks.json に対応する。
単一Undoについては1つの WorkspaceEdit を作る source を確認した範囲に留まり、今回のレビューでは実アプリの Undo stack を測っていない。

## 検証と限界

read-only Git show/diff、ソースの読取、両親の test 名と source blob の比較を実行した。
競合した2ファイルの conflict marker 検索は0件で、対象2ファイルの `git diff --check` は exit 0。
build・test・VS Code smoke・typecheck はこの reviewer では実行していない。
特に native Undo、実 webview の mouse/keyboard gesture、VS Code editor の表示列/選択、非同期 applyEdit の競合は実測していない。
CI、issue state、PR body、selected六 artifact の status、main への PR merge は確認範囲外。
source・Git metadata・外部サービスには書き込まず、このレビュー報告だけを作成した。

## Reviewed working-tree SHA-256

```text
2650ad19e959b164cde0180563203435415dacbfb25c16b63367dee15728a0a0 packages/vscode-extension/README.md
21534aa7938721d2509cdfe8858f766275edbde6d18a6225b3f8d0a8d3dd3ac4 packages/vscode-extension/src/preview.test.ts
2255ad63ea6682ca944c9c631ea10654d1e6ea31e0c0434ff5fe640633d11ebe packages/vscode-extension/src/preview.ts
87e5ce2e80531e0db84f810bc9454df9620af27f151352b0ea659bf2a58b1d5f packages/cli/src/index.ts
37f35f0cf96f88d3ba3205037b849376e18792347e22d9668454f53c5e94cff1 packages/cli/src/index.test.ts
fe604cfbe0107b89534853192cd18219a7ecd549d35a6a4d6120fcf3f967a77d packages/core/src/index.ts
0f2b1a5d7c9ab3942dbdfad5669644fbacaf08b5caba01a492cec24a1cd01890 packages/core/src/multifile.ts
```
