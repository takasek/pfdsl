# pfd-retro バインディング

A・B・C カタログ（監査観点の枠組み）: `docs/review-perspectives.md`（配布レンズ）。当リポの具体例・機構は `.pfdsl/review-perspectives.md`（instance）に蓄積する。

両カタログが分割の検討に値する規模へ育ったかは `node scripts/check-review-perspectives-scale.mjs`（`make check-docs` から自動実行）がバイト数と項目数を毎回印字する。
閾値（#797）の値はここに書かない — 一次情報は `scripts/lib/review-perspectives-scale.mjs` の `BYTE_THRESHOLD` / `ITEM_THRESHOLD` であり、超過時の通知文がその値を自分で述べる（#878）。
超えても exit code には出ない — 分割の判断は人間が行う通知であり CI を赤くする違反ではない。
この閾値は A・B・C の図・仕様レンズに適用する。過去事例の記録には適用しない。
機械化したのはこの規模判定だけで、残り2条件は未機械化のまま運用判断に委ねている:
直近5コミットの `git log --numstat` で純追記が3件以上を占めるか（改訂でなく追記のみが続いているか）、main thread がカタログを直接読む経路が主になり全読が context を圧迫していると実測できたか、の2つ。

C 系の対象仕様: `docs/spec/spec.md`。実行手順: `/spec-stress-test`（リポローカル）。

設計決定記録: `docs/adr/`（ADR。一覧・改訂規約は `docs/adr/README.md`）。pfd-ops 定期監査トリガーの「設計決定記録」はこれを指す。

PFD 採用状況: roadmap（`.pfdsl/roadmap.pfdsl`）・workflow（`.pfdsl/workflow.pfdsl`）・pipeline（`.pfdsl/pipeline.pfdsl`）を採用。

出力宛先は `.pfdsl/workflow.md`「知見の振り分け（3経路）」セクションに従う。companion への書き分け（どの companion に書くか）は `.claude/skills/pfd-ops/references/architecture.md` の「companion への書き分けルール」表が一次情報。
## 事例・観察・反例の記録

`.pfdsl/bindings/pfd-retro-patterns/` は検索可能な過去事例の置き場であり、通常作業へ対策を配る正本ではない。既存の本文・具体例・未コミットの失敗記録を残す。`33878aebdaae1c69fda95bd4aea5bf2ba0b321e3` までの記述とタグは当時の資料で、現在も適用できるとは限らない。移行の判断と確認範囲は `docs/adr/0038-retro-case-migration.md` に記録する。

調査や retro で似た事例が必要なとき、現象・ファイル名・エラー等の具体語から検索し、ヒットした本文と根拠を読む。検索の0件は失敗の不在を、ヒットは今回の適用を意味しない。タグ・phase による対策の抽出や自動選別、全読、読了記録は要求しない。

```bash
rg -n --glob '*.md' 'ENOENT|baseline|委譲' .pfdsl/bindings/pfd-retro-patterns/
rg --files .pfdsl/bindings/pfd-retro-patterns/
```

新しい観察は既存の関連事例へ追記でき、独立した事例なら同じ置き場へ保存する。観測した入力・結果、当時の版や条件、証拠、原因の仮説、未解決事項を区別して書く。コミットされなかった失敗は Git 履歴から復元できないため、その場の実物や安全に共有できる抜粋を残す。private な証拠の公開には別途承認が必要である。
採用した対策は効く時点の既存手順へ反映し、その対策が今回の条件に適用できるかをそこで確認する。対策の候補・当時の判断は事例に残せるが、現行規約として再配信しない。書式やタグの統一だけを目的に事例を直さない。

運用責任の終了と事例の保存を分ける。権限を持つ所有者は、機械化、移管先での責任と到達の確認、原因の消滅、代替規則、費用判断を根拠として現行の責任を終了できる。単に古い・しばらく再発しないことを終了の証拠にしない。終了理由と残る未解決事項を既存の判断記録に残し、事例本文を削除する必要はない。

## 日常の適用点

委譲と変更前後の報告は `.claude/skills/pfd-ops/references/work-cycle.md` 手順2、最終レビューは同手順3と `.pfdsl/workflow.md`「Codex でのレビュー」が持つ。事例を引かなくても、今回の入力・実物・期待結果が渡ることを確認する。
毎サイクルの retro は同 reference の「定期監査」と手順5が持つ。repo-local の `scripts/pre-commit` は `scripts/lib/retro-reminder-check.mjs` で staged roadmap の done 追加を通知する。この通知は commit 前の補助であり、done のないサイクル終結や `--no-verify`、配布先の commit を見ない。
変更した事例も通常の最終差分レビューで根拠・観測と推論・現在の手順との区別を確認する。カタログ全体の現行性や対策抽出の意味を維持する専用レビュー・release gate は持たない。

## 配布物への finding 反映

誰が配布層を編集できるかの一般ルールは pfd-retro SKILL.md「出力」節の「上流変更ルール」が一次情報（ADR-0028）。
このリポは pfd-* bundle の上流であるため、そのルールの「自リポが上流である場合」に当たり、配布物への finding 反映をその場での編集として実施してよい（採用リポにこの経路は無い）。
配布スキル本文（SKILL.md）に取り込めるのは L1 に一般化できる記述のみ。
昇格の可否基準・スキル間相互参照の可否・一般化できない具体例の置き場は `pfd-ops/references/architecture.md` が一次情報。
