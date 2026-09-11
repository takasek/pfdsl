# 描画・エディタ境界の設計監査

> アーカイブ注記（2026-09-10）: この文書は固定コミット `827bcb1cb96238f918dad84dc6453176f131e029` を対象にした当時の監査記録であり、現行の不具合一覧や実装計画ではない。
> 最新の対応状況と残件は [#1055](https://github.com/takasek/pfdsl/issues/1055)、CLI 0.0.26 の公開完了記録は [#1138](https://github.com/takasek/pfdsl/issues/1138) を参照する。
> 観測・評価・提案は当時の内容を保持し、個人環境を含むパス表記は公開用の例示パスへ置換した。
> Markdown リンクは、このアーカイブ内の相対参照または監査対象コミットへの固定参照へ置き換えた。

対象コミットは `827bcb1cb96238f918dad84dc6453176f131e029`、対象 checkout は `/path/to/pfdsl`、監査日は 2026-09-08。
実装・仕様・テスト・呼出し配線を一次資料として調べ、issue・PR は参照していない。
製品コードの変更・commit・push・公開操作は行っていない。

確認済みの所見は R1〜R3 の3件で、いずれも P2 とする。
誤表示・誤参照は実証できたが、これらが必須の受入ゲートとして誤った変更を自動受理する経路は確認していないため、設計上の重要性をそのまま P1 の緊急度へ置き換えていない。
実 VS Code の起動検証は行っておらず、描画・リンク・コマンドの実モジュールを使う限定 harness、checkout-local dist の直接呼出し、実 CLI 子プロセスによる検証である。

## 証拠と再実行

- [results.json](evidence/render-editor/results.json) は、統括担当が再現を実行した実測値である。
- [reproduce.mjs.txt](evidence/render-editor/reproduce.mjs.txt) は、実ソースを esbuild の `write: false` でメモリ上に変換し、VS Code API を mock、webview の DOM を jsdom、WASM 初期化を制御可能な Promise に置き換える。
- [before.pfdsl](evidence/render-editor/before.pfdsl.txt) は metadata 差分の比較元である。
- [cli-boundary-results.json](evidence/core-cli/cli-boundary-results.json) の `diff` は、統括担当が追加した実 CLI 境界の検証結果である。

スクリプト冒頭の `repo` と `out` は実行時の絶対パスを記録している。
別環境で再実行する場合は、同じコミットを build した checkout と、書込みを許可された実験用ディレクトリに変更する。
現在のスクリプトは確認した不正挙動を assertion にしており、終了成功は修正済みを意味しない。
修正の回帰テストに転用するときは、以下の「維持する保証」を正しい期待値にする必要がある。

## R1 — P2: 差分の意味を表示経路間で保持できず、変更を「差分なし」と表示する

### 根本原因と保証

core が返す `DiffReport` はノード・辺・feedback と metadata の差分を表すが、表示側が必要な入力や差分なし判定を独自に省略している。
「同じ2文書に対し、表現形式だけを変えても差分の有無は変わらない」という保証が破られる。
一つの所見にまとめる理由はこの共通する保証であり、下記 A/B は独立した実装箇所・修正として扱う。

### A. 辺だけの変更を DOT/SVG が消す

実経路は [CLI index.ts:2626](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/cli/src/index.ts#L2626) の `diff --format dot|svg` から [preview-engine index.ts:44](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/preview-engine/src/index.ts#L44) の `renderDiff` を経て、[graphviz-exporter index.ts:253](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/graphviz-exporter/src/index.ts#L253) の空判定へ至る。
同 exporter は [index.ts:213](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/graphviz-exporter/src/index.ts#L213) で辺差分の端点を集め、[index.ts:228](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/graphviz-exporter/src/index.ts#L228) で変更された辺を選別するが、空判定はノード追加・削除・変更の3集合しか見ない。
一方、[CLI index.ts:2635](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/cli/src/index.ts#L2635) の text/JSON 経路は report の全項目を使用する。

最小反例は次の2文書である。

```pfdsl
# A
a >> p -> x
b >> q -> y
```

```pfdsl
# B
a >> p -> y
b >> q -> x
```

実測では両文書の diagnostics は `[]`、ノード追加・削除・変更は全て `[]`、追加辺は `["p -> y", "q -> x"]`、削除辺は `["p -> x", "q -> y"]` だった。
ところが `exportDiffDot` の出力は `_nodiff` ノードと `No structural or metadata changes` のみだった。
追加の実 CLI 検証でも、text diff は `+ edge p -> y`、`+ edge q -> x`、`- edge p -> x`、`- edge q -> y` の4行、DOT diff は同じ `_nodiff` 表示となり、両プロセスの終了コードは0、stderr は空だった。
成果物の生産者が入れ替わる有効なグラフ変更を隠すため、単なる描画装飾の差ではない。
成立条件はノード集合・種類・比較対象 metadata を保ったまま辺を変更することであり、同じ空判定は feedback だけの変更にも適用されるが、今回の実行反例は primary edge の入替えである。

反証として、同一入力で差分なしになること自体は正しく、新ノード追加や metadata 変更には別の非空集合があるため、この早期 return に入らない。
既存 [index.test.ts:1070](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/graphviz-exporter/src/index.test.ts#L1070) はノード追加・削除・status 変更・同一入力を検査するが、[index.test.ts:1107](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/graphviz-exporter/src/index.test.ts#L1107) の辺追加例でも新ノードを同時に追加している。
これらはソースで確認した対照条件であり、今回の standalone 実験で全てを再実行したという意味ではない。

最小改善は `DiffReport` の全7項目を対象とする空判定を使うことである。
共通の `isEmptyDiff(report)` を設けるなら、他の表示経路も同じ意味を利用できる。
維持する保証は、同一入力の差分なし、ノード・metadata・primary edge・feedback 各単独変更の検出、変更端点だけを文脈として表示する既存の簡潔な差分図である。

### B. VS Code の Diff コマンドが metadata 比較の入力を落とす

実経路は [extension.ts:22](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/extension.ts#L22) の登録から、[diff.ts:88](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/diff.ts#L88) の現在文書解析、同ファイル90行の `diffGraphs(otherResult.graph, currentGraph)` を経て `postDiff` へ至る。
[core diff.ts:75](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/diff.ts#L75) の metadata 比較は両 frontmatter が渡された場合にだけ実行されるため、この呼出しでは常に無効になる。
表示側 [diff-panel.ts:27](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/diff-panel.ts#L27) は CLI の差分表示との一致を意図し、38行で `changedNodes` を表示する実装を持つ。
したがって表示機能が存在しないのではなく、その上流で情報を落としている。

実験では同じ `a >> build -> b` に対し `artifact.a.label` を `Before` から `After` へ変更した。
実際の登録済み `pfdsl.diff` コマンドから得た report は全項目が `[]`、両 frontmatter を渡した core の対照結果は `changedNodes: ["a"]` だった。
同じ解析結果に対する入力差であり、core の metadata 比較自体が機能しないという疑いは反証できた。
status など他の metadata にも同じ呼出し条件が適用されるが、今回の実測入力は label 変更である。

最小改善は比較元と現在文書の解析結果を保持し、graph と frontmatter を一緒に渡すことである。
維持する保証はノード種類・辺・feedback の既存差分に加え、metadata のみの変更でも CLI と同じ差分が得られることである。
core の公開 API 全体を改変する必要はなく、A の空判定修正とは別に検証する。

### 実証の限界

A は build 済み core/exporter の直接実行と、実 CLI の text/DOT 子プロセス実行で、表示形式によって差分の有無が変わることを確認した。
SVG への伝播は `renderDiff` の実配線から確認しており、実 Graphviz を使って当該 SVG を生成した検証ではない。
B は実 `diff.ts` と core を実行し、file picker・VS Code command API を mock に置き換えたもので、実 UI 上の操作は未確認である。

## R2 — P2: リンク対象を複数箇所で再解釈し、同じ文書から異なる参照先を作る

### 仕様と実経路

[spec.md:117](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/docs/spec/spec.md#L117) は、`basePath` を location/command に適用し、subflow/extends には適用しないと規定する。
[spec.md:1067](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/docs/spec/spec.md#L1067) は、location の各要素について `://` を含む場合を URL と分類する。
ソース中のリンクは [document-link.ts:56](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/document-link.ts#L56) から [document-link-logic.ts:83](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/document-link-logic.ts#L83) を呼ぶ。
プレビュー中の subflow は [webview.ts:305](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/webview.ts#L305) の Cmd/Ctrl+Click から `openFile` メッセージを送り、[preview.ts:287](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/preview.ts#L287) でパスを解決する。

### 反例と実測

`/repo/.pfdsl/root.pfdsl` に `basePath: ../` と `process.build.subflow: child.pfdsl`、本文 `a >> build -> b` を置くと、解析 diagnostics は `[]` だった。
ソースリンクの実測値は `file:///repo/.pfdsl/child.pfdsl`、プレビュー command 経路の実測値は `/repo/child.pfdsl` だった。
[document-link-logic.ts:37](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/document-link-logic.ts#L37) は subflow に basePath を適用しないが、[preview.ts:289](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/preview.ts#L289) は適用している。
同名の別ファイルがあれば誤った子フローを開き、存在しなければオープンに失敗する。

同じ再解釈の問題がソースリンクの YAML 処理にもある。
`loadFrontmatter` を呼んでいるにもかかわらず、値の取り出しは [document-link-logic.ts:15](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/document-link-logic.ts#L15) の正規表現と、[document-link-logic.ts:58](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/document-link-logic.ts#L58) の comma 分割で行う。
同じ `/repo/.pfdsl/root.pfdsl` を基準にした実測値は次のとおりである。

| location の表記 | core が解釈した値 | ソースリンクが作った対象 |
| --- | --- | --- |
| `["docs/a.md", "docs/b.md"]` | `['docs/a.md', 'docs/b.md']` | `file:///repo/.pfdsl/"docs/a.md"` と `file:///repo/.pfdsl/"docs/b.md"` |
| `["docs/a,b.md"]` | `['docs/a,b.md']` | `file:///repo/.pfdsl/"docs/a` と `file:///repo/.pfdsl/b.md"` |
| `docs/a.md # explanation` | `'docs/a.md'` | `file:///repo/.pfdsl/docs/a.md # explanation` |
| `ssh://host/path` | `'ssh://host/path'` | `file:///repo/.pfdsl/ssh:/host/path` |
| `"docs/a.md"` | `'docs/a.md'` | `file:///repo/.pfdsl/docs/a.md` |

最後の quoted scalar は正しく処理される実行済みの対照例である。
quoted flow array の quote 残留・comma の誤分割・inline comment の混入は、YAML の値を source text から別文法で再構築することが原因である。
SSH URL の例は [document-link-logic.ts:23](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/document-link-logic.ts#L23) が HTTP(S) だけを URL とみなす独自条件による。
外部 handler が SSH URL を実際に開けるかは別問題であり、ここで実証したのは URL がローカルファイルパスへ変質することまでである。

### 最小改善と維持する保証

リンク抽出には既存 YAML CST の decoded scalar と source range を使い、参照解決には location/subflow の区別を明示した共通処理を使う。
ホスト側には URI 作成と、ユーザー操作に応じて開く責務を残す。
全 UI 機能を一つのモジュールへ集約する必要はない。
維持する保証は、location の basePath、subflow の文書相対、scalar/array の等価性、引用符・comma・comment を含む YAML の意味、文書リンクの正しい選択範囲、既存のディレクトリ選択と URL オープンである。

basePath なしの subflow と HTTP(S) は現コードでも同じ失敗条件に入らないことをソースで確認した。
全リンクが壊れる指摘ではなく、正しく処理される経路を対照にできる仕様分岐の不一致である。
再現は実 link extractor と登録済み preview command を利用した host mock であり、実ファイルへのアクセスや VS Code 実機のクリックは行っていない。

## R3 — P2: プレビュー結果に失効条件がなく、現在のエラーを古い描画で上書きする

### 保証と実経路

[preview-logic.ts:105](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/preview-logic.ts#L105) の説明は、error のある文書はまだ有効なグラフを表しておらず、部分グラフを正しい図として表示しない目的を明示する。
[preview.ts:370](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/preview.ts#L370) は文書変更ごとに更新し、[preview.ts:205](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/preview.ts#L205) の `sendUpdate` が現在文書の render または error を送る。
しかし [messages.ts:10](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/messages.ts#L10) のプロトコルに文書 version や render 世代はない。
[webview.ts:355](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/webview.ts#L355) は error を即時表示する一方、先行 render は [webview.ts:384](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/webview.ts#L384) の WASM 初期化待ちから復帰した後に、388行で SVG を無条件に適用する。

### 再現と実測

1. 初期化未完了の Graphviz に対して、有効だった旧文書の render を送る。
2. Graphviz.load の Promise を保留したまま、現文書が無効になったことを示す error を送る。
3. error が表示された後で Promise を解決する。

実 `webview.ts` を jsdom 内で動かしたところ、手順2の直後は `<div class="err">CURRENT SOURCE IS INVALID</div>` だった。
手順3の後は `<svg><g class="node" data-node-id="old_node"></g></svg>` となり、現在の error が消えた。
初期化待ちだけを制御した同一実行内で「error が先に正しく表示される」ことも確認しているため、error 表示自体が未実装という説明は反証できる。

成立条件は、旧文書の描画が WASM 初期化を待つ間に、後続の error 更新が届くことである。
ロード済みの Graphviz に対する同期的な `g.dot()` が常に任意順へ逆転すると主張していない。
影響は、ソースの現在状態が無効でも古いグラフが最新に見えることであり、ファイル内容の破壊ではない。

### 最小改善と維持する保証

render/error ごとに世代を進め、await 後の成功と失敗の双方で、その処理が最新版かを確認する。
DOT と descriptions/locations/subflows も同じ snapshot として適用し、古い図に新しい参照情報を組み合わせないようにする。
URI/version をメッセージに載せる設計も可能だが、この反例だけを塞ぐ最小条件は、error を含む全更新が旧 render を失効させることである。
維持する保証は最終更新優先、error 後に古い図を復活させないこと、同一 snapshot の図と参照情報、既存の pan/zoom/selection 操作である。
WASM 自体のキャンセル機構や全件再解析は要求しない。

実証は実 message handler と DOM に対する限定 harness で、Graphviz.load と dot 出力だけを mock にしている。
実 VS Code 上の操作再現、初期化所要時間、発生頻度は未確認である。

## 横断要因: host の「配線だけ」という分類に意味の判断と状態管理が残る

[vitest.config.ts:14](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/vitest.config.ts#L14) は、判断・算術を logic モジュールへ抽出し、host に残るものを API 呼出しと配線のみと説明する。
しかし R1 の比較入力選択、R2 の basePath 適用、R3 の更新失効は host 側に残り、[vitest.config.ts:37](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/vitest.config.ts#L37) 以降で `diff.ts`・`preview.ts`・`webview.ts` が coverage から除外されている。
型を共有するだけでは、必要な値を渡したか、返った結果が現在も有効かを検査できない。

既存 smoke が無効という意味ではない。
[smoke/run.mjs:572](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/smoke/run.mjs#L572) は zoom の cursor anchor、pan、minimap を実状態の変化で確認し、[smoke/run.mjs:686](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/smoke/run.mjs#L686) は node からソース位置への遷移を検査する。
ただし fixture は [smoke/run.mjs:749](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/smoke/run.mjs#L749) の simple chain であり、今回の差分入力・YAML 表記・basePath・cold render 中の編集を扱っていない。

改善は coverage 閾値の引上げや毎回の全 UI 起動ではなく、登録済み command と message handler を通す少数の境界テストである。
R1〜R3 の成立条件を直接反転させる対照テストを追加し、既存 arithmetic test と実機 smoke の保証を残す。
この点は上記欠陥を見逃す横断要因であり、除外ファイルがある事実だけで独立した欠陥件数を増やさない。

## 確認範囲・反証・未確認

| 領域 | 一次資料で確認した範囲 | 残る確認 |
| --- | --- | --- |
| graphviz-exporter | [index.ts:1](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/graphviz-exporter/src/index.ts#L1) の通常/差分 DOT、[node-attrs.ts:1](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/graphviz-exporter/src/node-attrs.ts#L1) の属性・quote・style・URL、対応 unit test | 実 binary 出力、非信頼 SVG の攻撃成立性、全入力の描画性 |
| preview-engine | [index.ts:22](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/preview-engine/src/index.ts#L22) の初期化共有と render/renderDiff 配線 | 初期化失敗後の復旧、実 WASM の性能・資源上限 |
| metadata-exporter | [index.ts:24](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/metadata-exporter/src/index.ts#L24) の固定列抽出・group 除外・TSV escape、対応 test | 下流の spreadsheet application 固有挙動 |
| VS Code | [extension.ts:17](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/extension.ts#L17) の登録配線、解析 cache、diagnostics、preview/webview、diff、export、document link、補助編集入口 | 実 VS Code、remote/virtual workspace、OS 固有パス、全編集機能の状態遷移 |
| tests | exporter/preview/metadata/extension の unit test、coverage 除外、smoke の fixture と状態検査 | 実機 smoke の今回の再実行、全 mutation の検出率 |

metadata-exporter の固定列は [index.ts:4](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/metadata-exporter/src/index.ts#L4) の公開 record 型と一致しており、任意 metadata を含まないことだけを欠陥としない。
Node の preview-engine と browser の webview が別に Graphviz を初期化する構成も、実行環境が異なるため、それ自体を不適切な重複とは判断していない。
escaping・[preview-logic.ts:62](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/preview-logic.ts#L62) 以降の HTML/CSP・[svg-anchors.ts:10](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/svg-anchors.ts#L10) の anchor 除去は確認したが、セキュリティ全体の安全性を証明したものではない。
[graphviz-exporter index.ts:347](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/graphviz-exporter/src/index.ts#L347) の Puppeteer 実行と [export.ts:1](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/export.ts#L1) の部分失敗処理はソースを確認した段階で、実 OS での復旧・sandbox・書込み途中失敗は未実証である。

今回の限定再現では R1 の2症状、R2 の subflow と location の各反例、R3 の cold-render がすべて成立し、quoted scalar と metadata を渡した core 呼出しを実行済み対照にできた。
通常 suite の集計・build・typecheck の結果は統括レポートに記録される実行結果を参照する。
本分冊は全件の完全性を主張せず、再現した保証違反と、静的に追跡した成立条件を区別している。
