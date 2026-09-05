---
name: pfd-ops
summary: project operations
description: |
  Use when operating a project that has adopted PFDs — prioritizing or
  accepting work items, updating progress status after completing work,
  adding new artifacts or documents to the repo, or deciding where session
  learnings should be recorded. Also use when the user explicitly asks for a
  PFD operation. Complements the pfdsl skill (notation and quality of .pfdsl
  files); this skill covers how to run the project on top of them.
---
<!-- DO NOT EDIT. Authoritative source: .claude/skills/pfd-ops/SKILL.md. -->

# PFD-driven project operations

記法・品質ガイドは pfdsl スキル。本スキルは発火直後に必要な契約と既存 reference へのルーティングだけを持つ。リポ固有のバインディングは各 `.pfdsl` の sibling `.md` companion・`.pfdsl/bindings/<スキル名>.md`・references に置く。

## 適用単位

pfd-ops は、操作に対応する採用済み PFD ごとに適用する。対象の PFD が存在しない、または scaffold のままであれば、その操作だけを非適用として呼び出し元の通常フローへ戻し、ほかの PFD を使う操作は継続する。`.pfdsl/roadmap.pfdsl` が存在しなくても、実データの `.pfdsl/workflow.pfdsl` があれば知見の振り分けなど workflow の操作を実行できる。ユーザーが明示的に PFD の導入または既存 scaffold の実データ化を依頼した場合に限り、pfd-ecosystem スキル（`/pfd-init`）を案内する。

## 発火時の必須セルフチェック

スキル発火時に一度、配置形態に応じたパスで `check-install-sync.mjs --upstream` を実行する。plugin 経由では次を使い、変数が置換されていなければ repo-local の `.agents/skills/pfd-ops/scripts/check-install-sync.mjs`、それも無ければ現在読んでいるこのファイルの所在から相対で解決する。警告への対応、deploy flag、rename、version と bundle の差分は `references/architecture.md` の「配置ファイルの鮮度セルフチェック」に従う。

```bash
node ${PLUGIN_ROOT}/skills/pfd-ops/scripts/check-install-sync.mjs --upstream
```

同じタイミングで `.pfdsl/bindings/pfd-ops.md` が存在すれば読み、追加のセルフチェック手順があれば実行する。binding はリポ固有の追加自己点検の一次置き場であり、本ファイルは個別スクリプト名を持たない。

## 運用ファイルの所在（L2 ディスパッチ）

各運用 `.pfdsl` を扱うときは同名 sibling `.md` も読み、次の一意な経路で詳細を解決する。

- **閲覧・分類・優先順位**: 採用済み roadmap では `pfdsl status ready <roadmap.pfdsl> --best --json` で着手可能集合と推薦を列挙し、作業項目の分類は roadmap companion が指す採用バックエンドに従う
- **作業項目への着手**: `references/work-cycle.md` の全手順に従う
- **終端ゲート**: `references/work-cycle.md` の終端ゲートに従う
- **知見の振り分け**: `references/work-cycle.md` の運用契約と `.pfdsl/workflow.pfdsl` および sibling companion に従う
- **GitHub Issues の操作**: roadmap companion が採用を宣言している場合だけ `references/github-issues-backend.md` に従う
- **ファイルベースの作業項目操作**: roadmap companion が採用を宣言している場合だけ `references/file-based-tracker-backend.md` に従う
- **変換境界の変更**: `.pfdsl/pipeline.pfdsl` と sibling companion に従う
- **companion と binding の配置判断**: `references/architecture.md` に従う

## References

- 各運用 `.pfdsl` の sibling `.md` companion — リポ固有のバインディングと手続き
- `references/work-cycle.md` — 運用契約とワークサイクル
- `references/architecture.md` — 層構成、配置、鮮度チェックの詳細
- `references/github-issues-backend.md` — GitHub Issues バックエンドのプリセット規約（採用リポのみ）
- `references/file-based-tracker-backend.md` — ファイルベース・トラッカーのプリセット規約（採用リポのみ）
