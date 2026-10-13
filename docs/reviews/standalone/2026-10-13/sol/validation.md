# 公開保存用加工版

この文書は指定commitでの当時の評価を保持する。
画像・私的パス・未収録資料へのリンクを整理した。
モデルとshitae固有の根拠は別リポジトリへ引き継ぐ。
[収録範囲と加工方針](../README.md)。

# デザインレビューの対象版と検証記録

## 対象と実行環境

| 項目 | 記録 |
| --- | --- |
| 評価日 | 2026年10月13日、日本時間 |
| 最終PFDSL対象 | `83701fb03e7846fe9582a3ae3b685d624f681902`。origin/mainの取得済みtipと一致 |
| 旧PFDSL対象 | `266cbb3196de6d274353b9d6ce91befb424e45f2`。比較画面のみ保持 |
| shitae対象 | `a3ebaedbd5d452c99093a949bbaf94508da43ab4` |
| PFDSL専用worktree | 私的な絶対パスを公開保存版では省略 |
| ローカル作業ブランチ | `codex/standalone-design-review-sol`。実装差分、commit、pushなし |
| shitae専用checkout | 私的な絶対パスを公開保存版では省略 |
| 実行OS | macOS 27.0.1、build 26A434、arm64 |
| native実行ファイル | 私的な絶対パスを公開保存版では省略 |
| ビルドされた実行ファイルSHA256 | `cb51424a2c730c10816f7972f90669ca76dc24fc34765eb13ff4592c526a43f8`。release/pfdsl-desktopで測定 |

起動用 `evidence/native-review.config.json` は製品名、識別子、タイトルを変更し、1280×800の既定サイズを保つ。
レイアウトや機能のソースは変更していない。
製品名の変更によりnative titleの見た目だけは元設定と異なる。
対象commitは途中のユーザー指示で変更し、旧版の所見を最新対象へ再照合した。

## 準備とローカル検査

| 検証 | 結果 | 確認できる範囲 |
| --- | --- | --- |
| origin取得、native create_worktree、HEAD確認 | 指定旧版から開始し、最新tipへfast-forward | 対象版と所有するcheckout |
| PFDSL setupとbuild | 旧版・最新版とも成功 | JSの依存と共有ライブラリ、フロントエンド生成 |
| Tauri app build | 最新版exit 0、app生成 | nativeのコンパイルとパッケージ生成 |
| standalone connector-producer.test.mjs | 1 test pass、0 fail | 第二生成元追加の拒否時の本文・入力・Undo境界の既存検証 |
| shitae install、全package build | exit 0 | 指定版のCLIとsimulatorを実行できること |
| 3モデルcheck | 全てexit 0、error 0。W103は30、31、最終版recoveryは9 | 構文・静的診断。葉の警告は承知して保持 |
| Mermaid生成 | 全てexit 0 | 遷移のテキスト生成。別途check結果を参照 |
| simulator HTML生成 | 全てexit 0、ファイル終端あり | 完全なHTMLの生成 |
| 生成HTML内のJS構文 | 全てnode --check exit 0 | 埋込みscriptの構文 |
| pipe切断再現 | 3/3でexit 0、65,536 bytes、HTML終端なし | 指定shitae版のpipe捕捉での出力問題 |

nativeの初回ビルドはCargoがPATHにないため失敗し、既存の `[local artifact: bin`] を明示して再実行した。
guardが受理しないcloneのオプション、実行先が暗黙の呼出し、heredocは通常の明示targetとscriptファイルへ訂正した。
guardの無効化やtrusted-rootの拡張は行っていない。
ログは 最新nativeビルド（参照資料はこの保存版に未収録）、旧nativeビルド（参照資料はこの保存版に未収録）、モデル検査（参照資料はこの保存版に未収録）、生成とpipe検査（参照資料はこの保存版に未収録） に保存した。
TauriのSTATIC_VCRUNTIME非推奨、JS chunkサイズのビルド警告は残っており、日常操作の性能合格には使わない。

## 実際に操作した範囲

| 経路 | 観察結果 | 証拠種別 |
| --- | --- | --- |
| 最新app起動 | 日本語文書、ソース、図、サイドバー、操作ボタンが表示 | native、初期スクリーンショット |
| Fileメニュー | Close Window、Close Allのみを観察 | native、ツールのAX出力 |
| New | Untitled 3の文書が追加された | native AX |
| `a >>` の入力 | 未保存点、P006診断、図の操作を利用不能化 | native AX setterによる実入力 |
| `a >> p -> b` への修正 | 図のa、p、bと図の操作が復帰 | native AX |
| 終了要求 | Save changes to Untitled 3?、Save／Discard／Cancelが出た。検証入力をDiscard | nativeの確認sheet。保存処理は試していない |
| 313行サンプルの入力 | 本文AXを取得できず表示内容の確認に至らない | native未確認。`native-large-graph.ax.txt`は本文を含まない |
| 1280×800の領域幅 | ソース350.89、図702.11、サイドバー227 CSS px | web DOM実測、`web-1280-layout.json` |
| 900×650の共有UI | ソース224.22、図448.78 CSS px。正規化出力とミニマップの重なり | web DOM実測とスクリーンショット |
| 出力ノードへの第二生成元追加 | V001と既存の生成元の説明がパネル内に出て、入力を保持 | 最新webの実操作 |
| 正規化出力を開く・閉じる | 補助カードが図に重なる。Closeで閉じる | web実操作 |
| 最後の文書を閉じ、Save・Format flowsを押す | 空白、利用可能に見える操作、結果の変化なし | web実操作、`web-empty.png` |
| webのNew | Newがactiveのまま。本文への入力はEditContextの操作制約で検証できず | web DOM。native入力へ切替 |

nativeスクリーンショットは初期には正常に取得できたが、追加試行中に縮小・回転したウィンドウ像になることがあった。
その像と、本文が欠落したAX出力から、nativeの文字や性能を評価していない。
短い文書の入力はnativeで検証できたが、通常の打鍵・日本語IMEを検証したことにはならない。
webはnativeファイル選択・保存を提供しないため、同じフロントエンドの包含・表示・DOM測定に限定して使った。
測定用のブラウザviewportは試行後にresetした。

## shitaeで実際に歩いた経路

proposedでSplit → Source → Diagram → NodeDoubleClick → Splitを歩き、部品の表示集合と戻り先を確認した。
Conflict → Reviewで復旧通知が比較中も残る初版の記述を発見し、hideを追加した。
再生成後のConflict → Reviewでは掲示カードが消え、KeepEditingでSplitと通知へ戻った。
その後CloseLastDocumentでNoDocumentとなり、文書操作・identity・ソース・図がなく、StartActionsが表示された。
このイベントは閉じる承認後を抽象化したもので、未保存確認そのものを省略する製品案ではない。
currentでもParseErrorとValidInputを歩き、WorkspaceはEditingを保ち、図だけが診断へ変わって復帰することを確認した。
proposedでも同じ診断と復帰を歩き、ソースと文書操作を残したまま図だけが変わることを確認した。
recoveryは静的検査・生成に限定し、nativeの保存成立を試したモデルとは扱わない。
保存成功・ディスク再変更のcondition labelを自動判定したとは扱わない。
最終proposedでParseError → DiagramOnlyを歩くとDiagramView.graphはgate offとなり、ValidInput後は操作してSplitへ戻れることを確認した。

## 独立レビューと方針の確認

別agentは実装時の会話を引き継がず、成果物、指定版の一次コード、保存証拠、生成JSの限定経路を照合した。
モデルの診断状態、包含部品の遷移、member gateの解決、警告集計、用語の不一致を修正した。
最終結果は今回の照合範囲に未解消の重大な不整合なし。
nativeを再操作したレビューや、保存安全性・可読性の再受入ではない。

意味論の修正が続いた時点で作業方針を再評価した。
現方式の継続は代表文書の三つのモデルと今回の経路の照合で目的へ届く一方、静的inventoryへの縮小は動く成果物の検討効果を失う。
全面的な状態機械やデータモデルへの変更はshitaeの境界を越え、今回の設計レビューに必要な範囲を増やす。
既存機能による包含状態の変更と実在component参照で継続し、診断・復帰・通知・空の状態を一括して再確認した。
この最終確認後に経路や保証を増やさず、残るnative受入は次の作業として保持する。

## 残る限界

実ファイルのOpen、Folder、Save、Save As、同名文書、外部変更、復旧の全経路、図からソースへのnative打鍵、IME、VoiceOver、200%文字拡大、contrast、dark外観、大きい図は未受入。
CIや全件テストの合格、配布・署名・インストール、別OSの品質は今回の対象外。
ユーザー作業の所要時間、迷いの件数、学習負担、shitae有無の比較成績は測定していない。
独立レビューは今回作成した記録とモデルの一次資料整合を確認するために行い、他の評価チャットの結論を共有しない。
