# `scripts/skill-template/` は pfdsl スキルの一次ソース

`generated/skills/pfdsl/` は `make gen-skill`（`scripts/gen-skill.mjs`）が生成する。**生成先を直接編集しない。**
`.claude/skills/pfdsl` は生成先への symlink であり（#714）、ブランチ切替時の同期は git が担う。そちらを開いて編集することは生成先を編集することと同じ。

| 編集したい内容 | 一次ソース |
|---|---|
| スキル本文（品質ガイド以外） | `scripts/skill-template/SKILL.md` |
| 品質ガイド | `docs/quality-guide.md` |
| 仕様書（spec） | `docs/spec/spec.md` |
| レビュー観点 | `docs/review-perspectives.md` |
| サンプル | `docs/samples/*.pfdsl` |
| examples（`references/examples.md`） | `docs/examples/*.pfdsl`（index の要約も本文も frontmatter の `title:` / `description:` 由来） |

編集後は `make gen-plugin` を実行し、生成された `generated/skills/pfdsl` と配布先の harness copies を同じコミットに含める。
