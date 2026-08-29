---
tags: [method:count]
---

- **存在量化の集約が部分欠落を隠す trap**: 全要素を検査すべき単位を `some` や代表要素で畳むと、1要素だけが条件を満たした単位を全体の成功として扱い、残りの欠落を結果から消す。
  問いの形: 「この単位の判定は、1要素の成立で足りるのか、それとも全要素の成立が必要か。全要素を検査すべき入力に存在量化を選んでいないか」。
  具体例: PR #1036 のレビューサイクルで revision baseline の欠落を調べる際、`graph edges --json` の出力を `artifacts.some((artifact) => feedback.has(...))` で集計した。`map_deps` は `[roadmap_md, roadmap_pfdsl]` の2出力を持ち、`roadmap_pfdsl` にだけ baseline があったため、`roadmap_md` の欠落が消えた。5 process と報告したが、全出力を個別に測ると7 process、9 artifact だった。PR #1036 は Validation 12 に複数出力の全件検査を追加して機構化した（#1037 でカタログへ統合）。
  対策: `all` / `each` を要求する判定では、複数要素のうち1つだけを成立させる反例を検査へ入れ、残りの不成立が結果に残ることを確認する。
