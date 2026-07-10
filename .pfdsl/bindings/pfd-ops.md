# pfd-ops バインディング

pfd-ops 運用に紐づく、Claude へ恒常的に届けたい指示（PR 本文規約等）はこのファイルに置く（命名規則は `.claude/skills/pfd-ops/references/architecture.md` の「バインディングファイルの命名規則」参照）。読まれる契機は pfd-ops SKILL.md の該当行が保証する。サイクル外でも常時届けたい指示は root `CLAUDE.md` からこのファイルへポインタを張る。

新しい指示が生まれたら、配布先リポでも一般に有効かを評価する。有効なら `.claude/skills/pfd-ops/references/` に追記し配布に載せる（workflow.md「知見の振り分け（3経路）」の経路1と同じ）。このリポ固有の事情に依るなら、このファイルに追記する（採用リポ側でも既定の置き場になる。pfd-ops SKILL.md「Claude 向け指示の置き場」参照）。

## spec 参照の token 節約（get-by-ID）

`docs/` 内の `(SPEC_xxx)` 定義済みブロックを参照する際は、ファイル全文を Read せず `node scripts/get-spec-id.mjs SPEC_xxx` で該当ブロックのみ取得する（レンジ規則は ADR-0027）。
参照先が `[[SPEC_xxx]]` / `[[SPEC_xxx?]]` で書かれている本文を追うときが起動契機。

## 仕様 ID の採番手続き

新規 ID を採番する前に slug の既出を確認する（ADR-0027「ID の性質」。機械列挙は mint-check ツール #405 — 実装までは `grep -rn 'SPEC_<slug>' docs/` で代用）。
採番しようとした slug が既存 forward-ref（`[[SPEC_xxx?]]`）と一致した場合、その forward-ref が予約した概念と同一かを確認し、別概念なら slug を変える。
削除された ID は再利用しない。
