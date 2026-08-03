---
name: spec-history-finalize
description: |
  Use before a release, or when `scripts/check-spec-history.mjs` /
  `make release` refuses because docs/spec/spec-history.md's top entry
  doesn't document docs/spec/spec.md's current version. Rewrites the top of
  spec-history.md so its newest entry matches the canonical heading format
  and targets the version that's actually about to ship — consolidating
  several intermediate version-bump entries into one if spec.md was bumped
  more than once since the last release. Not a per-commit step: an entry
  written during maintain_spec's integrate phase (the normal case) needs no
  rewriting here — this is for closing the gap when that didn't happen, or
  when several integrate steps landed since the last release.
---

# spec-history.md の release 前仕上げ

`docs/spec/spec-history.md` の先頭エントリを、これからリリースされる実バージョンに対して
正しい形式で揃える。形式の一次情報は `docs/spec/spec-history.md` 自身の冒頭注記。

## いつ要るか

通常は `maintain_spec`（統合フェーズ）でタイトル行 bump と同じ作業の中でエントリを書くので、
release 時点で直すことは無い（`.pfdsl/workflow.md` の spec バージョンの権威節を参照）。
このスキルが要るのは次のいずれか:

- エントリを書き忘れた（`check-spec-history.mjs` が先頭エントリのバージョン不一致・見出し不一致で fail）
- 直近のリリース以降に spec.md が複数回 bump された（v0.0.16→17→18 のように統合が複数回走った）ため、先頭に複数の中間エントリが並んでおり、実際に出荷される版1つに対してまとめ直す必要がある

## 手順

### 1. 現行バージョンと直近リリース時点のバージョンを出す

```sh
# これからリリースされる版（spec.md のタイトル行）
head -1 docs/spec/spec.md

# 直近の CLI リリースタグ（spec.md は CLI リリースのたびに配布 bundle へ焼き込まれる —
# 「リリース済み」の実体的な境界はこのタグ）
git describe --tags --match 'v*' --abbrev=0

# そのタグ時点で spec.md が名乗っていたバージョン（= 直近リリースで実際に配布された版）
git show "$(git describe --tags --match 'v*' --abbrev=0)":docs/spec/spec.md | head -1
```

### 2. 対象範囲を特定する

`docs/spec/spec-history.md` の先頭から、直近リリース時点のバージョン（手順1の3つ目）に一致する
エントリが現れるまでが今回まとめ直す対象。1エントリしかなければ手順3は形式チェックのみでよい。

### 3. 先頭エントリを1つにまとめ直す

対象エントリ群を、次の形式の単一エントリに書き換える:

```
vLAST_RELEASED からの主な変更点（vCURRENT）：<一文要約>

* <変更点1>
* <変更点2>
...
```

- `vLAST_RELEASED` は手順1で読んだ直近リリース版、`vCURRENT` は spec.md の現行タイトル行と完全一致させる
- 各中間エントリの実質的な変更点（破壊的変更フラグ・issue 番号・設計判断の一文要約）は落とさず引き継ぐ。中間エントリ自体は削除する — それらは実際に外部へ出荷されたことのない中間状態であり、歴史的記録として残す理由がない（v0.0.1 以前の旧形式エントリと違い、これは一度も公開されていない）
- 一文要約は「何が変わったか」であって「どの issue で」ではない。issue 番号は本文中の `（#NNN）` で添える

### 4. 検査する

```sh
node scripts/check-spec-history.mjs
```

`exit 0` になるまで先頭エントリの見出し・バージョンを直す。
