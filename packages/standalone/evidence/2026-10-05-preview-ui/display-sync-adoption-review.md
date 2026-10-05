# 表示同期の採用理由の独立照合

未修正 `origin/main` の選択 tree `d1fd7d875e19c665086d6e99508fb2694ce1eac3` を読んだ独立設計原本 `display-sync-design-review.md` と、現行の表示同期 source を照合した。
提示された採用理由を証拠として扱わず、installed Monaco 0.57.0 の一次 source と、既に実行した actual-production-browser 4ケース、公開 event 時序の保存原本を根拠にした。
新規 GUI、build、test、Git metadata 操作、製品 source 編集、外部書込みは行っていない。

具体的な未解決 correctness finding はない。
独立設計の候補と実装の相違は、今回の source／tab／Cmd+Up の受入範囲で反例を与えていない。

## 相違の評価

- `packages/standalone/src/document-tab.ts:62` と `:164` の `render()` は、`render(true)` と同じ同期描画経路を使う。
  `codeEditorWidget.js:1249` は default `forceRedraw=false` を `view.render(true, forceRedraw)` へ渡し、`view.js:565` は `now=true` で同期 flush する。
  `true` を追加すると全 view part を強制 dirty にするが、今回の変更イベントは内部 view event を先に配送して dirty にしてから公開 event を出す (`viewModelEventDispatcher.js:71`)。
  cursor／scroll は view cursor の dirty を設定し (`viewCursors.js:108`, `:142`)、scroll は view lines も更新する (`viewLines.js:224`)。
  したがって今回必要な dirty flush を `render()` が行い、全 redraw を必須とする根拠はない。
- layout listener を増設せず、`document-tab.ts:198` の既存 `activate()` が `layout()` と refresh を行う。
  installed `codeEditorWidget.js:1080` の `layout()` 自体が default `postponeRendering=false` で同期 `render()` を呼び、さらに現在 revision の解析完了後に `document-tab.ts:164` が図の差替え前に flush する。
  tab activation の同期経路は既にある。
  追加 listener の不採用から今回の tab 復帰失敗を導く具体的反例はない。
- `document-tab.ts:61` は queued を render 前に解除するので、render 由来の scroll event は次の microtask を要求できる。
  これは同じ call stack の同期再入を起こさず、render 中に発生した新しい状態を無条件に捨てない。
  installed `view.js:497` は text rendering が scroll event を生むことを明記し、後続の view parts を取り直す。
  `view.js:474` は dirty part がなくなれば描画を打ち切り、`viewModelEventDispatcher.js:208` は変化のない scroll event を no-op として扱う。
  この installed 実装では無条件に強制 redraw を反復する構造ではない。
  ただし render 由来 event の callback 回数・収束を production で計数した証拠はないため、任意の event 連鎖について完全な上限を証明したとは扱わない。
- `document-tab.ts:55` の scheduler は model／Undo／selection／view state を置換せず、同じ editor の公開描画 API だけを呼ぶ。
  既存 preview edit と Format は `executeEdits`／Undo stops を維持する (`:93`, `:203`)。
  `:190` は editor/model dispose より先に disposed を立て、予約済み microtask は `:62` で抑止される。
  この lifetime 判定は静的照合であり、production callback cancellation の計数実測ではない。

共有 preview は `packages/editor/src/preview.ts:766` で現在 SVG を commit した後、`:797` で旧 minimap を消し、`:798` で同期 position／minimap 更新を行う。
`positionGraph()` の `:555` は disposed／revision／error／zero-size を確認し、既存 pan／zoom の再初期化は初回 positioning に限る。
`:799` の RAF は補助であり、現在図と旧 minimap を混在させないための同期処理を独占しない。
この構造は「RAF に表示の正しさを依存させない」という採用理由に一致する。

## 再利用した実行証拠と版

公開 event 時序原本 `browser-scroll-event-timing.json` では、Cmd+Up の cursor event が logical `(1,1)`／scrollTop `655`、後続 scroll event が scrollTop `0` を示す。
none／cursor-only flush は旧 line32、scroll-stage／both flush は line01 を描いた。
`document-tab.ts:59` の「同じ操作で reveal／scroll が cursor event の後に来得る」という限定した comment と整合する。
これは今回の Cmd+Up の観測であり、すべての cursor operation に同じ順序があるという契約へ一般化しない。

`browser-scroll-green.json` の既存4ケースは全件 pass、pageerror は空である。
停止した RAF 条件で Cmd+Up は現文書の1行目、Cmd+Down は現文書末尾、selection／collapse は選択矩形2→0、direct wheel は最初の描画行1→3を確認した。
Cmd+Up 後の主図と minimap の semantic ID は一致した。
可視行は editor viewport 内へ clip し、物理的な top 順で比較した。
DOM 挿入順を可視行順と誤認した最初の checker 失敗は製品 Red と数えない。

再読取した現行 `packages/standalone/src/document-tab.ts` の SHA-256 は `6796dc21775be9a8b924b72669b5c32a550e7a1c10f7be039328add4b3f41135`。
実行済み production asset `assets/index-CTNe7B5u.js` の現行 SHA-256 は `202275cb1c4132cf3fbbab165657409d61e16aebd61f9576a02c081662973142` で、実行原本の指紋と一致した。
旧 Red は `assets/index-wCSxiLhi.js` の `e1dcf67398971441d48540e8618916ca455c66e2f95793c91a3de2b5384a1463` に固定し、初期 source／主図／minimap の別版の成功記録も別に保持する。

## 証明範囲

今回の追補は静的採用理由照合と既存実行証拠の再読取である。
callback の厳密な上限、任意の自動 layout／ResizeObserver だけが発火する条件、zero-size editor の全 lifecycle、production の dispose 計数は追加実行していない。
native WebKit／AX／compositor、物理的な最初の frame の時刻、IME、distribution、別の build を認定しない。
Monaco 一次 source の上記 basename は `<checkout>/node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor/` 配下の実ファイルを指す。
