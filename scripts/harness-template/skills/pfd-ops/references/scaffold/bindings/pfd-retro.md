# pfd-retro バインディング

A/B/C カタログ（図と仕様の観点）: pfdsl スキルの `references/review-perspectives.md`（plugin なら `{{{pluginRootExpression}}}/skills/pfdsl/references/`、repo-local なら `{{{repoSkillRoot}}}/pfdsl/references/`）。
採用先固有のモデルの具体例は `.pfdsl/review-perspectives.md` に置く。

PFD 採用状況: (採用した種別を列挙する。)

対象モデル・仕様の所在: (モデル監査に必要な固有の参照先があれば記入する。)

知識成果物監査は独立した pfd-knowledge-audit が持つ。
採用と対象は `.pfdsl/config.json` の `knowledgeLifecycleAudit` で宣言する。

## 事例・観察・反例

既存の保存先: `.pfdsl/bindings/pfd-retro-patterns/`。
`sample-pattern.md` は見本であり、最初の事例を保存したら取り除いてよい。
保存・検索・廃止の具体的な運用や、1回の監査の情報源収集・凍結・引継ぎの規律は、採用先の入口から読む手順に置く。
この binding を model retro が実行管理のために呼び出すと仮定しない。
既存の固有な記録は、新しい雛形で上書きしない。
