---
tags: [target:check-script, context:stale-tool]
---

- **検査の自己参照 trap**: 「生成器を再実行し出力を既存生成物と diff する」形の drift 検査は、生成器の入力（ビルド成果物・キャッシュ等）自体が古い場合、古い入力から再生成した出力を古い生成物と比較するため一致してしまい、検査が自己無矛盾のまま PASS する。
  問いの形: 「この検査の『再生成』は、検査対象と同じ古い入力を使っていないか」。
  具体例: pre-commit の `check_drift`（regenerate-then-diff 方式）が dist ファイルの**存在**のみを前提条件にしており鮮度を見ていなかったため、worktree に残った stale な CLI dist から `gen-plugin` を再生成すると、stale dist 由来の誤った内容同士が一致して PASS した。CI は fresh checkout から都度ビルドするため唯一そこでだけ drift が検出された（#450）。`scripts/lib/dist-freshness.mjs` で dist の mtime を sibling `src/` の最新 mtime と比較し、存在しないときと同様に古いときも検査を skip する形に修正（#452）。
  対策: 「存在すれば検査可能」でなく「入力より新しければ検査可能」を前提条件にする。
