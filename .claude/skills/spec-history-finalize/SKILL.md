---
name: spec-history-finalize
description: |
  Use when `scripts/check-spec-history.mjs` / `make release` refuses because
  docs/spec/spec-history.md's top entry doesn't document docs/spec/spec.md's
  current title-line version. Writes the missing entry, in the canonical
  format, for the version that's actually current. Not a per-commit step: an
  entry written during maintain_spec's integrate phase (the normal case)
  needs no help from this skill — this is only for closing the gap after
  that step was skipped.
---

# spec-history.md の欠落エントリを埋める

`docs/spec/spec-history.md` の先頭エントリが `docs/spec/spec.md` の現行タイトル行と一致しない場合に、欠けているエントリを書き足す。形式の一次情報は `docs/spec/spec-history.md` 自身の冒頭注記。

## 前提

エントリは本来 maintain_spec（統合フェーズ）でタイトル行 bump と同じ作業の中で書く（`.pfdsl/workflow.md` の spec バージョンの権威節）。それが守られていれば `check-spec-history.mjs` は release 時点で必ず通り、このスキルの出番はない。
このスキルが要るのは、その場で書き忘れたケースのみ。

**既存エントリを結合・削除しない。** 各バージョンは spec.md が実際にそのバージョンを名乗っていた期間の記録であり、CLI リリースへ独立に出荷されたかどうかとは無関係に1バージョン1エントリで永続する（通常の CHANGELOG と同じ考え方）。過去のエントリを「実質同じリリースに含まれるから」といった理由でまとめたり消したりしない。

## 手順

### 1. 欠けている範囲を特定する

```sh
head -1 docs/spec/spec.md                 # 現行タイトル行のバージョン
head -20 docs/spec/spec-history.md        # 先頭エントリが指す vNEW と比較
```

先頭エントリの `vNEW` が現行バージョンより古ければ、その間の各バージョンごとにエントリが1つずつ欠けている可能性がある。`git log -p -- docs/spec/spec.md` でタイトル行が実際に何回 bump されたかを確認する。

### 2. 欠けている各バージョンのエントリを書く

bump が複数回あった場合は、1 bump = 1 エントリで、それぞれ次の形式で先頭に追加する（新しい順、既存の先頭エントリより上）:

```
vOLD からの主な変更点（vNEW）：<一文要約>

* <変更点1>
* <変更点2>
...
```

内容は該当コミットの diff（`git log -p -- docs/spec/spec.md`）と、その bump が消費した `spec_proposals`（`.pfdsl/spec_proposals/` 等、統合済みなら roadmap の履歴から辿る）から復元する。破壊的変更フラグ・issue 番号は本文中の `（#NNN）` で添える。

### 3. 検査する

```sh
node scripts/check-spec-history.mjs
```

`exit 0` になるまで先頭エントリの見出し・バージョンを直す。
