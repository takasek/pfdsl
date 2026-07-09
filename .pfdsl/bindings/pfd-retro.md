# pfd-retro バインディング

A・B・C カタログ（監査観点の枠組み）: `docs/review-perspectives.md`（配布レンズ）。当リポの具体例・機構は `.pfdsl/review-perspectives.md`（instance）に蓄積する。

C 系の対象仕様: `docs/spec/spec.md`。実行手順: `/spec-stress-test`（リポローカル）。

設計決定記録: `docs/adr/`（ADR。一覧・改訂規約は `docs/adr/README.md`）。pfd-ops 定期監査トリガーの「設計決定記録」はこれを指す。

PFD 採用状況: roadmap（`.pfdsl/roadmap.pfdsl`）・workflow（`.pfdsl/workflow.pfdsl`）・runtime-pipeline（`.pfdsl/runtime-pipeline.pfdsl`）を採用。

出力宛先は `.pfdsl/workflow.md`「知見の振り分け（3経路）」セクションに従う。companion への書き分け（どの companion に書くか）は `.claude/skills/pfd-ops/references/architecture.md` の「companion への書き分けルール」表が一次情報。

## 配布物への finding 反映

配布 bundle（`.claude/skills/pfd-*` 配下のスキル本文・reference）は `pfdsl skill sync` が採用リポへ無条件上書きコピーする配布物であり、採用リポで直接編集しても次回 sync で消える。
finding を配布物に反映したい場合は、出力表の宛先（companion 等）に記録した上で、上流リポへの変更提案として起票する。
本スキル本文（SKILL.md）に取り込めるのは L1（固有名詞ゼロの汎用プロトコル — 層定義は `pfd-ops/references/architecture.md`）に一般化できる記述のみ: リポ固有の固有名詞・issue 番号・ファイルパス・ADR 番号は禁止、配布 bundle 内のスキル・reference への相互参照は可。
一般化できない具体例は companion に残す。
このリポは pfd-retro スキルの上流であるため、この変更提案をその場での編集として実施してよい（採用リポにこの経路は無い）。
