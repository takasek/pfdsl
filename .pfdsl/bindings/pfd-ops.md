# pfd-ops バインディング

pfd-ops 運用に紐づく、Claude へ恒常的に届けたい指示（PR 本文規約等）はこのファイルに置く（命名規則は `.claude/skills/pfd-ops/references/architecture.md` の「バインディングファイルの命名規則」参照）。読まれる契機は pfd-ops SKILL.md の該当行が保証する。サイクル外でも常時届けたい指示は root `CLAUDE.md` からこのファイルへポインタを張る。

新しい指示が生まれたら、配布先リポでも一般に有効かを評価する。有効なら `.claude/skills/pfd-ops/references/` に追記し配布に載せる（workflow.md「知見の振り分け（3経路）」の経路1と同じ）。このリポ固有の事情に依るなら、このファイルに追記する（採用リポ側でも既定の置き場になる。pfd-ops SKILL.md「Claude 向け指示の置き場」参照）。

## scaffold/ ドリフトのセルフチェック

pfd-ops 発火時、SKILL.md の配置ファイル鮮度セルフチェックに続けて次を実行する:

```bash
node scripts/check-scaffold-sync.mjs
```

`.claude/skills/pfd-ops/references/scaffold/`（`gen-plugin.mjs` のコピー元）と `plugin/pfdsl/skills/pfd-ops/references/scaffold/`（配布用ミラー）の drift を検知する。警告が出たら `node scripts/gen-plugin.mjs` で反映してからコミットする。`install/` と異なり `scaffold/` に `--deploy` 相当の機構はない（scaffold は `/pfd-init` がコピー後にユーザーが値を埋めるテンプレートのため、実配置先は用途的に別物になる）。

## spec 参照の token 節約（get-by-ID）

`docs/` 内の `(SPEC_xxx)` 定義済みブロックを参照する際は、ファイル全文を Read せず `node scripts/get-spec-id.mjs SPEC_xxx` で該当ブロックのみ取得する（レンジ規則は ADR-0027）。
参照先が `[[SPEC_xxx]]` / `[[SPEC_xxx?]]` で書かれている本文を追うときが起動契機。

## 仕様 ID の採番手続き

新規 ID を採番する前に slug の既出を確認する（ADR-0027「ID の性質」）。機械列挙は `node scripts/mint-check.mjs <slug>` を使う（定義・strict 参照・forward-ref の全出現を file:line で列挙し、既出ありなら exit 1。tombstone 次元は初 ID 削除まで据え置き #405）。
採番しようとした slug が既存 forward-ref（`[[SPEC_xxx?]]`）と一致した場合、その forward-ref が予約した概念と同一かを確認し、別概念なら slug を変える。
削除された ID は再利用しない。
