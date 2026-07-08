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

## retro 実行記録

pfd-retro 実行ごとに1行追記する（形式: 日付 — 対象範囲 — findings 件数）。pfd-ops プロトコル「定期監査」の起動条件はこの記録を基準点に差分計測する。

- 2026-07-03 — pfd-cycle スキル群（pfd-ops / pfd-retro / pfd-ecosystem / commands / architecture.md）設計レビュー — findings 15件 + meta 1件
- 2026-07-03 — 第2ラウンド監査（片肺更新スキャン・L4 滞留昇格・列挙ドリフト。対象: 第1ラウンド反映後の全体） — findings 8件
- 2026-07-04 — #297 V025 二重割当修正サイクル — findings 2件（i300 除外リスト欠落・除外リスト列挙ドリフト対策ルール追加）
- 2026-07-05 — #299 診断コードレジストリサイクル — findings 2件（既存ブランチ再開時の rebase チェック漏れを pfd-ops 選択手順に追加・diag_registry description の実装乖離修正）
- 2026-07-05 — #304 extends オラクルプローブサイクル — findings 2件（spec-stress-test スキルに CLI 非露出時の正解確定手法を蒸留・新規 md 作成時の check-md-linebreaks 自己検査ゲート追加）
- 2026-07-06 — #300 spec 編集整備サイクル — findings 1件（§20 の版番号複製を除去しタイトル行を唯一の権威に統一。workflow.md 権威節に再記載禁止を明記）
- 2026-07-06 — d〜g 構造レビュー（配布4スキル・skill sync・release フロー・生成パイプライン） — findings 14件（exempt 13件 → トラッカー #351、managed 1件 → #352 採用初日プローブ）
- 2026-07-06 — #354 cycle-status/gate-check 実装サイクル — findings 1件（gen-skill トリガー正規表現の pre-commit/gate-check.mjs 間重複 → #364）
