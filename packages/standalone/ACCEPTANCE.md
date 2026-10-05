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

## 追加 UI の受入範囲

| 要求 | 実装のまとまりと共有点 | 完了判定 |
| --- | --- | --- |
| #483 と #1282 の preview UI | 共通 Node actions に定義作成と input/output/feedback の接続を実装。各 host の単一 Undo 操作へ適用 | 2026-10-05 の追加実装。人間の確認と native Tauri の受入は未了 |
| #1282 の CLI 操作 | `meta create` が初期 scalar field・preview/write・完成 source 検証を core の CST writer へ接続 | CLI tests で検証。UI の受入と分ける |
| #1284 と旧 #1285 の移動先強調 | 中心の incident primary/feedback edges に限る局所 SVG と共通 cue を実装。再描画だけでは cue を出さない | 共有 DOM と production frontend を検証。旧 #1285 の close は完成根拠にしない |
| #1283 の editor 内巡回 | authored 定義キーと AST の全 ID range を巡回。VS Code command・context menu・chord を接続 | 同一行反復・quoted key・同名 field・alias・編集後増減を検証。アプリの専用巡回 command は範囲外 |

## 2026-10-05 の編集・移動機能

作業ブランチは `codex/issue-1352-preview-editing`。
この節は上の基盤段階の記録から進んだ機能を扱い、後続の2026-10-04の native 証拠を今回の実行版の証拠として使わない。
#1352 に加えて、所有者の指示で #1282・#1283・#1284・#483 を同じ作業範囲に含めた。
roadmap の対応 artifact は wip を維持し、issue の元の受入条件を狭めない。

共有編集要求は候補を得た source を添え、古い文書・kind・target・破棄後の要求を拒否する。
VS Code は一つの WorkspaceEdit、アプリは Monaco の executeEdits と Undo stop を使う。
既存 quoted ID は core の formatId で直列化し、新規 ID は従来の bare-ID 制約を持つ。
定義作成後は authored sourceMap から label の値を選択し、produced artifact の criteria 入力を案内する。

周辺図は metadata のない node と孤立 node も描き、primary と feedback の向きを保つ。
hover target・render revision・dispose を照合し、metadata と SVG は同時に採用する。
wire graph は表示に必要な文字列・文字列配列と style へ射影し、循環 YAML の拡張 object を配送しない。
editor の semantic node 選択と局所図のクリックは同じ一時 cue へ接続し、reduced motion ではアニメーションを抑える。

巡回は `Ctrl+K Ctrl+Alt+N`、macOS では `Cmd+K Cmd+Alt+N`。
定義へ直接移動する command は末尾 D の別 chord に保ち、拡張の Alt+F12 割当は撤去した。
sourceMap が alias use site や複数 ID に重なる位置しか持たない場合、巡回は本文 occurrence を使う。
直接定義移動の alias target は従来の契約を維持する。

| 検証層 | 結果と限界 |
| --- | --- |
| 実装・共有計算 | TDD と全 package tests が成功。core 1099、CLI 835 pass / 1 skip、editor 218、extension 137、standalone 5。scripts/hooks 2992 pass / 0 fail、import・shell・CLI 規約検査も成功 |
| 型・生成 | 全 build/typecheck が成功。CLI help の生成 README・skill mirror、配置/scaffold 同期を確認 |
| 独立差分レビュー | 品質・correctness・採用理由と外部 consumer を確認。quoted ID・prototype ID・循環 metadata・CRLF・選択範囲の指摘を修正して再レビュー |
| production frontend / Monaco | 定義作成・label 編集・一段 Undo/Redo・6通りの connector・古い menu・tab 分離・1-hop SVG・tooltip 内 scroll/click・画面端・既存 zoom/pan を実操作。定義キーからの cue を修正後に再確認 |
| VS Code の実 command | 同じ固定版1.132.1の隔離 host で、巡回 chord・同一行反復・直接定義 chord・同名 field での非移動を確認。詳細シナリオの確定記録は下の evidence に対応付ける |
| native Tauri | 所有者の許可で Rust の最小構成を導入し、今回の debug .app build と Rust unit tests 2件が成功。[ビルド・テスト抜粋](evidence/2026-10-05-preview-ui/native-build-and-tests.txt)、[native corpus 23文書の結果](evidence/2026-10-05-preview-ui/native-corpus-report.json)、[独立した通常 GUI の記録](evidence/2026-10-05-preview-ui/native-gui-review.md)を保存。GUI の未確認項目と表示差は下記に残す |
| 人間による受入 | 未了。最新 frontend/extension を操作した所有者の結果を得るまで、機能完成・issue close・サイクル終結と扱わない |

macOS 27.0 arm64、Xcode は導入済みだった。
最初の native build は cargo 不在で開始できず、所有者の追加許可を受けて公式 rustup の minimal profile で cargo/rustc 1.99.0 と標準ライブラリを導入した。
shell の起動設定は変更せず、今回の build では `~/.cargo/bin` を PATH に加えた。
debug executable の SHA-256 は `d005c101d6154b81f7fdcc7eabd0d73ed0e2f940100f723f98268224d3c620b2`。
この binary とその frontend build 入力での独立 GUI 観測記録を固定し、後続の修正が入った実行版への読み替えはしない。
native corpus は20 sampleと3運用図の23文書で、各比較が成功し、failures/errors は空だった。
これは native reader・処理・描画の比較であり、GUI の操作や IME の受入とは分ける。
[実行 report](evidence/2026-10-05-preview-ui/native-corpus-report.json)の execution に、実行中 binary の SHA-256 と path を保存した。
[baseline の指紋要約](evidence/2026-10-05-preview-ui/native-baseline-fingerprints.json)は入力文書と expected snapshot の hash、および frontend 10ファイルの build 入力を保持し、展開済み model・DOT・SVG を含む完全な baseline とは区別する。
Tauri は frontend を実行 binary へ組み込むため、build 入力の指紋を実行時に抽出した frontend の指紋とは扱わない。
[corpus の lifecycle](evidence/2026-10-05-preview-ui/native-corpus-lifecycle.json)は report の存在を確認後、親が専用 PID 69017 を終了し、exitAfterCleanup が -15 だったことを示す。

独立 reviewer が検証用実行ファイルを直接起動した PID 70127 は、起動から約0.2秒で SIGABRT により停止した。
stack は HIServices のアプリ登録から AppKit/tao の window 初期化を指し、文書編集の開始前だった。
同じ .app を正規のアプリ起動経路で取得すると別 PID 70217 で通常画面を表示できた。
直接起動の failure と通常起動成功を区別し、根本原因が解決したとは扱わない。
添付されたクラッシュ記録の個人・端末識別子は共有 evidence に転載しない。

通常 GUI は新しい disposable corpus の文書を、その試験 app の初期タブへ UI 経由で貼り付けて観測した。
[凍結した独立レビュー](evidence/2026-10-05-preview-ui/native-gui-review.md)、[構造化 report](evidence/2026-10-05-preview-ui/native-gui-report.json)、[統合した AX 観測](evidence/2026-10-05-preview-ui/native-gui-ax.txt)を同じ実行版の証拠とする。
未定義 process の Create definition と label 編集は、それぞれ一回の Undo/Redo で戻し・復元した。
input・feedback・output の各接続は新規 ID と既存 artifact の両方を追加し、計6通りの接続式を実 editor の AX 本文で確認した。
[output の画面](evidence/2026-10-05-preview-ui/native-gui-14-output-fit.png)では、draft から manuscript と reserve への分岐も観測した。
二つのタブは文書と zoom 値を保持し、壊れた YAML の FM002 から正常な raw→refine→final の図へ復帰した。
[エラー時](evidence/2026-10-05-preview-ui/native-gui-18-recovery-error.png)は図の操作が disabled となり、[復帰後](evidence/2026-10-05-preview-ui/native-gui-19-recovery-restored.png)は操作が有効になった。
71ノードの大きい図は Fit が6.2%となり、100%への切替でも図を観測した。

座標 click と scroll は、専用 app が生存したまま操作基盤の `-10005: noWindowsAvailable` となった。
hover の周辺 SVG・隣接 node の移動と cue・mouse pan・minimap のポインタ操作・node の double-click・editor→preview の cue は未確認で、実機合格とは扱わない。
Open folder の picker は Where: corpus まで到達したが Open が disabled のままで、フォルダ一覧の操作は未確認だった。
画面画像の editor には古い Welcome または Separate tab の文字が残り、更新後の AX 本文と主図に一致しなかった。
大きい図の最終観測では、主図が Large native pan exercise に更新された一方、minimap の画面と AX には直前の Recovery exercise が残った。
[正規の Raise 後の画面](evidence/2026-10-05-preview-ui/native-gui-21-final-raised.png)でも差が残ったため、画面取得・compositing と利用者に見える製品表示のどちらが原因かは確定せず、editor の可視描画と minimap の同期を認定しない。
dirty な試験 app は Cmd+Q で終了し、確認画面は観測しなかった。
window の close button による安全な終了と IME composition→commit は今回未確認である。
専用 PID 70127・70217 の終了、四つの試験入力の hash 保持、実行 binary の前後 hash 一致を確認した。
[証拠 manifest](evidence/2026-10-05-preview-ui/native-evidence-manifest.json)に原本と保存物の指紋および path 正規化の境界を記録した。

独立した browser/VS Code と CLI の体験レビューは、[証拠一覧](evidence/2026-10-05-preview-ui/README.md)から凍結 report・版別 asset hash・構造化操作結果へ辿れる。
CLI の28シナリオで見つかった回復案内の引用不足と、追加の option 形 ID の反例を修正し、実 built CLI の回復コマンドを POSIX shell へコピーする4ケースが成功した。
browser の一度の `p.map` 例外は親の実操作追試で3回再現し、prototype名ノードの tooltip metadata を継承プロパティと取り違える条件へ特定した。
authored metadata の producer と JSON 往復、および consumer の判定を修正し、回帰テストで Red→Green を確認した。
別 reviewer の実 Graphviz/DOM による12ケースと、[修正後の実 browser 追試](evidence/2026-10-05-preview-ui/browser-parent-recheck-after-fix.json)の3反復で例外は観測されず、quoted current→valid new target の接続と単一 Undo/Redo、主図/minimap の node ID 一致も確認した。
これらを native の可視描画一致や未確認操作の認定には用いない。

修正後の [最終 native build](evidence/2026-10-05-preview-ui/native-final-build.txt) が成功し、executable SHA-256 は `842cc46e7be18eee3fdb11fcaacdaf7ca6731841dacf8c0c6d25c12a8950d558`。
[最終 corpus report](evidence/2026-10-05-preview-ui/native-final-corpus-report.json)でも23文書すべてが成功し、failures/errors は空だった。
[入力指紋](evidence/2026-10-05-preview-ui/native-final-baseline-fingerprints.json)と [専用 PID 34977 の終了記録](evidence/2026-10-05-preview-ui/native-final-corpus-lifecycle.json)を保存した。
最終 corpus は固定した入力 snapshot を比較し、その後の GitHub updated_at 同期による運用図の日時変更は runtime code の検証と分ける。
最終版の full native GUI 受入は実施しておらず、先の独立 GUI 観測版と区別する。

### 2026-10-05 の表示同期の追加修正

上の可視 editor と minimap の不一致は、追加の親による native 操作で `842cc46e…` の版でも再現した。
主図と AX source は新しい Foreground redraw test へ更新された一方、可視 editor と minimap は Welcome to PFDSL のままだった。
共有 preview の主図は同期で差し替わるが minimap は次の animation frame を待ち、Monaco の通常の行描画も frame を待つ経路だった。
frame を実行しないテストで主図と minimap の差を再現し、hidden tab の更新で旧 minimap を残す条件も Red にした。
修正後は render 完了時に主図と minimap を同期し、寸法を取れない hidden tab は旧 minimap を消して再表示時に現在の図から再構築する。
standalone は対応する図を差し替える前に Monaco の公開 render API で表示用の行を更新する。
OS 自体の repaint や、操作基盤が frame を抑制する理由まで確定した修正とは扱わない。

[親の実行記録](evidence/2026-10-05-preview-ui/display-sync-parent.json)は、修正前後の binary、source の指紋、native 操作の転記、検査ログの指紋と証明範囲を保存する。
修正後の binary は `e0a697fa4007ee13831bc79f4285264fc244048bd72f76d6ee4d23c57831a5a9`。
同じ source 貼替えを通常起動した native app で行い、可視 editor・AX source・主図・minimap が Foreground redraw test に一致する画面を確認した。
追加の回帰2件は Red→Green、editor 220件、extension 137件、standalone 5件、全 workspace の型検査と build、debug .app build が成功した。
上の全体テスト（editor 218件）と23文書 corpus の記録は `dd5df03f` の固定証拠であり、追加修正後の全件実行として読み替えない。

別の blind native reviewer も `e0a697fa…` で短い source の可視 editor・AX・主図・minimap の一致を確認した。
ただし、長い現文書で Cmd+Up を実行すると論理 cursor と AX は先頭へ移る一方、可視 editor が末尾の行と caret を残す追加の反例を得た。
[この版の native report](evidence/2026-10-05-preview-ui/native-display-recheck-report.md)は修正前の観測として凍結する。
独立した実 Monaco と production browser でも、frame を停止した同じ先頭移動で末尾表示が残る Red を再現した。
Monaco 0.57.0 の公開 cursor event は reveal と scroll の適用より先に届くため、cursor callback 内の直接 render だけでは旧 viewport を描く。
content・cursor selection・scroll の公開 event を一つの microtask にまとめ、同じ操作の reveal 後に公開 render API を呼ぶよう修正した。
破棄後の callback は抑止し、この表示更新では文書処理や Graphviz を再実行しない。

[追加差分の独立レビュー](evidence/2026-10-05-preview-ui/browser-scroll-review.md)で品質・correctness と event 順序の主張を確認し、未解決の指摘はない。
[実 browser の Red](evidence/2026-10-05-preview-ui/browser-scroll-red.json)から、同じ Cmd+Up・Cmd+Down・selection と collapse・direct wheel の [Green 4件](evidence/2026-10-05-preview-ui/browser-scroll-green.json)を確認した。
可視行は viewport 内へ clip して物理位置で並べ、Monaco が再利用する DOM の挿入順を可視行順と取り違えた初回 checker の失敗を製品の Red と数えない。
先頭移動後は1行目、wheel 後は3行目からの表示となり、主図/minimap の semantic ID は一致し、pageerror は空だった。
callback 回数と破棄抑止は source の静的照合であり、production の計数実測は行っていない。
追加修正の [独立設計](evidence/2026-10-05-preview-ui/display-sync-design-review.md)は、解答を含まない `origin/main d1fd7d87` の選択4ファイルから公開 API の同期描画と post-command の集約を導出した。
[起点と指紋](evidence/2026-10-05-preview-ui/display-sync-design-baseline.json)に静的検討の範囲を固定し、最終差分・実行証拠のレビューと区別する。
[採用理由の独立照合](evidence/2026-10-05-preview-ui/display-sync-adoption-review.md)では、通常の dirty flush、既存 layout の同期描画、microtask による同期再入の回避と寿命判定を installed Monaco に照合し、具体的な未解決 correctness finding はなかった。
任意の自動 layout 条件や render 由来 event 連鎖の厳密な callback 上限は、追加実測の範囲に含めない。

最終 native executable は `68a76bae1ff661517f48cbfdd07ca115fd4c9fa2b547de7cbfcf985b5c1e7a29`。
[同じ試験入力の blind native 再実行](evidence/2026-10-05-preview-ui/native-scroll-recheck-report.md)では、Cmd+Up 直後の次の採取で可視 editor の1行目と caret が先頭へ更新し、採取前に tab 切替や Raise による修復を挟んでいない。
短い source の一致、後続の tab 往復と現文書保持、実行 binary の前後 hash 一致、専用 process の終了も確認した。
最初の本文・主図・minimap の版不一致と、追加の cursor/viewport の遅れは、この修正後の再現シナリオでは解消した。
物理的な最初の frame の時刻、OS の前面状態、極小 minimap の全 label の視認性まで認定した記録ではない。

[最終追加検査](evidence/2026-10-05-preview-ui/display-sync-final-checks.json)に build・全 workspace 型検査・standalone 5件・debug .app build の成功を保存した。
[最終 native corpus](evidence/2026-10-05-preview-ui/display-sync-final-corpus.json)は同じ `68a76bae…` の23文書すべてが成功し、failures/errors は空だった。
[入力指紋](evidence/2026-10-05-preview-ui/display-sync-final-fingerprints.json)は参照 HEAD と working-tree 入力を区別し、[専用 PID 73656 の終了記録](evidence/2026-10-05-preview-ui/display-sync-final-lifecycle.json)も残す。
変更のない共有 editor 220件と extension 137件は先の追加修正の実行を再利用し、最終版の全 workspace test を再実行したとは扱わない。
native hover・mouse pan・source cue・folder picker・安全な window close・IME、追加 VS Code preview 操作と所有者の UI 受入は引き続き未確認である。

### main の取り込み後の確認

所有者の承認で、既存 PR ブランチへ main `9bcd6d6fd6711dac861adac385468aa292fd654b` を履歴を保って取り込んだ。
extension README と preview のテストの競合は、main のファイル移動と今回の編集・フォーカスの説明・テストを両方保持して解消した。
[独立した統合差分レビュー](evidence/2026-10-05-preview-ui/main-merge-review.md)は両親のテスト名・実装・消費者を照合し、修正必須の finding はなかった。
表示同期の3ファイルは取り込み前の `3a5ac77e` と byte-for-byte 同一である。

[統合後の全体検査](evidence/2026-10-05-preview-ui/main-merge-checks.json)は build を含む全 workspace test・型検査・lint・配置/scaffold 同期・debug .app build の成功を記録する。
core 1123、metadata-exporter 9、graphviz-exporter 179、preview-engine 25、editor 220、CLI 844 pass / 1 skip、extension 168、standalone 5、scripts/hooks 3013 pass / 0 fail / 0 skip。
import 171、shell 217、CLI 引数規約 216 の検査も成功した。
これは解消済み working tree の新しい全件実行であり、先の固定版の結果を読み替えたものではない。

native executable `f6005842e1a7de061d531d09da67002b46d9c9eae89ebac1a19f04bca4451412` の [23文書 corpus](evidence/2026-10-05-preview-ui/main-merge-corpus.json)はすべて成功し、failures/errors は空だった。
[入力と build 指紋](evidence/2026-10-05-preview-ui/main-merge-fingerprints.json)は取り込み前の参照 HEAD と、main の変更を含む実際の working-tree 入力を区別する。
親の待機処理は誤ったファイル名 `report.json` を待って失敗したが、host が出力した `native-report.json` を別途読み戻し、23入力・10 frontend ファイル・実行 binary の hash を現ファイルと照合した。
[lifecycle 記録](evidence/2026-10-05-preview-ui/main-merge-corpus-lifecycle.json)はこの確認処理の誤りと、専用 PID 88331 の終了・wait を両方残す。

[同じ統合版の blind native 追試](evidence/2026-10-05-preview-ui/main-merge-native-recheck-report.md)は、短い本文・AX・主図・minimap の identity の一致を確認した。
長い文書の Cmd+Up は直後の採取で1行目と先頭 caret が表示され、採取前に tab 切替・Raise・前面化を挟んでいない。
別 tab からの復帰も可視 source・主図と71 node controls が維持され、binary/fixture の前後 hash と所有 PID 93529 の終了を確認した。
[manifest](evidence/2026-10-05-preview-ui/main-merge-native-recheck-manifest.json)は4枚の PNG、AX と report の保存 bytes を固定する。
この観測は全 source の byte 単位の保持、極小 minimap の71 label の視認、native gestures/IME/所有者の UI 受入を認定しない。

## 検証記録と限界

作業ブランチ: `codex/shared-ui-host-foundation`。
基準の commit と working-tree corpus の source hash は、native baseline / report に保存する。
全機能を #1257 だけで移植すること、機械テストで IME・配布物・過去 OS の対応を認定することはしない。

2026-10-04、Apple Silicon arm64 / macOS 27.0 (26A428) の local `.app` で検証した。
最終 release executable の SHA-256 は `373d731c7061c69d86435909d81b11167572558a5c0bc34bf7300673681919f7`。
[native report](evidence/2026-10-04-native-report.json) に実行中 binary・同梱 frontend・入力 source の hash と各文書の結果、[環境記録](evidence/2026-10-04-environment.json) に実測 OS と Mach-O arm64 を残した。
report の userAgent は WebKit の互換文字列であり、実際の OS / CPU の判定には使用しない。

| 検証 | 結果と証拠の範囲 |
| --- | --- |
| 共通処理の TDD・package tests | editor 144、extension 111、standalone 5 が成功。移動した既存テストに加え、未保存 source / preset 分離、複数 mount、破棄、古い描画・位置・focus、drag、終了確認と preset の二重読取による不整合の回帰を Red → Green で確認 |
| native 読取境界 | locked Rust tests 2 が成功。選択外・traversal・symlink escape と、選択後に元 pathname を置換した状態を検査 |
| production adapter 同値性 | top-level sample 20 と運用 PFD 3 の全 23 文書で authored model / sourceMap、診断の code・severity・message・range、継承 frontmatter・preset 診断、format、DOT と SVG を比較。Node 上の両 production adapter と native の両経路が成功 |
| native corpus | 最新同梱 frontend が native reader で読み、共通 DOM に全 SVG を mount。23/23 成功、failures / JS errors は空。最後に現在の入力・frontend 10 ファイル・実行 binary の hash と照合 |
| VS Code の既存導線 | VS Code 1.132.1 の実 extension host で preview 起動、sample の 6 node 表示、終了 cleanup が成功 |
| debug の実 editor、前面表示後 | 日本語貼付→図更新、Undo / Redo、Format→Undo、不完全な `入力 >>` の `P006: Expected process identifier` と Undo 回復を独立 reviewer が確認 |
| debug の相互移動・tab・大きい図 | `design` の double click→source 4 行目、Welcome / 日本語 / workflow の source と図の隔離、大きい workflow の表示、wheel zoom、minimap の別領域移動を独立 reviewer が確認 |
| 日本語 IME | ユーザー自身が「前面に出した・IMEも正常」と確認。reviewer の貼付操作とは別の composition / commit の証拠。Monaco と shared DOM は同じ版だが、最新 release の IME は独立に再測定していない |
| 簡素化前 release の native folder | folder picker→`docs/samples` の 20 文書一覧→`05-label-cjk.pfdsl` の source・日本語図を独立 reviewer が確認 |
| 簡素化前 release の dirty close | 合成 Welcome を `Close acceptance test` に変更。native sheet の Keep Editing で source・図・dirty 印を保持、再 close→Discard で当該試験 process が exit 0。ユーザーの debug 編集は保持 |
| 簡素化前 release の clean close | 全 tab の dirty 印がない状態から close。sheet なしで当該試験 process が exit 0。操作ツールの終了後の再取得は別 app を自動起動するため、process の終了記録と照合 |
| 簡素化後 release の GUI | 独立 reviewer が指定 app の `PFDSL — Acceptance` を取得したが、AX は window chrome のみ、採取画像は空白。Raise 後も同じで、前面起動 API は利用不能。編集・Undo・移動・tab・dirty close の新しい実機証拠は得ていない。アプリ機能の失敗とは判定できない |
| 簡素化後 release の未編集終了 | corpus 完了後、編集操作のない検証 window の close button を実行し、起動した当該 process の exit 0 を確認。画面内容の正常性や dirty close の証拠とは分ける |
| pan の実機操作 | DOM regression は成功。native 左 drag は操作ツールの `-10005: noWindowsAvailable` または位置変化未観測により未確認。実機合格と扱わず、#1259 の preview 操作受入へ残す |
| 全体検査 | build / typecheck / lint と全 package・script tests が成功。script tests は 2535 pass / 0 fail、import・shell・CLI 規約検査も成功。初回のローカル受入記録時点では macOS CI は未実行。公開後の結果は [PR #1364 の checks](https://github.com/takasek/pfdsl/pull/1364/checks) で確認 |

独立設計 reviewer は変更を含まない基準 tree から文書処理・mount / dispose の境界を検討した。
最終差分 reviewer は品質、correctness、採用理由の実現と変更外の消費者を確認し、未解決の P1/P2 finding はない。
体験 reviewer は実装差分を渡さず app とシナリオだけで操作した。
終了確認の async 契約、フォルダ読取の pathname 置換、初回中心・focus の古い frame、native report の実行版識別に対する指摘は修正し、回帰・再レビューを実施した。

簡素化では VS Code の転送用 module と不要な package subpath、無効な debug script / log を削除し、各 consumer を共有 package の入口へ接続した。
アプリ全体の管理は `src/main.ts`、Monaco と preview を対にする tab 内部の状態・操作は `src/document-tab.ts` が担当する。
preset の表示と診断は一度読み取った依存 snapshot を使用する。
独立 reviewer が品質・correctness と prototype / build / roadmap の消費者を再確認し、未解決 finding はない。
既存の共通サービスと host 責務の方式は維持し、新しい編集 UI は追加していない。
23 文書の native 証拠は簡素化後の source・frontend・実行 binary に更新し、簡素化前の release GUI は executable `4cabd95a31ae5a17eae2de26c8b6c687b29adbcaa803543274b0ddc355e8a449` の観測として区別した。

## 白い画面の再確認

試作の `experiments/standalone/RESULTS.md` が残す白い採取画像について、今回も背景側の縮小画像や `noWindowsAvailable` を観測した。
簡素化前 debug の前面表示後の editor・日本語・編集再描画・大きい図は確認でき、同梱 app の corpus 実行中には JavaScript / CSP error を検出しなかった。
簡素化前 release の native 終了確認は main window の sheet として AX で取得できたが、親を指定する前の別 window dialog は操作ツールに現れず、ユーザーのスクリーンショットで表示を確認した。
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
