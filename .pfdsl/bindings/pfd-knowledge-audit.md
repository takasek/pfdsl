# pfd-knowledge-audit バインディング


このリポの D 層の採用と監査対象は、`.pfdsl/config.json` のキー `knowledgeLifecycleAudit` で宣言する。

監査項目の本文はpfd-knowledge-audit の `references/knowledge-lifecycle.md` が持つ。次の観点を宣言済みの対象に限って適用する。

- **効果の実測**: 対策の前後比較を、`.pfdsl/bindings/pfd-ops.md`「このリポの作業規律」の「worktree 上の変更を検証する」が固定した基準・対象版・条件と照合する。取得を逃した基準は比較不能とし、今の値で埋めない。測定後の変更で根拠が崩れた範囲を再確認し、代理指標や構造検査の成功と実運用の効果を区別する

実行管理は root の指示から読む `.pfdsl/bindings/pfd-ops.md`「定期監査の実行」と `.pfdsl/bindings/pfd-retro.md`「1 回の実行契約」に従う。
