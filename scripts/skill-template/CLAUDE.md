# `.claude/skills/pfdsl/` は生成物

`.claude/skills/pfdsl/` は `make gen-skill`（`scripts/gen-skill.mjs`）で自動生成される。**その配下を直接編集しない。**
このガード文の一次ソースは `scripts/skill-template/CLAUDE.md` であり、そちらは編集してよい（生成先へバイト同一でコピーされるため、どちらの場所で読んでも同じ本文になる。宛先を「このディレクトリ」と書かずパスで名指しするのはそのため）。

| 編集したい内容 | 一次ソース |
|---|---|
| スキル本文（品質ガイド以外） | `scripts/skill-template/SKILL.md` |
| 品質ガイド | `docs/quality-guide.md` |
| 仕様書（spec） | `docs/spec/spec.md` |
| レビュー観点 | `docs/review-perspectives.md` |
| サンプル | `docs/samples/*.pfdsl` |
| examples（`references/examples.md`） | `docs/examples/*.pfdsl`（index の要約も本文も frontmatter の `title:` / `description:` 由来） |

編集後は `make gen-skill` を実行する。`.claude/skills/pfdsl` は gitignore 対象のローカル作業コピーのため commit 不要。marketplace 配布用コピー `plugin/pfdsl/skills/pfdsl` は `make gen-plugin` で再生成し、そちらは commit する。
