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
| 新規・開く・保存・Save As・最近の文書 | #1258 | 任意文書、手動保存、Undo / Redo、close | #1431 に実装。現在版の Mac 受入は下記の残件 |
| 外部変更、dirty 衝突、保存 race の保護 | #1258 | 保存前後の独立 writer、dirty 内容保持 | #1431 に実装。保存前検査の保証境界は「保存保証の簡素化と編集機能の集約」を参照 |
| 検索・置換、基本 Undo / Redo、日本語 IME | #1257 / #1258 | Monaco 実操作と composition→commit | 本番タブの検索・置換を接続。自動検査と現在版の Mac 受入を分けて下記に記録 |
| Alt+F12 と既定 Peek Definition の衝突 | #1283 | 採用キーと VS Code 設定の実操作 | 固定版 Linux VS Code の20条件成功。組込定義・Peek の対照は 2026-10-08 UTC の追補で確認。現在版への適用範囲は下記 |
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

## Linux verification and grouped preview acceptance

2026-10-07、所有者が #1408 と #1352・#1282・#1283・#1284・#483 をまとめて検収する方針を承認した。
当初は Linux の実起動・操作を PR 作成後に確認する指定であり、起動手順とローカル検査までを準備範囲とした。
同日、固定 HEAD `8261f877d5cae8aa653a5310edfbd9e387acb116` の Linux native 起動・folder picker・dirty close・corpus の成功と、既存5件の追加検収報告を受領した。
既存5件の実装は PR #1394 から引き継ぎ、新規実装からやり直さない。
[Linux の依存・ビルド・起動手順](README.md#linux-verification)を用い、確認した版と未確認条件を以下の各行へ対応付ける。

| 対象 | 実操作で確認する内容 | 今回の状態 |
| --- | --- | --- |
| #1408 の起動・読取 | 通常起動で native window を表示し、Open folder で使い捨てフォルダを選び、Rust host 経由で文書を editor と preview へ表示。選択キャンセル後も操作を継続 | 固定版 `8261f877` の dot Debian 13.6 で成功 |
| #1408 の終了・原本 | dirty な文書で window close → Keep Editing による編集保持 → 再 close → Discard による終了。検証用原本の前後 hash 一致を確認 | 同じ AppImage の通常操作で成功、process exit 0、原本 hash 一致 |
| #1352 の表示・回復 | 初回 Fit、100%、倍率と Help、zoom/pan 後の正常→エラー→正常、主図と minimap の整合、定義挿入後の編集案内。VS Code の起動手順と既存動線も確認 | native 17 / VS Code 27 条件成功。関連 issue の未確認と元 issue の検査追加条件は別に保持 |
| #1282 の定義作成 | 両ホストの Node actions から作成・作成位置への移動・単一 Undo/Redo。CLI の成功・拒否・初期 field・無書込みを別入口で確認 | native 9 / VS Code 9 / CLI 23 条件成功。2026-10-11 の個別完了判断を下記に追記。旧3失敗と証拠版の制限は保持 |
| #1283 の巡回 | VS Code の context menu と chord で定義→全本文 occurrence→定義を巡回。引用キー・同名 field・編集後の増減と既存直接移動を確認 | 2026-10-08 UTC の追補で組込定義・Peek 対照も成功し、VS Code 20条件成功。standalone の巡回 UI は対象外 |
| #1284 の周辺図・強調 | 両ホストで hover の局所 SVG、画面端・内部 scroll/click、editor と局所図からの移動、連続移動の cue、reduced motion、既存 pan/zoom を確認 | 右端 pointer 追補を含め native 16 / VS Code 21 条件成功、native 6 / VS Code 1 条件未確認 |
| #483 の接続編集 | 両ホストで input/feedback/output × 既存/新規 target の6通り、単一 Undo/Redo、再描画、既存 double click・pan を確認 | native / VS Code 各30条件成功。2026-10-11 に個別完了と判断。V001 の事前防止は別 issue へ分離 |

同じ source commit と検証用文書を使って操作をまとめるが、各 issue の全受入条件とホスト別の結果を保持する。
通常の folder picker と close は、初期フォルダを自動選択する corpus mode の成功だけでは認定しない。
Linux の native 操作、VS Code、CLI、macOS 固有の操作、人間の UI 受入はそれぞれの実行版と証拠で判定する。
#1408 の指定 Linux native シナリオは完了したが、束全体と既存5件の一括完了は認定しない。
対応 artifact の wip と元の criteria は維持し、未確認条件を成功へ読み替えない。
実行時は commit・未コミット差分の有無・executable と frontend の識別情報・OS/CPU・依存版・操作・期待/実結果・証拠・原本 hash・未確認条件を記録する。

### 2026-10-07 UTC の固定版検収と受入基準

対象は [run 37574418253 の AppImage artifact 11461844652](https://github.com/takasek/pfdsl/actions/runs/37574418253/artifacts/11461844652) と SOURCE_COMMIT `8261f877d5cae8aa653a5310edfbd9e387acb116`。
[受領報告と照合結果](evidence/2026-10-07-linux-appimage/README.md)に来歴・hash・環境・操作・制約と、[399 host cells の元判定](evidence/2026-10-07-linux-appimage/host-matrix.csv)を保存した。
dot の通常 native 操作が成功し、[native corpus report](evidence/2026-10-07-linux-appimage/native-report.json)も同じ reference と executable hash で23/23成功、failures / errors は空。
同 HEAD のローカル JS build と artifact frontend は10/10のファイル集合・hash が一致し、実行後も外側14件・AppDir304件と原本の保持を確認したという報告を受領した。
親は添付 ZIP の1,133 manifest entries、matrix の集計・証拠参照、corpus report の実行版を照合し、別 agent も集計と原要求への対応を確認した。
親による Linux GUI の再実行とは区別する。

追加5件の元集計は133条件 × 3 hosts = 399セル、対象212セルの成功200・失敗3・未実施9、対象外187。
失敗3セルは同じ inline YAML comment の位置変更を native / VS Code / CLI で観測したものであり、独立した3不具合ではない。
先の検査プロンプトは無関係なコメント位置の厳密保持を要求したが、[ADR-0034](../../docs/adr/0034-pfdsl-owns-frontmatter-format.md)は frontmatter 全体の CST 再整形を採用し、既存テストも位置変更を許容している。
この追加の厳格条件は既存契約と整合していなかったため、現行仕様の受入ではコメント内容・無関係な値・本文・改行の保持と、許容された再整形を区別する。
コメント位置の観測と厳格条件未達の元判定は改変せず、現行仕様違反が確定した製品不具合とは扱わない。
位置の固定保存を新たに要求する場合は、既存契約の変更として別途判断する。
未確認9セル、native raw CRLF bytes、semantic-invalid な接続候補の扱いも、この解釈だけで成功へ変更しない。

同じ8261固定版の追補では、I1284-012 / native の右端 tooltip を物理 pointer で開き内部を click する入口が成功した。
[最初の追補](evidence/2026-10-07-linux-appimage/README.md#同じ固定版の追補検収)時点では成功201・旧失敗履歴3・未確認8・対象外187。
2026-10-08 UTC の[残件追補](evidence/2026-10-07-linux-appimage/remaining-checks/README.md)で、所有者が許可した workspace-only trust と専用 profile による組込 definition / Peek 対照が成功し、I1283-019 / VS Code を更新した。
最新の累積は成功202・旧失敗履歴3・未確認7・対象外187であり、今回の変更はこの1セルだけ。
検収継続では、[lifecycle 自動検査](evidence/2026-10-07-linux-appimage/lifecycle-verification.md)として共有 preview 31件と実 standalone host adapter 1件が成功。
通常 native GUI の未確認判定とは分け、束の完了まで残る実画面確認を続ける。
初回と前追補の133条件 / 399セルの判定を保持し、各追補の status 変更を分けて記録した。
cue の4条件、同 process dispose、両 GUI の reduced motion は未確認のまま維持する。
この production artifact 試行では native の実 Monaco model の raw CRLF 保持も未確認で、通常 Save UI の追加は要求せず、全 issue の一括完了を認定しない。
同試行の連続録画でも native cue が見えず、正規 Inspector がないため class / computed style を取得できなかった。
同試行の OS setting 変更後も実効 GTK / VS Code webview は reduce へ切り替わらず、GNOME setting は元の明示 override の存在を記録しなかったため厳密な復元を証明できない。
値 true / 型 b への復帰と、元状態までの復元完了は区別する。

2026-10-08 UTC の[別 Inspector binary 診断](evidence/2026-10-07-linux-appimage/remaining-checks/inspector-results/README.md)を受領し、136件の manifest と原399セルの bytes 不変を照合した。
同じ製品 source / frontend の別 release binary では、class / selector / computed style と約1.5秒の解除が成立した一方、録画に期待する持続的な青い cue が現れず、computed state と captured presentation の境界に不一致がある。
SVG paint / clipping / compositor / capture 等の根本原因は未確定で、元 binary の4条件へ合否を転写しない。
実 Monaco model の定義作成前 / 後 / Undo / Redo は4状態すべて CRLF で、前と Undo、後と Redo の内容が一致した。
これは399セル外の診断 model の証拠であり、元 binary の保存 bytes や editor painting を認定しない。
breakpoint 付き model 操作中の Trusted Types 描画エラーは別観測として保持し、通常版での再現は未確認。
active xfsettingsd を特定したが、正規 xfconf write は publisher の blob / serial を変えず、実効 GTK / 両 webview は reduce に到達しなかった。
今回作成した property は現在 baseline の不存在へ厳密に復元され、GNOME は変更せず値 / 型 / override 存在も前後一致した。
現在 baseline の復元成功と、前試行の失われた歴史的 baseline を証明できないことは分ける。
既存の受入集計202 / 3 / 7 / 187と元判定は保持し、製品の描画問題とdot環境の設定伝播を別々に引き継ぐ。

続く[A / B / C の追加診断](evidence/2026-10-07-linux-appimage/remaining-checks/abc-results/README.md)では、独立 WebKitGTK 最小再現の SVG outline/drop-shadow が computed に現れながら renderer snapshot に描かれず、直接 SVG stroke と HTML の正対照は描かれた。
製品の特定 paint/compositor 原因は同定せず、明示的 shape stroke / overlay を未実装の修正候補として分ける。
active XSettings publisher に届く正規設定経路は見つからず、設定 write 0件、初期/終了8項目は一致し、両 GUI の reduced-motion 受入は未確認のまま。
production・diagnostic の未停止 create/Undo/Redo は正常描画、停止区間では getter 評価前の Trusted Types エラーと保存画像の一時的な行欠落を観測し、その後の Undo/Redo 画像は回復している。
親は124件の manifest、独立 snapshot の画素、raw Undo/Redo の旧値一致、設定8比較、原399セルの bytes 不変を照合した。
この追加診断で受入集計や製品 source を変更せず、通常版の regression や持続的 blank editor を認定しない。

test run `37574418226` は commit-associated run だが、実際の checkout は synthetic merge `96a306ac87951d6b050d83aed9770875025deaa9`。
固定 HEAD との差は VS Code smoke の2ファイルであり、同じ product / unit source の補助証拠と別 runner の smoke 成功を分ける。
実 Extension Development Host の操作結果は別の GUI 証拠として受領した。
desktop run `37574418253` の macOS native build は synthetic merge `96a306ac87951d6b050d83aed9770875025deaa9` で成功しており、固定 source HEAD `8261f877` の検査とは区別する。
macOS IME・shortcut・新しい実機 GUI、Linux 正式配布、他 distro は認定しない。
過去の `c42367f8` の WebKit 不足と `07f541ff` の GLES 不足は別試行として保持する。
後続の記録更新だけで PR HEAD が進んでも、native 検収済みの source / artifact は `8261f877` のままとする。

### 151d393 の通常 native cue 検証

追加 A/B/C 診断の後、[共有 preview の描画候補](evidence/2026-10-07-linux-appimage/remaining-checks/cue-candidate.md)として、SVG の兄弟に一時的な HTML outline を表示する。
元 SVG の色・点線・ラベルと minimap を保持し、既存 transform と対象切替・1500ms 解除・render/dispose の解除経路を使う。
共有 editor の237件と座標・保持・解除の自動検査に続き、2026-10-08 UTC、dot が固定 source `151d39345c6945c3fe11a75f558068d011cbe197` の通常 AppImage を実操作した。
[新版の受入記録](evidence/2026-10-07-linux-appimage/remaining-checks/production-151d393/README.md)の30項目は26成功・3未確認・1阻害点あり。
native I1284-014〜017、Fit / 100% / zoom / pan / 端付近 / 長い label / 既存色・点線の保持と限定した VS Code 操作は成功し、別枠の native corpus も23/23成功した。
両 GUI の実効 reduced-motion と native の個別 document dispose は未確認のまま。
正規の設定サービス経路に届かず設定変更は0件で、設定9比較・payload・原本の保持とアプリの正常終了を確認した。
固定8261の原集計202成功・旧失敗3・未確認7・対象外187は更新せず、新しい source / artifact の判定を別記録にする。

### PR 前のローカル検査

製品 source の基準は `52ea0dc14491ea21d2b5fa57db2ce3d364d05a2b`。
初期 PR 差分は README・受入記録に加え、desktop CI の linux-native job と pipeline companion の手順を含む。
この表は初期 PR 前のローカル検査であり、後続の AppImage / runtime / Inspector CI・hook・回帰テスト追加や dot 検収の検証範囲とは分ける。
製品 source・Tauri 設定・macOS CI は変更していない。
macOS 27.0 / arm64、Node.js 26.5.0、pnpm 10.33.2、cargo/rustc 1.99.0 で以下を実行した。
Linux 手順が案内する Node.js 24 は既存 CI の指定であり、今回のローカル実行版とは区別する。

| 検査 | 実結果と証明範囲 |
| --- | --- |
| `make setup` と `node scripts/setup-completion.mjs check` | 成功。専用 worktree の依存とセットアップ完了を確認 |
| `make build` と `make test` | 成功。core 1137、metadata-exporter 9、graphviz-exporter 179、preview-engine 25、editor 233、CLI 882 pass / 1 skip、extension 200、standalone 5、scripts/hooks 等 3027 pass / 0 fail / 0 skip。import 171、shell 217、CLI 引数規約 216 の検査も成功 |
| `cargo test --manifest-path packages/standalone/src-tauri/Cargo.toml --locked --lib` | 2 pass / 0 fail。選択フォルダの pathname 置換と範囲外読取の拒否を Mac 上で確認 |
| `pnpm --filter @pfdsl/standalone tauri build --help` | 導入済み CLI の `--no-bundle` と runner への追加引数境界を確認。Linux ビルドを実行した証拠ではない |
| `node scripts/check-md-linebreaks.mjs packages/standalone/README.md packages/standalone/ACCEPTANCE.md` | 成功。文書の文境界規約を確認 |

この PR 前のローカル検査時点では、Linux の依存導入・Rust unit・no-bundle build・native 起動・GUI 操作、Apple container 内での実行は未確認だった。
GUI smoke、macOS の新しい native GUI/IME 受入、所有者による UI 受入も、この PR 前の実行範囲には含めない。
PR 後の CI と dot の Linux 実操作結果は上の固定版検収として別に記録する。

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


## #1258 の隔離候補 — 2026-10-09 UTC（wip）

この節と以下の保存境界・stage 保全の記録は旧候補の履歴である。
2026-10-10 の利用者判断により、現在の保証範囲は後掲「保存保証の簡素化と編集機能の集約」に置き換えた。

基準は main `7dc51a6c5bb8088bb2a3ec7513cc295c322482b4` の専用 Git clone と専用ブランチ `codex/issue-1258-documents`。
最初の archive 候補とその v0 納品は履歴として保存し、この節は更新された候補の検証範囲を表す。
元 checkout、元 VS Code smoke runner、既存399セルと各固定版の受入判定は変更しない。
新規・文書/フォルダ読取・手動 Save/Save As・target だけの recent・文書ごとの dirty close を追加した候補であり、完了や現在版の実機合格を示さない。

native 保存は captured parent directory capability と単一 leaf に限定し、同一 directory 内の staging/write/sync 後に macOS RENAME_EXCL または RENAME_SWAP を使用する。
交換で退避した inode は成功時も保持し、old FD writer の後続書込みも消さない。
確認から公開の間の外部書込み、突然の削除/作成、別 directory への置換を異常系で検査し、公開済みなのに確認できない結果は部分成功として保持する。
全 writer を跨ぐ atomic CAS、autosave、session restore、crash recovery、power-loss durability は保証しない。
非 macOS には無条件 overwrite の fallback を設けない。
retained object は明示的な比較・draft 読込が可能だが、自動削除せず利用者による確認を必要とする。

独立レビューで failed Save As の A/B recovery target、disk 読込中の新しい編集、target 採用後の preview dependency capability、pathname 置換後の folder 再選択を指摘され、回帰を追加して修正した。
品質/correctness と採用理由の確認は別 agent が実施した。
実装を見ない体験レビューは未実施で、DOM seam の検査を実 native GUI 受入に転写しない。

以下の検査の最終件数・exit code、差分と raw logs、bundle executable/frontend hash は今回の外部納品 report に保存する。
standalone session/host 回帰、既存全 package の build/test/typecheck、native 保存 race と partial staging-write/permission failure を実行する。
partial staging-write は child process の file-size resource limit による実 write failure であり、full-volume ENOSPC や sync failure の実測とは区別する。
既存キャッシュの pnpm 10.33.2 を専用コピーへ移し、通常の `make setup` と setup-completion check が成功した。
通常の Git-backed build/test/typecheck/lint、fmt/links/docs/scaffold gate が一度成功し、その後の追加修正は版を固定して再検査する。
cycle-status は origin fetch 成功・behind 0 だが、候補に未コミット差分があるため終了 code 1 を返す。
rustfmt は既存 toolchain に存在せず、導入や検査省略で合格扱いにしない。
Mac はロック中で正規 app 操作の取得に失敗したため、現在 bundle の GUI/IME、Find/Replace、Undo/Redo、手動保存、close/dialog と current native corpus は未確認。
起動した試験 process は停止し、解除の迂回・共有設定変更・外部投稿・push・PR・CI rerun は行っていない。
#1258 は wip のままで、#1259 の製品実装を未検証保存基盤の上に積まない。

通常 Quit を固定版 AppKit/Tao delegate で同期取消し、window CloseRequested と Tauri ExitRequested を同じ複数文書確認へ接続した。
遅延・重複・busy 中の Quit は request token と IPC 応答中の claim で抑止し、確認中の文書追加は dispose 前の membership 検査で全件保全する。
親 directory 移動後も native capability の parent inode/leaf binding を保持し、明示的な同一 inode 再 Open で source と same-target recovery を同時に再接続する。
独立レビューの追加 P1/P2 は回帰テストで修正したが、GUI の Cmd-Q・application menu Quit・Dock Quit・window close は別々に実行して確認する必要がある。

保存 metadata は未解決の P2 として残る。
v3 baseline の mode-only 保存は ACL/xattr/ownership を保証せず、保護された文書の保存には使用しない。
独立 SDK レビューと owned fixture により、metadata copy 後に権限を強化されると交換後に古い弱い mode が公開される反例を確認した。
対応する ordinary metadata と保存時の競合保証の範囲は未確定で、全既存 Save 拒否を通常 Save の達成とは扱わない。
read-only file 自体の write denial は writable parent による交換で迂回しないよう、既存 target を truncate せず write-open できることを要求する。
この条件だけで ACL/xattr/metadata race が解決したとは扱わない。

### 失敗時の stage 保全 — cleanup の独立修正

外部 writer が stage の名前を独立ファイルへ差し替え、publication が失敗すると、従来の cleanup がそのファイルを unlink することを native fixture で再現した。
metadata 方針と独立の確定不具合として、失敗時の unpublished stage unlink を撤去した。
作成に成功した temporary leaf は manual inspection に残し、失敗説明にその leaf を示す。
名前の identity を検査してから unlink する方式は使わず、別 writer の entry を削除しない。
不確かな leaf を verified retained snapshot として自動読込みしない。
native regression は独立ファイルと移動先の元/local 内容を保全することを確認し、partial staging-write は実際に five-byte prefix が stage に残ることも確認する。
既存保存方式の mode-only metadata 問題、保存直前競合、power-loss durability をこの修正で解決したとは扱わない。
現在版の full build/test/gates と native suite の結果は専用の納品報告に版とともに保存し、GUI 未確認は維持する。
凍結した v2 source/app とその証拠は変更せず、cleanup 修正後の app は別の識別情報で保存する。

### 独立候補の保存境界と公開後 failure

2026-10-09、v3 baseline 911a2dba を基準に別 branch の候補を準備した。
URL replacement と FD-relative clone/copy を独立比較した。
最終レビューで clone 後の stage 名の再 open が foreign inode へ書く反例を確認し、create_new で取得した stage FD を保持する方式へ変更した。
fcopyfile の metadata copy と fsetattrlist の creation time 復元を保持 FD に限定する。
stat copy の後に内容を書き、mtime は今回の書込みで更新する。
既存 file の metadata は本文 write 前にも照合し、copy 成功後の observed protection 不足で buffer を stage に残すことを避ける。
普通 mode の不足を専用 fixture の fault hook で作り、公開拒否と stage の空内容を Red→Green で確認した。
これは特殊 ACL 等の意味や全時点の競合に対する機密性を保証するものではない。
owner/group、mode、flags、creation time、extended ACL text、xattr の名前と値を観測し、stage と公開結果を照合する。
元から存在する TextEncoding は書く UTF-8 内容に一致する宣言へ更新する。
その他の OS SAVE intent で保持対象外となる属性は、未決の方針を黙って適用せず公開前に拒否する。
未知の内容依存属性、独自 ACL・異なる ownership・inheritance の実機受入は未完了で、全属性保証は宣言しない。
copy または metadata の検証失敗では公開を拒否し、破壊的な fallback を使わない。
同じ stage inode の内容差替えも公開直前の buffer 照合で拒否する。

root/parent の外部移動・削除・入替、target の identity/revision/metadata と stage entry の変更を公開直前に検知した時は拒否する。
過去の parent 移動後の保存成功テストは、今回の明示的な検知時拒否の要件に合わせて変更した。
公開後に変化した対象は rollback や unlink をせず、published receipt と実際の観測状態を返す。
保全した old-FD object は従来どおり残り、close/read/Save As の target ownership を維持する。

host は native reply を受け取れなかった場合も、publication unknown の failure receipt、dirty、buffer、選択 target を保持する。
current が読めなかった場合に以前の snapshot を現在値として表示しない。
実 native の公開後 target directory 化の fault test で、published/unreadable、新内容の公開、旧 retained 内容の実物を検査した。
その JSON receipt を production host の DOM に渡して、保存完了とならないこと、buffer/dirty、回復先、未確認 disk adoption の無効化を検査する。
DOM seam は実 Monaco/native window の GUI 受入ではない。

版、Red/Green、生ログ、独立レビューは独立候補の外部報告に保存する。
v4 の凍結 app と source は変更しておらず、この候補をその app の実測結果へ転写しない。
GUI と rustfmt は未実施のままで、追加 install、画面ロック解除、公開操作はしていない。

## 保存保証の簡素化と編集機能の集約 — 2026-10-10（wip）

利用者は保存前の外部変更検査を保証する方針 C を選び、検査後の競合や旧 FD writer まで追跡する方式を廃止すると判断した。
mode・owner/group・保護 flags・ACL の欠落は拒否し、その他の metadata は OS 標準のコピーに委ねる。
アプリ専用の一時名に対する意図的・継続的な操作は対象外とし、排他的な一時作成と通常の失敗時 cleanup を行う。
この判断は前節の候補に対する現在の変更方針であり、以前の保証範囲や未完了の #1258 全体の受入を満たしたという意味ではない。

現在の Save は選択 directory・期待 revision を確認し、同じ directory に本文を書いて sync した後、もう一度確認してから atomic replace または exclusive create を行う。
検知した外部変更は保存を止め、エラー時も editor buffer を残す。
最終確認後の外部書込みは上書きされ得るし、置換前の inode を開いた writer の後続書込みも回収しない。
正常保存後の旧 inode、旧版の比較・draft 読込 UI、全 xattr と creation time の独自一致検査は削除した。
内容が同じ場合も期待 revision と directory を検査し、変更がなければ置換と一時ファイル作成を省く。

native document registry は単調増加 ID と削除可能な map を使う。
close、重複 Open の再接続、Save As のキャンセル・別タブ使用による拒否、保存先の採用で不要になった参照を解放し、未解決の保存先は保持する。
表示 path が同じでも別の directory capability で選び直したファイルは別タブで開き、旧タブの編集を保持する。
同じ binding での atomic replacement は既存タブへ接続し、dirty buffer と外部変更の比較を維持する。

#1426〜#1431 の保存・座標・正規化表示・整形・選択整形・言語設定は #1431 に集約する。
FM001 による選択整形の拒否を共通の body 境界計算へ移し、standalone 側の全体再解析と2つの整形テストに重複していた host 準備を削除した。
実装前に無変更保存・反復保存・同じ binding の再選択・閉じていない frontmatter の失敗を再現し、修正後のテストで確認した。
最終差分の検査と独立レビューの結果は集約 PR 本文に記録する。
追加監査では、本文 write 前の保護照合を除去する変異と、解放済み native ID を再利用する変異を既存テストが見逃した。
stage の FD を cleanup 後も観測する検査と全退役 ID の検査へ補強し、各変異で該当テストだけが失敗し、復元後に native 28 件が成功することを確認した。
本番 Monaco と DocumentSession を接続した編集→Undo 中の終了確認も追加し、getAlternativeVersionId への変異を検出した。
座標変換の非破壊検査は実際に変換へ渡す入力を比較するよう訂正し、破壊的変換の変異を LF・CRLF の両方で検出した。
Snapshot.binding は同梱 native が必ず返す契約に揃え、欠落時の互換分岐、空の stage hook、正規化テストの独自起動処理と実装差替え用の環境変数を削除した。
ボタン表示の検査は本番 main のクリック・タブ切替検査へ統合し、保存・終了・整形・座標境界の異なるシナリオは維持した。
過去の固定版 native corpus・GUI 判定はこの版へ転写しない。
実 native GUI、IME、Cmd-Q/menu/Dock Quit、Find/Replace、Undo/Redo、複雑な ACL/ownership の実機受入は残り、#1258/#1259 は未完了のままとする。

## #1431 の完遂に向けた追加確認 — 2026-10-10

#1258 は部分対応を最終方針にせず、この PR で文書ライフサイクルの完遂を目指す。
現在の本番 document-tab に Monaco の find contribution を読み込み、Find と Replace を接続した。
実 Monaco の回帰検査は、修正前に Find action 未登録で失敗し、修正後に日本語の検索結果選択・全置換・Undo/Redo・別タブの本文保持で成功した。
独立した体験検査は3一致の順巡回・一周・逆巡回、単発置換と全置換の別々の Undo/Redo、既存コメント切替と別タブ隔離を確認し、そのシナリオを既存の本番 Monaco 検査へ統合した。
この検査は DOM 計測を補った Node/JSDOM 上の本番 entry 操作であり、native GUI のキー・IME・保存受入を認定しない。
追加修正後の全体テストは5,998件成功・1件 skip、全体型検査と debug `.app` の build は成功した。
体験シナリオ統合後の本番 Monaco 検査も13件成功した。
受入候補の executable SHA-256 は `d8531c59661606297c0a6097c10c7f495c0b315fea69c3a154d801ef12b98f40`、build 環境は Apple Silicon / macOS 27.0.1 (26A434)。
この候補は引継ぎ HEAD `f304626f8e8b32daef3ddc36016a2178e96ba7b4` に今回の find contribution 接続を加えてビルドし、文書・テストの統合は同梱ソースを変更しない。

### 現在版の Mac で確認する項目

同じビルドのアプリで操作し、対象版・環境・入力・期待結果・実結果を残す。
以下は検査開始時のチェックリストである。
通常起動の Mac アプリで親が実施した[現在版の操作結果](evidence/2026-10-10-document-lifecycle/native-acceptance.md)は、検索・置換・Undo/Redo、手動保存、新規/Open/folder/recent、タブ隔離とエラー回復、dirty close、window/Cmd-Q/menu 終了取消、複数 dirty タブの途中取消、外部変更・再競合・rename/delete・衝突・保存失敗からの回復を確認した。
通常の mode・同じ owner/group・読取 ACL の保持と、immutable flag による保存拒否も確認した。
IME の composition と Dock Quit は操作基盤の timeout 後に所有者へ引き継ぎ、同じアプリでの変換・確定→保存と、未保存文書の Dock Quit→取消→本文保持について、2026-10-10 に所有者から両方の受入成功を受領した。
同じ binary の追加確認で、80行のコメントを含む文書のタブ往復後の表示範囲も確認した。
再フォーカス時の click の影響を分離していないため、カーソル位置保持の認定には用いない。
容量不足、複雑な ACL/ownership 等の未実測は同記録で分ける。
親の通常アプリ操作、所有者の受入、変更のない native 保存検査と現行 host 検査を7条件へ対応付け、独立レビューでも追加必須の欠落がないことを確認し、採用済み保存前検査の境界で #1258 を完了と判定した。
未実測の全組合せを成功とせず、署名配布・最低 OS 保証は後続工程で扱う。

- ファイルとフォルダを開く、新規作成、Save/Save As、取消、最近の対象の再アクセス、同じ文書の再 Open。
- 2つのタブを往復して本文・表示位置・図の隔離を確認し、構文エラーから復帰する。
- 日本語 IME の変換確定、Find の次結果、単発置換・全置換、Undo/Redo、手動保存後のディスク本文を確認する。
- 時間経過・タブ切替・フォーカス移動で未保存の本文がディスクへ書かれないことを確認する。
- dirty タブの Save/Discard/Cancel、複数タブの途中取消、ウィンドウ close・Cmd-Q・メニュー Quit・Dock Quit を確認する。
- clean 文書の外部変更を再読込し、dirty 文書ではローカル本文と外部版を比較・選択できることを確認する。
- 外部削除・名前変更、Save As 先衝突、権限拒否等の保存失敗・再競合で、buffer と保存先を失わず回復できることを確認する。
- 保存先の mode・owner/group・保護 flags・ACL を保持するか、保持できない場合は保存を拒否して buffer を残すことを確認する。

セッション復元・未保存内容の退避・クラッシュ復旧は今回追加しない。
保存最終検査後の race と旧 FD writer は、既に採用した保存前検査の保証範囲に従う。

### #1283 の既存証拠と座標修正

[累積受入表](evidence/2026-10-07-linux-appimage/remaining-checks/cumulative-matrix.csv)の #1283 / VS Code は全20条件成功である。
対象は固定 source `8261f877d5cae8aa653a5310edfbd9e387acb116` の Linux VS Code であり、Mac のショートカットや standalone の巡回 UI の証拠ではない。
定義・本文の全出現、途中からの巡回、quoted key・同名 field・alias・編集後増減、chord/context menu、直接定義移動、組込定義・Peek・multiCursorModifier の対照を含む。
この固定版から引継ぎ HEAD `f304626f8e8b32daef3ddc36016a2178e96ba7b4` まで、VS Code の巡回 host、command/context menu/keybinding の契約は不変である。
依存する analyzeSnapshot は本文 range を full-source UTF-16 座標へ正規化するよう変更され、現行 host の回帰検査は LF/CRLF・frontmatter 有無・先行する補助平面文字と完全な選択 token を確認する。
旧版の実 UI 判定と現在版の共有計算・host 回帰検査を併用し、現在版の native UI で20条件を再実測したとは扱わない。

## #483・#1282 の個別完了 — 2026-10-11

所有者が既存要件による両 issue の完了と、V001 の事前防止を別 issue に分ける判断を承認した。
#483 は固定 source `8261f877d5cae8aa653a5310edfbd9e387acb116` の native / VS Code 各30条件で、input/feedback/output × 既存/新規 target、単一 Undo/Redo、再描画、既存 double click・pan を確認している。
現在の共有候補 UI・connector 計算・適用契約は固定版から不変で、変更された source 座標 adapter は現行回帰検査で照合した。
O-001 の別 producer への output 追加による V001 と Undo/Redo の観測はそのまま保持する。
V001 を増やす接続を理由付きで事前拒否する新しい編集契約は、後続 issue [#1432](https://github.com/takasek/pfdsl/issues/1432) の対象であり、今回実装・検証済みとはしない。

#1282 は固定版の native 9 / VS Code 9 / CLI 23 条件、追加初期 field と安全拒否、help・例を個別に照合した。
独立 reviewer は原 ZIP の操作・source/hash と現行コードを照合し、core・CLI・共有 preview-edit・VS Code 適用経路、standalone の定義作成 executeEdits・Undo・選択部分が固定版から不変であることを確認した。
現行 `edit-navigation-contract.test.ts` の LF/CRLF・日本語引用 ID・作成後位置解決を含む回帰と、既存全体検査5,998成功・1 skip、型検査成功を再利用し、新しい GUI 追試や全テスト再実行とはしない。
F-001 のコメント位置の厳格保持3セルは旧失敗履歴として残すが、ADR-0034 と既存 core テストが許容する CST 再整形であり、内容欠落とは扱わない。
別 Inspector binary の実 Monaco model の前/後/Undo/Redo は21/24/21/24 CRLF、lone LF 0、前=Undo・後=Redoで、生 JSON の hash を独立に再計算した。
同じ製品 source/frontend の model 証拠であり、元 binary の保存 bytes・painting・通常版と別 binary の一般的同等性を認定しない。
これらは定義作成と Undo の完了条件を満たす証拠として利用でき、保存・cue・reduced motion 等の別 issue の未確認を完了へ転写しない。

`preview_connector` と `node_definition_creation` を done とし、#1431 に Closes #483 / Closes #1282 を設定する。
既存 matrix と過去時点の未完了記録は書き換えず、この追記を現在の個別判断とする。
#1259 は部分対応、#1260・#1261 と束のほかの成果物は今回完了としない。

## 終了直前の外部削除・移動の保護 — 2026-10-11

#1431 のレビューで、最後の定期 poll の後に保存済みファイルが削除・移動され、直後に clean タブを閉じると、新しい disk 確認なしに最後の本文を破棄できる経路を確認した。
終了前に先行 poll を待ち、その後新たな `inspect_document` を開始して完了を待つよう host の `prepareClose` を修正した。
missing と読取失敗は既存の uncertain / dirty 判定に接続し、Save / Discard / Cancel で本文の扱いを確認する。
確認完了後の外部操作を完全に防止する保証は追加しない。

本番 main bundle と native / DocumentTab seam による回帰は、削除後の tab close、移動後の native quit、読取失敗、先行 poll と終了時の新しい read を別々に遅延させた完了待ちを確認した。
修正前は終了時の inspect 欠落で失敗し、修正後は関連40件成功。全体検査5,998成功・1 skip、型検査成功も確認した。
独立 reviewer は終了 transaction と native inspect の契約を照合し、修正を妨げる指摘なし。
新しい実 GUI 受入ではない。Mac アプリの再ビルド要求は、cwd が main と扱われ explicit worktree の所有を証明できないとして保護 hook に拒否され、規定 wrapper に native build の入口がないため停止した。
以前の Mac binary と実機受入を、この frontend 修正後の新しい executable の成功へ転写しない。

同日の再調査で、既存 wrapper の `node-script` が target・branch を検証した後に通常スクリプトを実行する正規入口と確認した。
ignored 領域の検証用 helper から公式 Tauri debug build を実行し、既存 Cargo の PATH を明示して source `72bcd20a8d66b480606e6e24ab85f3eb3b7341e6` の arm64 app をビルドした。
元 executable の SHA-256 は `b039854001f94f18de13411df10c77be8642408f511d9285a690dd1e00331075`。
所有者へ渡すコピーにはローカル ad-hoc 署名を付け、`codesign --verify --deep --strict` 成功後の executable SHA-256 は `97d1fb616a3211ca0efdc27df238bf80ffe2a8ade62513426c7bedda3f4265b5`。
保護 hook・trusted root・wrapper の変更は行わず、正式署名・公証や実 GUI 成功を認定しない。
実機確認は所有者が担当すると表明し、修正版 app と削除・移動用の使い捨てファイルを用意した。

### 所有者による修正版の実機受入

2026-10-11、所有者から「どちらも確認が出て、タブと本文が残った」と報告を受領した。
上記 source・署名後 executable のアプリで、削除後の tab close と移動後の app quit の2条件を実施し、確認表示と Cancel 後のタブ・本文保持を成功と判定した。
これにより前節で実機未確認とした2条件は受入済みとなる。親の Computer Use 追試や全 native corpus の再実行とは区別する。
読取失敗と先行 poll / fresh read の遅延は自動検査の証拠を維持し、実機で追加実測した結果へは広げない。

### 複数タブ終了とハードリンクの追加レビュー対応

2026-10-11、後続タブの保存・破棄確認中に先行ファイルが削除・移動・読取不能になる条件を追加した。
修正前は先行タブを再検査せず閉じる6条件が失敗し、修正後は全タブの最後のディスク検査と版照合で終了を中止し、本文を保持する。
ディスク状態が変わった場合は全タブを保持して終了を中止し、利用者が改めて終了操作を行う。
恒常的な読取失敗は同じ状態の再観測として扱い、明示した破棄を許容する。読取可否の遷移は確認を無効にする。
同じ inode の別名を開いた際に通常保存先を変えない条件も修正前に失敗した。
同時に存在するハードリンクは別タブとして扱い、元の native binding の新規検査でファイルの消失を確認した場合に限り inode による移動回復を許可する。
本番 main.ts を束ねたホスト検査では、別名の2タブ保持・元の保存先 ID と、後続の確認中に先行ファイルが消えた Quit の拒否・両本文保持を確認する。
native IPC と DocumentTab をテスト用境界に置き換えた自動検査であり、前節の所有者による単一タブの実機受入を、これらの追加条件へ広げない。
