---
tags: [target:cli-write-command, context:review-finding]
---

- **frontmatter の id を、表現ごとに違う形で照合してしまう trap**: frontmatter を書き換えるコマンドは、同じ id を少なくとも2つの表現で読む。
  `analyze()` が返す plain object ではキーが常に文字列になり、`parseFrontmatterCst` の CST では scalar が YAML の型（数値・真偽値等）のまま残る。
  存在確認を一方の表現で行い、書換え対象の探索を他方で行うと、両者が食い違う入力で「宣言されているのに見つからない」状態になる。
  plain object への角括弧アクセスは `toString` や `constructor` のような継承メンバーも拾うため、存在確認の側だけでも同じ族の誤りが起きる。
  問いの形: 「この id を照合している箇所はどの表現を読んでいるか。すべての照合が同じ同一性（文字列化した値・自前のプロパティ）を使っているか」。

  観測（2026-09-26〜27、issue #1218 のサイクル、PR #1276）: `meta rename-group` の初回実装は、CLI 側が `frontmatter.group[oldId] !== undefined` で存在を確認し、core 側が CST のキー scalar を `=== oldId` で探していた。
  委譲戻りの検収で、未宣言の `toString` を渡すと `renamed group 'toString' ...` と成功を報告し、`constructor` への改名は既存扱いで拒否されることを実行して確認した。
  その修正後の独立レビューで、素の数値キー `42:` が「internal mismatch」で改名できないことが見つかった。
  同じ族の欠陥が2周続いたため、キーの書き方8種 × 新 id 3種 × flow / block の48通りに、仕様側の不変条件（改名後に読み直すと old が消えて new が全参照位置にある）を当てるテストを `packages/core/src/rename-group.test.ts` に追加した。
  厳密一致へ戻した欠陥版では、この48件のうち `42`・`3.14`・`true` を使う18件が失敗することを確認している。

  原因の仮説（未検証）: 委譲時のブリーフが拒否条件を列挙する一方、「どの表現で id を照合するか」を入力として渡していなかった。既存の `meta set` は id をノード（artifact / process）の存在確認だけに使い、YAML キーの型を問題にしない経路だったため、先例にも答えがなかった。

  続報（2026-09-27）: 同じサイクルで決定を変え、`meta rename-group` をトップレベルの `rename`（artifact / process / group）に置き換えた。`renameId` も `String()` で照合し、node 改名について id の綴り × 参照位置 × 宣言の有無の直積テストを `packages/core/src/rename-id.test.ts` に持つ。種別の判定では `nodeKinds` が1つの id に1種別しか持たないため、group と node の同名を frontmatter の各節と body の edge から直接検出して拒否している。

  続報（2026-09-28）: 最初は「この照合の罠に気をつける」形で記録したが、ユーザーの指摘で設計の欠陥として扱い直した。原因は、モデルの id（文字列）と YAML の CST のキー（型付き）を結ぶ同一性の規約が無かったことにある。根本の対策は PR #1298（spec v0.0.24）で、宣言 id のキーと参照値を YAML の文字列に限定し、型付きのキーや型だけが違うキーの重複を読込み時に FM004 で拒否する。これにより、書込み経路ごとに照合を工夫する必要が無くなり、`rename` の型付きキー向けの照合は撤去した（`boundary:` の中のキーだけは制約外のため文字列で照合する）。種別の判定は core の `rename()` に一本化し、frontmatter の各節・edge・body の単独ノード宣言から判定している。

  未解決: group と artifact / process の同名を `check` が正しく報告しない件は #1291、`meta set` が body だけに現れるノードを「not found」と報告する件は #1305（#1292 から移管）。
