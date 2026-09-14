---
tags: [target:check-script, context:stale-tool, context:parallel-work]
---

> 過去事例（保存基準: 33878aeb）。本文の対策・判断は当時の記録であり、現行の指示ではない。現行手順は [pfd-retro binding](../pfd-retro.md) を参照。

- **作業中のbase進行が終盤の検査器を古くする trap**: 着手時に最新だったツリーでも作業中にbaseが進むと、終盤ほど古い検査器へ依存し、本文の現行契約と旧版出力の食い違いを実データの異常と誤認する。
  問いの形: 「本文の記述と食い違うこの出力は対象の異常か、それとも本文がまだ来ていない版の挙動か。検査直前にもbase追随を確認したか」。
  具体例: retro の A・B 層で `graph orphans` が group 7件を報告した回（2026-08-04）。本文の「group は配線済みとして扱われる」と矛盾した原因は、base が作業中に4コミット進み #676 の修正を含んだことだった。rebaseして再ビルドすると3図とも `(none)` になった。
  具体例: base が44コミット進み、その中に `.pfdsl/runtime-pipeline.pfdsl` を `pipeline.pfdsl` へ改名する破壊的変更が含まれていた回（2026-08-30）。ブランチ上の検査はすべて緑のまま終盤まで進み、`gate-check.mjs` が `fatal: path '.pfdsl/runtime-pipeline.pfdsl' exists on disk, but not in 'origin/main'` を出して初めて露見した。このとき古かったのは検査器でなく**変更対象の名前**であり、rebase 後に散文の `runtime_pipeline_pfdsl` 参照が解決先を失った。出力と本文の食い違いを探す形では気付けず、base 側の rename が自分の触った識別子に当たったかを見て初めて分かる。
  観測（2026-09-14、retro 実行 `retro-2026-09-14-adv406bf2`）: 同じ症状が、ツリーが最新のまま出た。`pfdsl graph orphans .pfdsl/workflow.pfdsl` が group 6件を報告し、`.pfdsl/pipeline.pfdsl` は `error [V031]: Invalid type 'pipeline'. Allowed: roadmap, workflow, runtime-pipeline` を返した。
  `which pfdsl` は `/opt/homebrew/bin/pfdsl` を指し `--version` は `0.0.25`、in-tree の `node packages/cli/dist/cli.js --version` は `0.0.26` で、後者では3図とも `(none)` だった。
  上の2件と違い base は進んでおらず、古いのは PATH 上のバイナリである。したがって `git log HEAD..origin/<base>` は進行なしを返し、この形を捕まえない。
  原因の仮説: リポが CLI 自体を開発しているため、コマンド名がリリース版と in-tree 版の両方に存在し、`which` はリリース版を選ぶ。仮説であって、他のコマンド名で同じことが起きるかは確かめていない。
  失敗の見え方が2つに割れる点が観測できる。型を知らない図では `error` で止まるが、型を知る図では**もっともらしい finding を返して黙る** — group ノードは配線漏れに見えるため、出力だけからは偽と判定できない。
  未解決: 配布層の pfd-retro SKILL.md は `graph orphans <file>` とだけ書き、どのバイナリで実行するかを固定していない。この観察を規約へ反映するかは別途起票して判断する。
  対策: 終盤の監査へ入る時点で `git log HEAD..origin/<base>` により進行を確認する。進行があった場合、rebase 後に自分が書いた識別子・パスが base 側の rename で失効していないかを grep で確かめる（検査が緑であることは、散文中の参照の生存を意味しない）。道具の出力と本文が食い違ったら、対象を調べる前に実行した検査器とbase版を比較する。
