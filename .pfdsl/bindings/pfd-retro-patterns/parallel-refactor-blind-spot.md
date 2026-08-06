---
tags: [method:sweep, context:parallel-work]
---

- **並行リファクタの死角**: 同じ主題（例: edge集合からのグルーピング）を扱う複数の並行 issue/PR が、互いのスコープ外に同型の重複コードを残すことがある。各 issue は自分のスコープ内でしか重複を見ないため、相手側のリファクタが通った後も気付かれない。
  問いの形: 「このリファクタが対象にしなかった箇所に、同種のループ/パターンがもう一方の並行リファクタの後にも残っていないか」。
  検出の機会: 2つの並行ブランチを rebase/merge で合流させるとき。コンフリクトした箇所だけでなく、双方の diff で「同じ処理を別名の変数で書いている箇所」を横断 grep する。
  具体例: `computeOpenInputs`（multifile.ts）に externalInputs 計算を委譲するリファクタと、edges グルーピングを共有ヘルパーに統合するリファクタが並行して走り、audit.ts 内の produced/consumed Set 構築（前者の対象外）が後者のヘルパーからも漏れて残った（takasek/pfdsl #460）。
