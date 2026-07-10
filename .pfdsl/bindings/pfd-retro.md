# pfd-retro バインディング

A・B・C カタログ（監査観点の枠組み）: `docs/review-perspectives.md`（配布レンズ）。当リポの具体例・機構は `.pfdsl/review-perspectives.md`（instance）に蓄積する。

C 系の対象仕様: `docs/spec/spec.md`。実行手順: `/spec-stress-test`（リポローカル）。

設計決定記録: `docs/adr/`（ADR。一覧・改訂規約は `docs/adr/README.md`）。pfd-ops 定期監査トリガーの「設計決定記録」はこれを指す。

PFD 採用状況: roadmap（`.pfdsl/roadmap.pfdsl`）・workflow（`.pfdsl/workflow.pfdsl`）・runtime-pipeline（`.pfdsl/runtime-pipeline.pfdsl`）を採用。

出力宛先は `.pfdsl/workflow.md`「知見の振り分け（3経路）」セクションに従う。companion への書き分け（どの companion に書くか）は `.claude/skills/pfd-ops/references/architecture.md` の「companion への書き分けルール」表が一次情報。

## 監査の追加パターン（このリポで検出）

- **並行委譲の接合部**: 複数 subagent へ並行委譲した成果物同士の整合は、各委譲の受け入れ基準では検証されない。
  検収では成果物ペアの接合部（一方が定める規約 × 他方が生成する内容）を突合する。
  問いの形: 「委譲 A の出力は、委譲 B が実装した検査・規約の除外条件に収まっているか」。
  具体例: ADR の構文例引用（double-backtick span）と lint の inline-code 除外（当時 single-backtick のみ対応）の組で、構文例が実マーカーとして検出され、定義例と参照例が相互解決して lint が偶然 PASS した（#328。除外は #398 で backtick run 対応に修正済み）。
  検査 PASS は接合部の健全性を保証しない — 例示が実データ化していないかを実マッチ列挙（検出関数の直接実行）で確認する。

## 配布物への finding 反映

配布 bundle（plugin 同梱の pfd-* スキル本文・reference）は上流リポ（takasek/pfdsl）の生成・同梱物であり、採用リポ側のコピーは編集対象にならない（ADR-0028。plugin cache 内のファイルはインストール更新で消える）。
finding を配布物に反映したい場合は、出力表の宛先（companion 等）に記録した上で、上流リポへの変更提案として起票する。
本スキル本文（SKILL.md）に取り込めるのは L1（固有名詞ゼロの汎用プロトコル — 層定義は `pfd-ops/references/architecture.md`）に一般化できる記述のみ: リポ固有の固有名詞・issue 番号・ファイルパス・ADR 番号は禁止、配布 bundle 内のスキル・reference への相互参照は可。
一般化できない具体例は companion に残す。
このリポは pfd-retro スキルの上流であるため、この変更提案をその場での編集として実施してよい（採用リポにこの経路は無い）。
