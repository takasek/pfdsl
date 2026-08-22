---
tags: [target:check-script]
---

- **検査対象を手列挙で指定する trap**: 検査・テストの対象集合をディレクトリやパスの手書きリストで指定すると、対象が増えたときに無言で漏れる。
  漏れた対象は「検査を通っている」のでなく「検査が走っていない」が、出力はどちらも同じ（緑）になる。
  列挙ドリフト（同じリストが2箇所にあって乖離する）と違い、こちらは**照合相手のリストが存在しない** — 比較対象がないので目視でも気付けない。
  問いの形: 「この検査が実際に拾った対象の集合と、リポジトリに実在する対象の集合は一致するか」。列挙を読むのでなく**両方を数えて突き合わせる**。
  具体例: `node --test` の対象が `scripts/lib/` と `scripts/pfdsl/lib/` をディレクトリ名で列挙していたため、`scripts/*.test.mjs` に置いたテスト4件（shell injection のガードを含む）が一度も実行されていなかった。
  対策: 列挙をやめるか、**実在集合との突合を検査に組み込む**。このリポは後者を採り、`scripts/lib/test-glob-coverage.mjs` が Makefile と CI の `node --test` glob を読んで、tracked な `*.test.mjs` に到達しないものを列挙する。
  前者（`"scripts/*.test.mjs" "scripts/**/*.test.mjs"` の2パターン化）も `node --test` 側は成立するが、突合検査があれば列挙のままで安全なので採らなかった。
  具体例の追加: `.github/workflows/check-gen-plugin.yml` は `plugin` と `.claude-plugin/marketplace.json` だけを手列挙していたため、同じ generator が更新する `AGENTS.md`、`.agents`、`.codex` は、pre-commit の `gen-plugin-bulk` gate が対象にしていても CI の drift 検査から漏れていた。repo-local Codex assets が古いままでも CI は緑になった。
  対策の追加: CI の pathspec は workflow parity test で `buildGates({ stagedPresent: [] })` の `gen-plugin-bulk` gate と比較し、別の手書き対象集合を独立に維持しない。dist 依存の `SKILL.md` は CI が build 後に broad `plugin` pathspec で検査するため、pre-commit の除外だけを意図的な差分として扱う。
