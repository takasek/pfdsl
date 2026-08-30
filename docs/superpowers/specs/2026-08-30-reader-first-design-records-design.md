# Reader-first 設計選択記録

## 目的

pfd-ops が要求する比較検査と着手前の公開記録を維持しながら、ユーザーが採用案から読める説明順へ変更する。

## 変更前の観測

同じ bounded change のシナリオを現行 `work-cycle.md` だけを読む fresh-context agent 5件に与えた。
4件は `前提:` を採用案より前に提示し、1件だけが採用案を先に提示した。
現行規則は必須情報を運ぶが、対話の出力順を契約しないため、検査手順が読者向け説明の主役になる。

## 公開記録契約

移行後の設計選択記録は次の4行をこの順で持つ。

```text
提案: <採用する変更>
理由: <目的と採用案の対応>
前提を外した対案: <列挙済みの集合外も検査する競合案>
対案を採らない理由: <外部制約または所有者に帰着する理由>
```

候補案が複数列挙される場合の `案の処分 N:` と、実装しない決定の `実装しない:` は現行契約を維持する。
行頭トークンは Markdown 装飾と全角コロンを現行と同じ正規化で許容する。

## 対話契約

ユーザーへの設計提示は「提案」「理由」の順で始める。
「前提を外した対案」と「対案を採らない理由」は後置し、bounded change でも消さない。
公開記録と同じ4トークンを対話で必ず逐語的に読み上げる必要はないが、対話で承認された内容と公開記録の意味は一致させる。

## 移行互換

移行 cutoff は `2026-08-30T09:32:50Z` とする。
この時刻より前に作成されたコメントは旧 `前提:` / `否定案:` / `却下理由:` 形式でも設計選択記録として認識する。
この時刻以降に作成されたコメントは新4行が揃った場合だけ設計選択記録として認識する。
cutoff は #1076 自身の承認済み旧形式コメント `5467906496` の作成時刻 `2026-08-30T09:32:49Z` の1秒後であり、それ以前の全記録と今回のサイクルを grandfather する。
新形式と旧形式の両方が候補にある場合は、新形式を優先し、同形式内で必須行数が最多いコメントを現行と同じ規則で選ぶ。

## 実装境界

`scripts/lib/gate-check.mjs` は新旧の必須 prefix、cutoff、record selection、content verdict を一次情報として持つ。
`scripts/lib/cycle-status.mjs` は gate-check の新 prefix 定数から reader-first テンプレートを組み立てる。
`work-cycle.md` は比較検査の意味と対話順、tracker backend references は各記録先と時系列契約を定義する。
canonical source を編集した後に生成コマンドを実行し、`.agents/` と Claude/Codex plugin の mirror を同じコミットに含める。

## 検証

RED で使った bounded-change scenario を新しい `work-cycle.md` で fresh-context agent 5件に再実行し、5件すべてが提案から始まることを確認する。
unit test は cutoff 直前の旧形式、cutoff 以降の旧形式拒否、cutoff 以降の新形式受理、新旧候補の優先度、不完全な新形式の missing-prefix 報告を覆う。
repository gate は skill/plugin 生成物の identity、review record、PFD snapshot、issue-flow を確認する。
