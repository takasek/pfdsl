# pfd-ops バインディング

pfd-ops 運用に紐づく、Claude へ恒常的に届けたい指示（PR 本文規約等）はこのファイルに置く（命名規則は `.claude/skills/pfd-ops/references/architecture.md` の「バインディングファイルの命名規則」参照）。読まれる契機は pfd-ops SKILL.md の該当行が保証する。サイクル外でも常時届けたい指示は root `CLAUDE.md` からこのファイルへポインタを張る。

新しい指示が生まれたら、配布先リポでも一般に有効かを評価する。有効なら `.claude/skills/pfd-ops/references/` に追記し配布に載せる（workflow.md「知見の振り分け（3経路）」の経路1と同じ）。このリポ固有の事情に依るなら、このファイルに追記する（採用リポ側でも既定の置き場になる。pfd-ops SKILL.md「Claude 向け指示の置き場」参照）。

## 配置ファイル鮮度セルフチェックはこのリポでは repo-local 版を正とする

このリポは pfd-ops スキルの上流であり、`.claude/skills/pfd-ops/` が canonical、plugin cache 配下（`~/.claude/plugins/cache/pfdsl/pfdsl/<version>/`）はそこから配布された過去のスナップショットである。
両方が実在して食い違う状況を SKILL.md のロード元判定が扱わないこと、古い側の報告が drift でなく陳腐化であること、`--deploy` で追随してはならないことは `.pfdsl/bindings/pfd-retro-patterns/duplicate-name-not-a-discriminator.md` が一次情報。

したがってこのリポでは、pfd-ops 発火時のセルフチェックは `node .claude/skills/pfd-ops/scripts/check-install-sync.mjs --upstream` で実行する。
#971 以降、向きの判定はスクリプト側が持つ — このリポを target とした実行は上流と分類され、どちらの実体から起動しても `--deploy` は案内されず明示指定でも停止する。したがってこの規約が残す指示は「repo-local 版を使う」だけで、`--deploy` を避ける判断を読み手に委ねてはいない。

pfd-ops 発火時、SKILL.md の配置ファイル鮮度セルフチェックに続けて次を実行する:

```bash
node scripts/check-scaffold-sync.mjs
```

`.claude/skills/pfd-ops/references/scaffold/`（`gen-plugin.mjs` のコピー元）と `plugin/pfdsl/skills/pfd-ops/references/scaffold/`（配布用ミラー）の drift を検知する。警告が出たら `node scripts/gen-plugin.mjs` で反映してからコミットする。`install/` と異なり `scaffold/` に `--deploy` 相当の機構はない（scaffold は `/pfd-init` がコピー後にユーザーが値を埋めるテンプレートのため、実配置先は用途的に別物になる）。

## CLI はこのリポでは常にローカルビルドを叩く

`pfdsl` / `npx pfdsl` は npm 公開版の `@pfdsl/cli` を走らせる。
このリポは上流であり、公開版は main より必ず遅れているため、公開版で `.pfdsl` を検査すると main で既に直っている欠陥を実在の所見として拾う。
同じ番号を名乗る2実体を番号では判別できない形は `.pfdsl/bindings/pfd-retro-patterns/duplicate-name-not-a-discriminator.md` が一次情報。

したがって手で CLI を叩く場合も `node packages/cli/dist/cli.js <cmd>` を使う（`cycle-status.mjs` / `gate-check.mjs` および `.pfdsl` の `command:` フィールドが既にこの形を使っている — 手打ちだけが例外になっていた）。
worktree では先に `pnpm install && pnpm -r build` を済ませる。
pfdsl スキル本文の CLI プリフライトは採用リポ向けに `pfdsl` / `npx pfdsl` を指示するが、上流であるこのリポではこの規約が優先する。

`check-install-sync.mjs` を repo-local 版で走らせる上の規約と同じ形（上流リポでは正とする実体を1つに固定する）であり、適用先が検査スクリプトから CLI 本体へ広がったもの。

## spec 参照の token 節約（get-by-ID）

`docs/` 内の `(SPEC_xxx)` 定義済みブロックを参照する際は、ファイル全文を Read せず `node scripts/get-spec-id.mjs SPEC_xxx` で該当ブロックのみ取得する（レンジ規則は ADR-0027）。
参照先が `[[SPEC_xxx]]` / `[[SPEC_xxx?]]` で書かれている本文を追うときが起動契機。

## 仕様 ID の採番手続き

新規 ID を採番する前に slug の既出を確認する（ADR-0027「ID の性質」）。機械列挙は `node scripts/mint-check.mjs <slug>` を使う（定義・strict 参照・forward-ref の全出現を file:line で列挙し、既出ありなら exit 1。tombstone 次元は初 ID 削除まで据え置き #405）。
採番しようとした slug が既存 forward-ref（`[[SPEC_xxx?]]`）と一致した場合、その forward-ref が予約した概念と同一かを確認し、別概念なら slug を変える。
削除された ID は再利用しない。

## 削除判断に関わる上流の意図を確認する

削除を確定する前に、対象と関連する consumer・兄弟実装・正本や生成・配送境界について、削除判断に関わる未確認の意図や変更がないか確認する。
呼び出し元ゼロだけで不要と判断する場合、並行した上流変更がある場合、正本や生成・配送境界を削る場合は、判断に必要な履歴と差分を読み、所有者の意図と削除後の影響を確かめる。
確認済みの対象・削除理由・関連範囲が変わらず、その範囲に新しい変更がなければ結果を再利用し、削除コミットごとに同じ履歴を読み直さない。
同じセッションで作成した使い捨ての一時ファイルの片付けや、上記を確認済みの削除には、追加の履歴確認を課さない。
対象・関連実装・consumer・生成や配送の規約に変更が入った場合、または削除範囲や理由が変わった場合は、影響する部分を再確認する。
base が無関係な変更で進んだことだけでは再確認せず、固定件数の履歴や merge conflict の有無を、意図を確認した証拠にしない。

## サイクル中の下書きはリポジトリの外へ置く

設計選択記録・PR 本文・委譲ブリーフ等の下書きは `/tmp` へ置き、ファイル名にセッション固有の要素（worktree 名等）を含める。
リポジトリの内側へ置く必要がある場合は、そのパスが今サイクルで触っている検査の列挙対象に入らないことを、検査自身の列挙範囲で確かめる。
`.claude/` 直下は consumer fixture のコピー元であり、置いた時点で output closure 検査が undeclared surface として数える。
worktree 配下であることは他セッションとの衝突だけに答えるもので、このリポの検査に入るかには答えない。
