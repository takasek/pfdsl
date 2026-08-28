<!-- DO NOT EDIT. Authoritative source: .claude/skills/pfd-ops/references/scaffold/bindings/pfd-retro.md. -->

# pfd-retro バインディング

A/B/C カタログ（監査観点の枠組み・配布）: pfdsl スキルの `references/review-perspectives.md`（plugin なら `${PLUGIN_ROOT}/skills/pfdsl/references/`、repo-local なら `.agents/skills/pfdsl/references/`）。当リポで検出した具体例は `.pfdsl/review-perspectives.md`（配布カタログの当リポ instance）に蓄積する。

PFD 採用状況: (採用した種別を列挙する。例: roadmap・workflow を採用、runtime-pipeline 未採用)

出力宛先: (リポ固有の上書きがある場合のみ記入する。)

## 監査の新パターン

パターン本体はこの binding 自身が持たず、`.pfdsl/bindings/pfd-retro-patterns/` に**1件1ファイル**で置く。
見本として `bindings/pfd-retro-patterns/` にサンプル1件を同梱してある。書式の参考にし、このリポが最初のパターンを書いたら削除してよい。

書式: ファイル名 = パターン名（ASCII kebab-case）。
本文は `- **パターン名**: ` で始め、**冒頭の一文が定義文**になるように書く。
二文目以降に `問いの形:`・`具体例:`・`対策:` を置く。
frontmatter は `tags` のみ。

タグは**そのパターンが発火するサイクルの条件**を表す（具体例が起きた場所でも、打った対策でもない）。
判定テスト: そのタグを持つサイクルを1つ思い浮かべ、そのサイクルでこのパターンを読むべきかを問う。
読むべきでないなら、そのタグは発火条件ではなく別のものを表している。

導入トリガー: 件数が増えて全読が効かなくなったら検索の仕組みを入れる。
閾値は **40件 または 40KB**。
**この根拠は上流（本 binding を配布するリポ）の実測1点のみ**である — モノリス1ファイルが 74KB・37件に達した時点で全読が実行されなくなり、実行主体が grep での部分読みへ切り替え、その範囲は記録に残らなかった。
採用リポは自分の実測が取れ次第、この閾値をその実測で置き換えてよい。

## パターンの改訂・統合・廃止

近いパターンが既にあれば、新規追加でなく既存パターンへ具体例を足す（統合を既定にする）。
廃止は「対策が機械化され、その trap が構造的に起こり得なくなったとき」に限り、機械化した回自身が同じサイクルで行う。
廃止は該当パターンの削除で行い、記録だけを残す空ファイルは作らない — 記録は削除のコミット自体が残す。
