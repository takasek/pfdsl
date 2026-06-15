# このディレクトリは生成物

`make gen-skill`（`scripts/gen-skill.mjs`）で自動生成される。**直接編集しない。**

| 編集したい内容 | 一次ソース |
|---|---|
| スキル本文（構文・品質ガイド・CLI等） | `scripts/gen-skill.mjs` のテンプレート |
| 仕様書（spec） | `docs/spec/spec.md` |
| レビュープロンプト | `docs/review-prompts.md` |
| サンプル | `docs/samples/*.pfdsl` |

編集後は `make gen-skill` を実行し、生成物ごと commit する。
