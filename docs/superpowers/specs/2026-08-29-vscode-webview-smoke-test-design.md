# VS Code webview smoke test design

## Goal

`packages/vscode-extension` の preview を実際の VS Code/Electron 上で開き、unit test が届かない webview の script 読み込み、実 DOM geometry、pointer interaction、extension host との message 経路を機械検証する。
対象は #589 と #611 で手動確認した主要経路であり、ピクセル完全一致、OS native UI、IME、Marketplace 公開物の検証は含めない。

## Observed feasibility

使い捨てスパイクでは VS Code 1.132.1 を `--remote-debugging-port` 付きで起動し、Playwright 1.55.0 の CDP 接続から workbench page と `vscode-webview` frame を取得できた。
`pfdsl.preview` の発火後、実 DOM の `#root`、6個の `g.node`、2個の SVG、先頭 node の `data-node-id="design"` を観測した。
したがって Playwright-CDP で階層2の検査面へ到達でき、ExTester を追加しても到達範囲は広がらない。

## Architecture

`@vscode/test-electron` はテスト対象の VS Code binary を固定して取得し、専用 user-data directory、専用 extensions directory、対象 `.pfdsl`、extension development path、remote debugging port を指定して起動する。
`playwright-core` は同じ VS Code の CDP endpoint に接続し、workbench から preview action を発火し、実内容を持つ `vscode-webview` frame を特定して検証する。
テストは一時 profile で初回起動 overlay と不要な通知を抑止し、product code へテスト専用 command や `postMessage` variant を追加しない。
プローブで成功した editor title action の発火を既定経路とし、Command Palette の表示文字列や VS Code 内部 command registry には依存しない。

## Smoke scenarios

最初のシナリオは `docs/samples/01-simple-chain.pfdsl` を開き、PFDSL preview action を実行し、webview frame、`#root`、SVG、期待する node 群、minimap が描画されることを確認する。
zoom シナリオは node 上へ pointer を置いて wheel event を送り、pointer 下の diagram 座標が許容誤差内で不変であり、transform scale が変化することを確認する。
pan シナリオは diagram を drag して transform translation が変化することと、webview 外で button release 後の mousemove が translation を変えないことを確認する。
minimap シナリオは viewport 枠の位置と大きさが diagram transform と container geometry から導かれる期待値に一致し、minimap の click と drag が viewport を移動することを確認する。
navigation シナリオは node を double-click し、webview の `nodeClick` message を経て editor selection が対象 node 定義へ移ることを確認する。

## Stability boundaries

selector は VS Code workbench の内部 class 名を避け、拡張自身が提供する action label、webview URL、`#root`、SVGの意味的属性を使う。
各操作は固定 sleep でなく、frame 出現、DOM 条件、transform 変化、editor state の条件を待つ。
起動ごとに一意な user-data directory と debugging port を使い、終了時に VS Code process を確実に停止する。
テスト失敗時は VS Code version、extension host log、取得した frame URL、対象 DOM の診断情報を残す。
GPU、font、device scale に依存する screenshot golden は初期範囲へ入れない。

## CI integration

Linux CI では xvfb 上で smoke test を実行し、VS Code binary は `@vscode/test-electron` が管理する。
Playwright browser binary は使わないため `playwright-core` だけを導入し、VS Code内蔵 Chromiumへ CDP 接続する。
通常の拡張 test とは分けた package script を用意し、拡張 build 後に単独実行できるようにする。
初期導入では pull request CI に組み込み、実測で定常的な flaky failure が発生する場合は原因を解消するまで required gate へ昇格しない。

## Acceptance criteria

- 新規 worktree で所定の setup と build 後、1コマンドで smoke test を実行できる。
- preview が実 VS Code webview で描画され、白紙、script load failure、frame到達不能を検出できる。
- zoom、pan、outside release、minimap、node double-click の各経路を実 DOM event で検査する。
- product code にテスト専用 API、message variant、条件分岐を追加しない。
- unit test、typecheck、extension build、smoke test、リポジトリ終端ゲートが通る。

## Rejected alternatives

`@vscode/test-electron` と webview 自己申告だけを使う案は、実 pointer event と隔離 frame の境界を検査できず、product code にテスト専用 protocol を追加するため採用しない。
ExTester は Playwright-CDP が同じ frame へ到達済みであり、Selenium依存に見合う追加の検査面を持たないため採用しない。
jsdom へ `webview.ts` を読み込む案は VS Code の webview URI、隔離 frame、実 layout、workbench から届く入力 event を再現できず、本 issue が対象とする境界を検査しないため採用しない。
