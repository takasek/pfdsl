---
tags: [target:check-design, context:review-finding]
---

- **検査の入力になる分類を、その検査が比較する対象から導いてしまう trap**: 「リテラルの列挙をやめて、既にある宣言から導け」はレビューで出やすい一般化であり、多くの場合は正しい。
  ただし導く先が**その宣言と実体を突き合わせる検査の入力**である場合、一般化は検査を循環させる。
  宣言が実体からずれたとき、分類の側も同じ宣言を見ているので対象が分類されなくなり、ずれは「不一致」ではなく「検査対象の不在」として消える。
  緑が返るので、検査は動いているように見える。
  問いの形: 「この分類の出力は、どの検査の入力になるか。その検査は、分類が参照するのと同じデータを『正しさの基準』として比較していないか」。

  観測（2026-09-18、issue #1160 のサイクル）: `addConcreteAdapterWrites` は、リポジトリルートへ書かれた surface が claude-repository と codex-repository のどちらの出力かをパスのリテラル一致で判定していた。
  レビュー（altitude 観点）が「`harness-inventory.mjs` の宣言済み outputs から導けば一般化できる」と指摘し、その形で実装した。

  証拠: `scripts/lib/gen-plugin.test.mjs` の「rejects a renamed Claude repository surface observed from its maintained source」が落ちた。
  このテストは claude-repository の宣言済み output を `RENAMED.md` へ書き換えたうえで、実際に書かれる `CLAUDE.md` が output closure 違反として検出されることを固定している。
  宣言から分類を導くと、`CLAUDE.md` はどの target にも属さず分類の段階で除外され、違反として報告されなくなった。
  リテラル判定へ戻し、理由を関数の JSDoc へ書いた。

  原因の仮説（未検証）: レビュー観点が「特殊ケースの除去」を単独の善として評価し、その特殊ケースが検査の独立性を担保していた可能性を入力として持たない。

  未解決: 「この値は検査の独立性を担保している」という性質をコード側に表明する手段が無く、現在は JSDoc の散文だけが次の一般化を止める。
