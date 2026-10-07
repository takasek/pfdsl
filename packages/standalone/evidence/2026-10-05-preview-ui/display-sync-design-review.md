# 表示同期の独立設計レビュー

対象は `/private/tmp/pfdsl-display-sync-design-base-01a10a12` の選択4ファイルと installed Monaco 0.57.0 の公開 API・関連一次 source に限定した。
[baseline.json](display-sync-design-baseline.json) が宣言する起点は `origin/main`、基準 commit は `d1fd7d875e19c665086d6e99508fb2694ce1eac3`。
製品の変更後 source、最終 diff、親の採用案は読んでいない。
review 開始後の agent inventory が既存 native reviewer の status 要約を自動表示したが、今回の推論と根拠には使っていない。

## 証拠の境界

以下は source を読んだ静的推論であり、native app の再現・実測・build・test は行っていない。
「source 貼替え後に AX／主図だけ更新」「Cmd+Up 後に logical cursor と可視 viewport が食い違う」は依頼で与えられた観測要件として扱い、独立に再現したとは主張しない。
実行したのは指定 source の読取・検索と、この報告ファイルの保存だけである。

## 原因候補を支える一次 source

表示は二つの経路を持つ。
共有 preview の [preview.ts:386](https://github.com/takasek/pfdsl/blob/d1fd7d875e19c665086d6e99508fb2694ce1eac3/packages/editor/src/preview.ts#L386) は新 SVG を即座に `inner.innerHTML` へ入れる一方、[preview.ts:405](https://github.com/takasek/pfdsl/blob/d1fd7d875e19c665086d6e99508fb2694ce1eac3/packages/editor/src/preview.ts#L405) の center／focus／`refreshMinimap()` は animation frame 内でしか実行しない。
minimap の clone 差替え自体は [preview.ts:181](https://github.com/takasek/pfdsl/blob/d1fd7d875e19c665086d6e99508fb2694ce1eac3/packages/editor/src/preview.ts#L181) にある。
frame が届かなければ新しい主図と古い minimap が並ぶ入力を静的に構成できる。
基準の [document-tab.ts:49](https://github.com/takasek/pfdsl/blob/d1fd7d875e19c665086d6e99508fb2694ce1eac3/packages/standalone/src/document-tab.ts#L49) は Monaco の minimap を無効化しているため、この選択 source にある minimap は preview のものと区別する。

Monaco は view event を受けると [view.js:343](<checkout>/node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor/browser/view.js:343) で通常の描画を予約し、[view.js:683](<checkout>/node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor/browser/view.js:683) の coordinator は animation frame に依存する。
これに対して公開 [editor.api.d.ts:6426](<checkout>/node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor/editor.api.d.ts:6426) は `render(forceRedraw?)` を「今」描画する API とし、`renderAsync` を次の animation frame の API として分けている。
実装は [codeEditorWidget.js:1249](<checkout>/node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor/browser/widget/codeEditor/codeEditorWidget.js:1249) から `view.render(true, forceRedraw)` を呼び、[view.js:565](<checkout>/node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor/browser/view.js:565) が必要なら各 view part を dirty にして同期描画する。
同期経路の [view.js:436](<checkout>/node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor/browser/view.js:436) は text、view parts の prepare、render を直接実行する。
logical model／selection が既に更新済みでも通常描画の予約だけが進まないという原因候補は、観測要件とこの構造に整合する。
ただし source だけでは WebKit／compositor の故障箇所を断定できない。

基準 [document-tab.ts:113](https://github.com/takasek/pfdsl/blob/d1fd7d875e19c665086d6e99508fb2694ce1eac3/packages/standalone/src/document-tab.ts#L113) の content handler は解析・主図 refresh を依頼し、[document-tab.ts:117](https://github.com/takasek/pfdsl/blob/d1fd7d875e19c665086d6e99508fb2694ce1eac3/packages/standalone/src/document-tab.ts#L117) の cursor handler は preview focus を変えるが、どちらも明示的な Monaco 描画を要求しない。
[document-tab.ts:130](https://github.com/takasek/pfdsl/blob/d1fd7d875e19c665086d6e99508fb2694ce1eac3/packages/standalone/src/document-tab.ts#L130) の activation は `layout()` と解析 refresh のみである。

## 小さい修正案

Monaco の文書内容・selection・cursor・scroll・layout の公開イベントから、同じ editor インスタンスに対する `editor.render(true)` を要求する。
内容変更には source 貼替えだけでなく Undo／Redo が含まれるため、paste 専用の handler にしない。
初期 mount と visible tab の `activate()` の `layout()` 後にも同じ要求を入れる。
selection には [editor.api.d.ts:6048](<checkout>/node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor/editor.api.d.ts:6048)、scroll／layout には [editor.api.d.ts:6150](<checkout>/node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor/editor.api.d.ts:6150) の公開イベントを使う。

各 event listener 内で即座に何度も再描画するより、現在の command／event batch が終わった直後の microtask 一回へまとめる案を選ぶ。
requestAnimationFrame を使わず、cursor 移動後に同じ command が行う reveal／scroll 更新もその後で描画対象に含める。
内部の view event を先に配送してから public event を出す境界は [viewModelEventDispatcher.js:71](<checkout>/node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor/common/viewModelEventDispatcher.js:71) にある。
ただし [view.js:497](<checkout>/node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor/browser/view.js:497) が明記するように rendering 自体から scroll event が出ることがあるため、queued／rendering／disposed の少数の guard は必要になる。
render 中に発火した scroll event から無制限に次の render を予約しない。
同じ render の中で text 更新後に view parts を取り直して描画する既存経路を利用する。

hidden または detached editor は無理に focus・reveal・view state reset せず、visible activation で未反映の状態を flush する。
Monaco 自体も [view.js:469](<checkout>/node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor/browser/view.js:469) で detached DOM の描画を打ち切る。
host の可視寸法確認を加えるなら、寸法ゼロの間は繰返し scheduling せず、activation の要求で再試行する。
listener を所有 editor とともに dispose し、予約済み microtask は disposed guard で無効化する。
[codeEditorWidget.js:296](<checkout>/node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor/browser/widget/codeEditor/codeEditorWidget.js:296) は model detach 後に `onDidDispose` を発火するため、その時点で今から描画しない。
選択4ファイルだけでは外側の tab disposal 呼出し経路を確認できないので、そこで既存の listener／model／preview の所有者に接続することは実装時の確認条件に残す。

preview は新 SVG を commit し node metadata／anchor を整えた直後、既存の center／focus／minimap 更新処理を同期実行する。
`hasPositioned`、正の viewport 寸法、current revision、disposed の既存 guard を保持し、通常更新で scale／pan を初期化しない。
hidden 中は旧 clone を現在図として残さず、minimap を非表示または消去して現在 render の layout を保留する。
visible activation は基準で既に preview refresh を依頼するため、そこで再び現在 SVG を測定して初回 positioning／minimap を完成させる。
animation frame を補助的に残す場合も、正しい現在の clone／viewport の更新をその callback のみに置かず、遅延 callback が revision・disposed・その間の pan／focus 操作を上書きしないようにする。
背景 double-click の [preview.ts:330](https://github.com/takasek/pfdsl/blob/d1fd7d875e19c665086d6e99508fb2694ce1eac3/packages/editor/src/preview.ts#L330) も center を frame にだけ依存させているので、同じ同期 layout 経路へ接続する候補である。
error の [preview.ts:357](https://github.com/takasek/pfdsl/blob/d1fd7d875e19c665086d6e99508fb2694ce1eac3/packages/editor/src/preview.ts#L357) でも旧 minimap が残る静的入力があるため、現在図がない場合は clone／viewport を隠す。

この案は model の内容、Undo stack、native keybinding、native reveal policy を変更せず、model の現状態を表示へ反映する要求を追加する。
cursor／viewport を強制的に先頭へ reset する方式にはしない。
browser の repaint／compositor まで保証できるという主張はしない。

## 比較案と却下理由

| 案 | 評価 |
| --- | --- |
| content／cursor／selection／scroll／layout と activation から RAF 非依存の render を一回へまとめ、preview を commit 直後に同期更新 | 採用候補。モデル・Undo・既存の移動方針を保持し、今回の二つの表示経路を直接扱える。 |
| `layout()` の追加のみ | 内容や selection の変更で必ず layout event が出るとは公開契約にない。minimap の RAF 依存も残る。 |
| `renderAsync()` または RAF にもう一度入れる | frame の停止・遅延という要件を同じ依存に戻す。 |
| 一定周期の timer で全 editor を強制描画 | idle／hidden 文書にも継続コストと寿命管理を追加する。必要な public event を観測できるため、小修正として優先しない。 |
| Cmd+Up を独自 command で置換し、setPosition／reveal を毎回実行 | paste／Undo／scroll を直せず、selection・多カーソル・既存 reveal policy を変更する。logical cursor が既に正しいという観測にも合わない。 |
| source を setValue し直す、model／editor を作り直す | 表示以外の状態・Undo・selection・focus・model 所有を巻き込む。今回の最小修正として不適切。 |
| event listener 内の無条件同期 render | 通常の public event は内部更新後だが、render 自体が scroll event を生む。command 後の reveal を含むことと再入防止が明示しにくいので、coalesced な post-command flush を優先する。 |
| window.requestAnimationFrame を全体で timer に置換 | アプリ全体・Monaco 内部の scheduling 契約を広く変更する。局所の公開 API で対処できる。 |

## 実装後に必要な受入確認

RAF callback を配送しない条件で、source 貼替え後の可視行・主図・minimap が同じ現在文書になることを確認する。
長文末尾から Cmd+Up を行い、logical cursor／可視 caret／viewport が同じ先頭になることを確認する。
content だけでなく selection 変更、wheel／scroll、Undo／Redo、hidden tab の編集と復帰、初回 hidden mount、dispose 前の予約済み flush、遅延旧 render の revision を試す。
通常の pan／zoom／view 保持を最低一本含め、render 中に scroll event を返す fake で予約が無限連鎖しないことを検査する。
これらは今回の reviewer が実行した検証ではなく、上の静的修正案を実装後に成立させる条件である。
