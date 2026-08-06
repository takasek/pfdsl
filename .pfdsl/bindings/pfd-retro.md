# pfd-retro バインディング

A・B・C カタログ（監査観点の枠組み）: `docs/review-perspectives.md`（配布レンズ）。当リポの具体例・機構は `.pfdsl/review-perspectives.md`（instance）に蓄積する。

C 系の対象仕様: `docs/spec/spec.md`。実行手順: `/spec-stress-test`（リポローカル）。

設計決定記録: `docs/adr/`（ADR。一覧・改訂規約は `docs/adr/README.md`）。pfd-ops 定期監査トリガーの「設計決定記録」はこれを指す。

PFD 採用状況: roadmap（`.pfdsl/roadmap.pfdsl`）・workflow（`.pfdsl/workflow.pfdsl`）・runtime-pipeline（`.pfdsl/runtime-pipeline.pfdsl`）を採用。

出力宛先は `.pfdsl/workflow.md`「知見の振り分け（3経路）」セクションに従う。companion への書き分け（どの companion に書くか）は `.claude/skills/pfd-ops/references/architecture.md` の「companion への書き分けルール」表が一次情報。
## 監査の追加パターン（このリポで検出）

パターンは1件1ファイルで `.pfdsl/bindings/pfd-retro-patterns/` に置く。
このファイルを全読しても本文は出てこない — 引くのはスクリプトである。

```bash
node scripts/retro-patterns.mjs tags                                  # 語彙を prefix ごとに列挙する
node scripts/retro-patterns.mjs select --tag <tag> --word <word>      # 今サイクルで読むべきものを出す
node scripts/retro-patterns.mjs list                                  # 全件を名前と一文で並べる
node scripts/retro-patterns.mjs check                                 # 全ファイルの解析可否・名前一致・タグ有無・往復一致を検査する（make check-docs から自動実行、手動は書式直後の確認用）
```

`tags` の出力が語彙の実体である。
正準リストはどこにも無いので、乖離する相手が存在しない。
prefix は3つ立っている — `target:`（trap が起きる対象物）・`method:`（そのサイクルで行った行為）・`context:`（行為でなく成立していた周辺条件）。
prefix も値も宣言されておらず、新しいものを弾く機構も無い。
見慣れない軸や件数1のタグは `tags` の出力に見えるので、そこで気付く。

`select` は3節を返す。
`--tag` は常に和集合で、積を取る手段は用意していない（実測で14件が3件へ落ちる操作であり、落ちた分は黙って読まれないため）。

- **tagged** — 渡したタグのいずれかを持つもの
- **word-only** — 語だけが当てたもの。**タグが取りこぼした分がここに出る**。`--word` を渡さない回はその旨が出る
- **always** — 毎サイクル成立するパターン。渡したものに関わらず必ず付く

タグが N 件返した回ほど危ない。
0件は目立つので立ち止まるが、N件は「絞れた・読んだ・終わり」で止まる。
`--word` には今サイクルの diff にある具体的な語（変更したファイル名・触ったフラグ・エラー文言）を渡す。
タグは付けた人が予期できた軸しか答えないが、本文の `具体例:` にはタグには載らない固有名詞が入っている。

### パターンを追記するとき

- ファイル名はパターン名そのもの。本文は `- **パターン名**: ` で始める（この bullet 形式は、分割前のカタログとバイト単位で一致させるために保っている）
- **冒頭の一文が定義文になるように書く。** 要約は frontmatter に持たず、この一文から導出される。二文目以降に `問いの形:`・`具体例:`・`対策:` を置く
- frontmatter は `tags` のみ。既存の語彙を `tags` で見てから選ぶ
- 迷ったら3軸それぞれを埋められないか考える。1軸しか思いつかないパターンもある（`always` の2件は軸を持たない）

## 配布物への finding 反映

誰が配布層を編集できるかの一般ルールは pfd-retro SKILL.md「出力」節の「上流変更ルール」が一次情報（ADR-0028）。
このリポは pfd-* bundle の上流であるため、そのルールの「自リポが上流である場合」に当たり、配布物への finding 反映をその場での編集として実施してよい（採用リポにこの経路は無い）。
配布スキル本文（SKILL.md）に取り込めるのは L1（固有名詞ゼロの汎用プロトコル — 層定義は `pfd-ops/references/architecture.md`）に一般化できる記述のみ: リポ固有の固有名詞・issue 番号・ファイルパス・ADR 番号は禁止、配布 bundle 内のスキル・reference への相互参照は可。
一般化できない具体例は companion に残す。
