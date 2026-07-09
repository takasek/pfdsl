# このディレクトリは生成物

`make gen-skill`（`scripts/gen-skill.mjs`）で自動生成される。**直接編集しない。**

| 編集したい内容 | 一次ソース |
|---|---|
| スキル本文（品質ガイド以外） | `scripts/skill-template/SKILL.md` |
| 品質ガイド | `docs/quality-guide.md` |
| 仕様書（spec） | `docs/spec/spec.md` |
| レビュー観点 | `docs/review-perspectives.md` |
| サンプル | `docs/samples/*.pfdsl` |

編集後は `make gen-skill` を実行する。このディレクトリ（`.claude/skills/pfdsl`）は gitignore 対象のローカル作業コピーのため commit 不要。配布用コピー `skills/pfdsl` のみ commit する。
