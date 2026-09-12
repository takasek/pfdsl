---
tags: [target:check-script, context:stale-tool]
---

> 過去事例（保存基準: 33878aeb）。本文の対策・判断は当時の記録であり、現行の指示ではない。現行手順は [pfd-retro binding](../pfd-retro.md) を参照。

- **古いcheckoutが旧版の検査器を走らせる trap**: ツリー内の検査器をbase追随前に実行すると、旧版に存在しない判定は未発火でなく最初から無かったため、欠けた出力を正常な全結果として受け取る。
  問いの形: 「いま読んでいる出力はどの版のスクリプトが出したものか。`origin/<base>` の版で走らせ直したら同じフィールドと判定が出るか」。
  具体例: 56コミット遅れたcheckoutで `cycle-status.mjs` を実行した回（2026-08-04）。旧版の出力は `designUnsettledFor` を持たず、`gateCheckCommand` も `--issue` を含まなかった。実行者は `gate-check.mjs` を `--issue` なしで回し続け、design-selection record の判定が全サイクル SKIP のままコミット後まで到達した。
  対策: プリフライトは `origin/<base>` を取り込んだツリーで走らせる。または出力に検査器自身の版を含め、base版と照合してから着手する。
