# 共通基盤の受入対応表

参照する現行拡張: `459dfa74cd80c390017e4983834751721e4a4480`。
機能一覧は、その版の `packages/vscode-extension/package.json`、`src/extension.ts` と各登録 provider・内部 command を照合した。
専用 configuration の宣言はない。
言語設定、文法、キー割当と VS Code 本体の設定は独立して扱う。
対応表の完了は、全機能の移植完了を意味しない。

| 現行機能と入口 | 担当工程 | 確認方法と証拠の置き場 | 基盤段階での扱い |
| --- | --- | --- | --- |
| 構文解析、AST、正規化 graph、sourceMap (`analyzeDocument`) | #1257 | `test/host-parity.test.mjs`、native corpus report | 両版が共有サービスを実利用 |
| 文書診断 provider (`registerDiagnostics`) | #1257 / #1259 | corpus の code・severity・message・range、Monaco markers | 文書自身の診断を共有。継承プリセット診断は別集合 |
| extends の表示継承 | #1257 | preset・循環・missing fixture、native corpus の frontmatter / DOT | 両版の既存 lenient 表示方針を共有 |
| 全体整形 provider / `pfdsl.format` | #1257 / #1259 | 両 adapter の整形比較、実 editor の Undo | 計算共有、アプリの Format を接続 |
| 選択範囲整形 provider | #1259 | frontmatter を跨ぐ選択、Undo、range-format tests | 計算共有、Monaco の選択導線は未移植 |
| フロー形式・flat 形式の選択 | #1259 | 両形式の command / Undo | 計算共有、アプリの形式選択は未移植 |
| `.pfdsl` 言語設定、括弧、コメント、語境界 | #1259 | manifest / language-configuration を Monaco と照合 | 未移植 |
| TextMate の構文強調、YAML embedded language | #1259 | grammar と日本語・不完全入力の UI 確認 | 未移植。Monaco は plaintext |
| エディタ hover の metadata・前後ノード | #1259 | hover provider、各フィールド、未定義 node | 未移植 |
| hover の定義移動 (`pfdsl._gotoNodeDefinition`) | #1259 | quoted / flow YAML key、同名 field、range | 位置計算共有、hover 導線は未移植 |
| hover の Find all (`editor.actions.findWithArgs`) | #1259 | 実 editor の全出現検索 | 未移植 |
| process command の実行 hint / inlay hint | #1259 / #1260 | hint 表示と外部 terminal の実行 | 未移植 |
| 未定義 node の定義追加 Quick Fix | #1259 | CST 保存、Undo、失敗時 source 保持 | 種別判定と core 計算を共有。Monaco の Quick Fix は未移植 |
| 定義への直接移動 (`pfdsl.jumpToDefinition`) | #1259 | sourceMap と実選択、quoted key | 位置計算共有、preview node からの接続あり。専用 command は未移植 |
| 定義の並べ替え (`pfdsl.sortMeta`) | #1259 | 値・コメント保持、選択方式、Undo | 未移植 |
| コネクタ追加 (`pfdsl.addConnector`) | #1259 | input / output / feedback、重複・新規 ID、Undo | 編集計算共有。アプリ側の選択 UI は未移植 |
| 正規化エッジ表示 (`pfdsl.normalize`) | #1259 | 出力テキストと情報表示 | 未移植 |
| プレビュー起動 (`pfdsl.preview`)、live redraw | #1257 / #1259 | registered preview test、VS Code smoke、native `.app` | 共通 DOM を両版で実利用 |
| zoom、pan、ミニマップ | #1257 / #1259 | 既存 arithmetic tests、VS Code smoke、native GUI | 画面処理を共通化 |
| metadata tooltip、location / subflow の表示 | #1259 | 共通 DOM と実 hover | 共通 DOM に移動。Tauri の外部起動は未接続 |
| editor→preview の focus、node→editor の移動 | #1257 / #1259 | registered messages、native GUI、座標変換 | 共通位置解決と DOM を接続 |
| 関連文書の document link provider | #1260 | URI、basePath、絶対 path、URL | 未移植 |
| ディレクトリ参照の候補選択 (`pfdsl._openDirectory`) | #1260 | 複数候補と開き先 | 未移植 |
| location / subflow から PFD・ファイル・URL を開く | #1260 | PFD は app 内、その他は規定外部 app | 未移植。ユーザーに未接続と表示 |
| process command (`pfdsl.runCommand`) | #1260 | cwd・環境、Terminal.app / Ghostty の実機証拠 | 未移植 |
| 別ファイルとの図差分 (`pfdsl.diff`) | #1260 | 比較側ファイル、現在の未保存 source、構造差分 | diff panel DOM を共有。比較導線は未移植 |
| Git の参照先との図差分 (`pfdsl.diff`) | #1260 | Git 有無、ref、エラー回復 | 未移植 |
| 差分解除 (`pfdsl.clearDiff`) | #1260 | 元の表示へ復帰、pending diff lifecycle | protocol / DOM を共有、アプリ側 command は未移植 |
| DOT 出力 (`pfdsl.export`) | #1261 | ファイル、内容、encoding | DOT 計算共有。保存導線は未移植 |
| SVG 出力 (`pfdsl.export`) | #1261 | 全図寸法・日本語・node / edge | SVG 描画共有。保存導線は未移植 |
| PDF 出力 (`pfdsl.export`) | #1261 | OS 出力、ページ寸法・文字・全図、追加環境不要 | 未移植 |
| PNG 出力 (`pfdsl.export`) | #1261 | pixel 寸法、全図・日本語、追加環境不要 | 未移植 |
| TSV 出力 (`pfdsl.export`) | #1261 | metadata exporter の値とタブ | 未移植 |
| All 一括出力と部分失敗 | #1261 | 成功形式の保持、警告、失敗の内訳 | 未移植 |
| 文書ごとの editor + preview tab | #1257 / #1258 | 実機の tab 往復、古い描画の隔離 | 基盤に接続。終了・復元契約は #1258 |
| 新規・開く・保存・Save As・最近の文書 | #1258 | 任意文書、手動保存、Undo / Redo、close | フォルダ読取のみ。保存しないことを明示 |
| 外部変更、dirty 衝突、保存 race の保護 | #1258 | 保存前後の独立 writer、dirty 内容保持 | 未実装。試作の保存 race を持ち込まない |
| 検索・置換、基本 Undo / Redo、日本語 IME | #1257 / #1258 | Monaco 実操作と composition→commit | Monaco を利用、実機証拠は下記 |
| Alt+F12 と既定 Peek Definition の衝突 | #1283 | 採用キーと VS Code 設定の実操作 | 未解決の既存 issue として維持 |
| 署名・公証 DMG、更新案内、対応 OS、利用者環境 | #1262 | 配布物と実機、Git 不在、追加開発環境不要 | 未実装。local `.app` は配布受入ではない |

## 未実装 UI のまとまり

| 要求 | 実装のまとまりと共有点 | 完了判定 |
| --- | --- | --- |
| #483 と #1282 の preview UI | node action・メニュー、connector / definition 計算、Undo 可能な適用を共通境界で接続 | 今回の基盤作成では未完了 |
| #1282 の CLI 操作 | core の定義追加処理を使う独立した CLI 導線 | UI の統合だけでは完了しない |
| #1284 と旧 #1285 の移動先強調 | 共通 preview DOM の局所 graph と移動合図。再描画による位置保持を利用者 navigation と区別 | #1285 の管理上の close と実装完了を混同しない |
| #1283 の editor 内巡回 | sourceMap の定義 range と AST の全 ID range を共有し、巡回 command・ジェスチャーは別実装 | 同一行反復・quoted key・同名 field と既定キー衝突を検査 |

## 検証記録と限界

作業ブランチ: `codex/shared-ui-host-foundation`。
基準の commit と working-tree corpus の source hash は、native baseline / report に保存する。
全機能を #1257 だけで移植すること、機械テストで IME・配布物・過去 OS の対応を認定することはしない。

2026-10-04、Apple Silicon arm64 / macOS 27.0 (26A428) の local `.app` で検証した。
最終 release executable の SHA-256 は `4cabd95a31ae5a17eae2de26c8b6c687b29adbcaa803543274b0ddc355e8a449`。
[native report](evidence/2026-10-04-native-report.json) に実行中 binary・同梱 frontend・入力 source の hash と各文書の結果、[環境記録](evidence/2026-10-04-environment.json) に実測 OS と Mach-O arm64 を残した。
report の userAgent は WebKit の互換文字列であり、実際の OS / CPU の判定には使用しない。

| 検証 | 結果と証拠の範囲 |
| --- | --- |
| 共通処理の TDD・package tests | editor 143、extension 113、standalone 5 が成功。移動した既存テストに加え、未保存 source / preset 分離、複数 mount、破棄、古い描画・位置・focus、drag、終了確認の回帰を Red → Green で確認 |
| native 読取境界 | locked Rust tests 2 が成功。選択外・traversal・symlink escape と、選択後に元 pathname を置換した状態を検査 |
| production adapter 同値性 | top-level sample 20 と運用 PFD 3 の全 23 文書で authored model / sourceMap、診断の code・severity・message・range、継承 frontmatter・preset 診断、format、DOT と SVG を比較。Node 上の両 production adapter と native の両経路が成功 |
| native corpus | 最新同梱 frontend が native reader で読み、共通 DOM に全 SVG を mount。23/23 成功、failures / JS errors は空。最後に現在の入力・frontend 10 ファイル・実行 binary の hash と照合 |
| VS Code の既存導線 | VS Code 1.132.1 の実 extension host で preview 起動、sample の 6 node 表示、終了 cleanup が成功 |
| debug の実 editor、前面表示後 | 日本語貼付→図更新、Undo / Redo、Format→Undo、不完全な `入力 >>` の `P006: Expected process identifier` と Undo 回復を独立 reviewer が確認 |
| debug の相互移動・tab・大きい図 | `design` の double click→source 4 行目、Welcome / 日本語 / workflow の source と図の隔離、大きい workflow の表示、wheel zoom、minimap の別領域移動を独立 reviewer が確認 |
| 日本語 IME | ユーザー自身が「前面に出した・IMEも正常」と確認。reviewer の貼付操作とは別の composition / commit の証拠。Monaco と shared DOM は同じ版だが、最新 release の IME は独立に再測定していない |
| release の native folder | folder picker→`docs/samples` の 20 文書一覧→`05-label-cjk.pfdsl` の source・日本語図を独立 reviewer が確認 |
| 最新 release の dirty close | 合成 Welcome を `Close acceptance test` に変更。native sheet の Keep Editing で source・図・dirty 印を保持、再 close→Discard で当該試験 process が exit 0。ユーザーの debug 編集は保持 |
| 最新 release の clean close | 全 tab の dirty 印がない状態から close。sheet なしで当該試験 process が exit 0。操作ツールの終了後の再取得は別 app を自動起動するため、process の終了記録と照合 |
| pan の実機操作 | DOM regression は成功。native 左 drag は操作ツールの `-10005: noWindowsAvailable` または位置変化未観測により未確認。実機合格と扱わず、#1259 の preview 操作受入へ残す |
| 全体検査 | build / typecheck / lint と全 package・script tests が成功。script tests は 2535 pass / 0 fail、import・shell・CLI 規約検査も成功。初回のローカル受入記録時点では macOS CI は未実行。公開後の結果は [PR #1364 の checks](https://github.com/takasek/pfdsl/pull/1364/checks) で確認 |

独立設計 reviewer は変更を含まない基準 tree から文書処理・mount / dispose の境界を検討した。
最終差分 reviewer は品質、correctness、採用理由の実現と変更外の消費者を確認し、未解決の P1/P2 finding はない。
体験 reviewer は実装差分を渡さず app とシナリオだけで操作した。
終了確認の async 契約、フォルダ読取の pathname 置換、初回中心・focus の古い frame、native report の実行版識別に対する指摘は修正し、回帰・再レビューを実施した。

## 白い画面の再確認

試作の `experiments/standalone/RESULTS.md` が残す白い採取画像について、今回も背景側の縮小画像や `noWindowsAvailable` を観測した。
前面表示後の editor・日本語・編集再描画・大きい図は確認でき、同梱 app の corpus 実行中には JavaScript / CSP error を検出しなかった。
最新の native 終了確認は main window の sheet として AX で取得できたが、親を指定する前の別 window dialog は操作ツールに現れず、ユーザーのスクリーンショットで表示を確認した。
画面採取・前面状態と描画の切分けまでの観測であり、試作時の根本原因や長時間の白画面不発生を証明したものではない。

## macOS 下限の候補と制約

最低 macOS の候補は設定上の `11.0`。
Tauri 2.11.6、対応 runtime 2.11.3 / runtime-wry 2.11.4、Monaco 0.57.0、WebKit の ES2022・WebAssembly・worker・IME が制約となる。
設定は対応保証ではなく、11.0 の実機と同梱 frontend の API 適合は未確認。
今回の試作由来の native PDF API は製品基盤へ取り込んでいない。
PDF を扱う #1261 で WKPDFConfiguration 等の制約を追加し、#1262 で宣言する下限の実機受入を行う。
同梱 frontend は WebAssembly Graphviz、Monaco の worker、ES2022 と CSP の `wasm-unsafe-eval` を使用する。
Tauri の bundle 下限だけから WebKit / Monaco の対応を推定しない。
[Monaco maintainer の browser 方針](https://github.com/microsoft/monaco-editor/discussions/4283) と [WebKit の CSP 修正記録](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) を踏まえ、下限候補の実機では起動、WASM、worker、CSP、入力・IME、編集再描画と大きい図を同じ同梱版で確認する必要がある。
今の対応を保証できる実測範囲は上記の macOS 27.0 の一台に限る。
