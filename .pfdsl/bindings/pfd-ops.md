# pfd-ops バインディング

pfd-ops 運用に紐づく、Claude へ恒常的に届けたい指示（PR 本文規約等）はこのファイルに置く（命名規則は `.claude/skills/pfd-ops/references/architecture.md` の「バインディングファイルの命名規則」参照）。読まれる契機は pfd-ops SKILL.md の該当行が保証する。サイクル外でも常時届けたい指示は root `CLAUDE.md` からこのファイルへポインタを張る。

新しい指示が生まれたら、配布先リポでも一般に有効かを評価する。有効なら `.claude/skills/pfd-ops/references/` に追記し配布に載せる（workflow.md「知見の振り分け（3経路）」の経路1と同じ）。このリポ固有の事情に依るなら、このファイルに追記する（採用リポ側でも既定の置き場になる。pfd-ops SKILL.md「Claude 向け指示の置き場」参照）。

## scaffold/ ドリフトのセルフチェック

pfd-ops 発火時、SKILL.md の配置ファイル鮮度セルフチェックに続けて次を実行する:

```bash
node scripts/check-scaffold-sync.mjs
```

`.claude/skills/pfd-ops/references/scaffold/`（`gen-plugin.mjs` のコピー元）と `plugin/pfdsl/skills/pfd-ops/references/scaffold/`（配布用ミラー）の drift を検知する。警告が出たら `node scripts/gen-plugin.mjs` で反映してからコミットする。`install/` と異なり `scaffold/` に `--deploy` 相当の機構はない（scaffold は `/pfd-init` がコピー後にユーザーが値を埋めるテンプレートのため、実配置先は用途的に別物になる）。

## install/ の双方向 sync（staged-side-wins、#547）

`.claude/skills/pfd-ops/install/`（canonical）と配置先（deployed、例: `scripts/pfdsl/lib/gh-compat.mjs`）は本来 byte-identical だが、実際に動くのは deployed 側であり編集も deployed 側から始まることが多い。乖離をコミット時に自動解決するため、`scripts/pre-commit` から `node scripts/sync-install.mjs --staged` を無条件に実行する。ファイルごとの解決規則は次の通り。deployed 側のみ staged なら lift（deployed → canonical）。canonical 側のみ staged なら deploy（canonical → deployed）。両方 staged かつ内容が異なるなら ambiguous として何もせずコミットを止め、どちらを採用するか人間に選ばせる。どちらも unstaged（working tree のみの乖離）なら何もせず skip として報告する。

lift/deploy が確定した分は解決結果を自動で `git add` し、コミットが一発で通るようにする（他の biome/snapshot/gen-plugin drift チェックの「直して exit 1、人間が re-stage」とは異なる新しい流儀。このステップは既に staged な片側のバイトをもう片方へ複製するだけで人間のレビュー対象が増えないため、auto-stage で問題ない）。lift が canonical 側を書き換えた場合は `plugin/pfdsl/skills/pfd-ops/` ミラーも古くなるため、続けて `gen-plugin.mjs` を実行する（dist が stale なら skip し CI 側の検査に委ねる）。

このとき `git add` する範囲は `plugin/pfdsl/skills/pfd-ops/install` だけに絞る。
`gen-plugin.mjs` は `plugin/pfdsl/` 全体を作業ツリーから再生成するため、`git add plugin` と広く staged すると `.claude/skills/**` の**未 staged な編集**に由来する生成物まで巻き込む。
人間が staged していない変更が、レビューの機会なくコミットに入ってしまう。
絞っておけば、それらは未 staged のまま残り、後続の gen-plugin drift チェックが「plugin が stale」として明示的にコミットを止める。
自動解決は曖昧でないものに限る、という本機構の原則がここにも当てはまる。

手動で揃えたい場合は `make sync-install` を使う（manual mode: 全乖離を lift として解決し `gen-plugin` まで実行する）。既存の `.claude/skills/pfd-ops/scripts/check-install-sync.mjs --deploy`（canonical → deployed 一方向、orphan 削除つき）とは役割が異なり併存する。

## spec 参照の token 節約（get-by-ID）

`docs/` 内の `(SPEC_xxx)` 定義済みブロックを参照する際は、ファイル全文を Read せず `node scripts/get-spec-id.mjs SPEC_xxx` で該当ブロックのみ取得する（レンジ規則は ADR-0027）。
参照先が `[[SPEC_xxx]]` / `[[SPEC_xxx?]]` で書かれている本文を追うときが起動契機。

## 仕様 ID の採番手続き

新規 ID を採番する前に slug の既出を確認する（ADR-0027「ID の性質」）。機械列挙は `node scripts/mint-check.mjs <slug>` を使う（定義・strict 参照・forward-ref の全出現を file:line で列挙し、既出ありなら exit 1。tombstone 次元は初 ID 削除まで据え置き #405）。
採番しようとした slug が既存 forward-ref（`[[SPEC_xxx?]]`）と一致した場合、その forward-ref が予約した概念と同一かを確認し、別概念なら slug を変える。
削除された ID は再利用しない。
