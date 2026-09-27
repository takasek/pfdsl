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

  未解決: prototype 名の欠陥は CLI 層（`Object.hasOwn`）で塞いでおり、core の直積テストの範囲外にある。既存の `delete` は数値キーの宣言を `doc.hasIn` に文字列を渡して探すため、`10:` の宣言を消せないまま `deleted` と報告する（#1218 の独立設計レビューで観測。group を消せない件は #1278）。
