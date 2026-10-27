---
name: pfd-knowledge-audit
summary: PFD knowledge artifact audit
description: |
  Use when auditing the lifecycle of knowledge artifacts produced by PFD
  operations, such as criteria, companions and decision records. Applies
  only to targets explicitly adopted through knowledgeLifecycleAudit in
  .pfdsl/config.json. This optional companion capability is separate from
  model retrospective and general document management.
---
<!-- DO NOT EDIT. Authoritative source: scripts/harness-template/skills/pfd-knowledge-audit/SKILL.md. -->

# PFD knowledge artifact audit

PFD 運用が生む知識成果物を点検する付属機能である。
同じ plugin に同梱されるが、model retro から自動実行しない。
一般の文書管理へ対象を広げず、実行時点は採用先が決める。

## 適用単位

`.pfdsl/config.json` の `knowledgeLifecycleAudit` だけを採用宣言とする。
この SKILL.md から相対で同梱の `scripts/classify-knowledge-lifecycle.mjs` を解決し、監査する採用リポのルートを引数として実行する。

```bash
node <skill-directory>/scripts/classify-knowledge-lifecycle.mjs <repository-root>
```

分類器は config と、旧宣言の警告に必要な `.pfdsl/bindings/pfd-retro.md` を読む。
旧 binding の散文を宣言や実行手順として採用することはない。
実行・読取・JSON 取得に失敗したら、その失敗を報告して監査を止め、分類結果を推測しない。

`state` が `adopt` のときだけ `references/knowledge-lifecycle.md` を読み、`auditTargets` の成果物を監査する。
それ以外の state では監査せず、`reportRequired` が true なら `reports` の不備・移行警告を毎回報告する。
`decline` でも旧宣言の移行警告は消さない。
不足した対象を所在・散文・将来の予定から補わない。

宣言は `{"mode": "adopt" | "decline", "targets": [...]}` の形である。
`adopt` の targets は成果物を名指す非空の文字列配列で、空文字列と空白だけの要素は不正とする。
有効な対象の文字列は変更しない。
`decline` は targets を無視する。
設定が無い、JSON や宣言が不正な場合も黙って省略せず分類結果を報告する。

## 監査と出力

対象の版と利用される経路を確認し、reference の観点を適用する。
`.pfdsl/bindings/pfd-knowledge-audit.md` が示す対象固有の観点がある場合も、宣言した targets の範囲に限る。
1回の監査の実行管理や記録の形式を、このスキルから読み込んだり定めたりしない。

finding は対象成果物と版、観測した不整合、根拠、改訂候補を示す。
所見がない場合も照合した対象と証拠を示し、取得できない情報は未確認として区別する。
改訂・廃止の手順そのものを定めず、採用先の所有者へ判断材料を渡す。
この付属機能への項目追加は中核への昇格ではなく、所有者の新しい決定を要する。
