# ADR-0007: 既約 `.pfdsl/` ディレクトリ規約

- Status: Accepted
- Date: 2026-06-11

## Context

計画 PFD（作業依存グラフ）と生態系 PFD（成果物の生成元・利用局面）は、どのプロジェクトにも必要な二つの基盤図である。しかし置き場が任意のままでは、運用スキル（pfd-ops）はパスをハードコードするしかなくプロジェクト固有の設定になり、ツールも対象を自動的に発見できない。

現状、本リポジトリでは `docs/issues_flow.pfdsl`・`docs/artifact_ecosystem.pfdsl` という独自パスを使っており、pfd-ops スキルの「このリポジトリの運用ファイル」節もそのパスを明記している。スキルを別プロジェクトへ配布する（#11）際にはこの節を毎回書き換える必要があり、ポータブル化の障壁になっている。

## Decision

既約ディレクトリ `.pfdsl/` を PFD 置き場の規約とする。

- **既約ファイル名**: `roadmap.pfdsl`（計画 PFD）、`ecosystem.pfdsl`（生態系 PFD）
- 追加の `.pfdsl` ファイルはディレクトリ内に自由に併置できる
- 将来のプロジェクト設定（共有プリセット #6）も `.pfdsl/config.yaml` に置く

## Rationale

1. **運用スキルのプロジェクト非依存化**: pfd-ops スキルが「`.pfdsl/roadmap.pfdsl` を読め」と書けるようになり、リポジトリ固有のパスをハードコードする必要がなくなる。これはスキルのプラグイン配布（#11）の前提条件である。

2. **設定置き場問題の同時解決**: #6 で検討している共有プリセット設定の置き場として `.pfdsl/config.yaml` を自然に確保できる。

3. **ツールデフォルトの確立**: 引数なし `pfdsl check` が `.pfdsl/` を検証対象にでき、将来の `pfdsl init` がディレクトリをスキャフォールドすることでコールドスタートが設定不要になる。

4. **隠しディレクトリの許容性**: 隠しディレクトリは tool-config の連想があるが、`.github/` の前例が示すように、既約による発見可能性はドット接頭辞による視認性の損を上回る。

## Consequences

**本リポジトリの移行は2段階**:

- `docs/issues_flow.pfdsl` → `.pfdsl/roadmap.pfdsl` および `docs/artifact_ecosystem.pfdsl` → `.pfdsl/ecosystem.pfdsl` は即座に移行可能。CLAUDE.md と pfd-ops スキルのパス記述を更新し、スキルをプロジェクト非依存化する。
- `docs/pfdsl_implementation_flow.pfdsl` は `Makefile` および `gen-samples` が参照しているため、生成系再構成（#10）と同時に移行する。

移行作業は issue #14 で管理する。

## References

- issue #14
- issue #6（共有プリセット）
- issue #11（配布可能スキル）
- `.claude/skills/pfd-ops/SKILL.md`
