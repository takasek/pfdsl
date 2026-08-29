---
tags: [method:sweep, context:parallel-work]
---

- **対策の適用漏れ（trap を1箇所だけ直す）**: trap を検出して対策の道具まで作っても、同じ形をした他の箇所を横断で掃かなければ、道具の存在が「もう安全だ」という誤った完了感だけを残す。
  パターンが binding に記録済みであることは、そのパターンが残っていないことを意味しない — 記録は再発時の**診断**を速くするが、既存箇所の**掃き出し**は別作業である。
  問いの形: 「この trap の対策を入れたとき、同じ判定を書いている他の箇所を grep したか。道具を作って終わりにしていないか」。
  具体例: 「検査の自己参照 trap」への対策として `scripts/lib/dist-freshness.mjs` を導入した際（#452、2026-07-11）、pre-commit の `check_drift` だけを鮮度判定に切り替えた。同じ `existsSync(dist)` だけを条件にしていた `packages/cli/src/cli-smoke.test.ts`（2026-06-12 から存在）は掃かれず、stale な bundle に対して緑を返し続けた（PR #579 で修正）。
  同じ trap は3巡目にも起きた。stale な dist を読む操作そのものへ警告を出す `scripts/lib/stale-dist-guard.mjs`（#647、2026-07-29）を導入した際も、対象は `typecheck`/`vitest`/`node --test` 等の import 解決経路に限られ、`.pfdsl/bindings/pfd-ops.md`「CLI はこのリポでは常にローカルビルドを叩く」が義務付ける `node packages/cli/dist/cli.js` の直接実行は検知対象から漏れた。#672 のサイクル（PR #826）で stale dist のまま `graph stats`/`meta get`/`check`/`fmt` を10回以上実行し警告ゼロだった実測を経て、#827 で `TRUSTS_BUILD_OUTPUT` に直接実行パターンを追加した。
  対策: trap の対策を入れる PR では、置き換える前の判定式（この例では `existsSync` と dist パスの組、あるいは `TRUSTS_BUILD_OUTPUT` の正規表現）でリポジトリ全体を grep し、ヒットした全箇所の採否をその PR 内で決める。掃かない箇所があるなら理由を残す。

  **集約関数が、1単位の内部に残る部分欠落を消すこともある。** 対策対象を全件列挙していても、複数要素を持つ各単位を `some` で畳むと、要素が1つ直っているだけで単位全体が「対応済み」になる。
  問いの形の追加: 「全要素を検査する必要がある単位を、`some` や先頭要素で代表させていないか。1要素だけ条件を満たす入力を構成したとき、残りの欠落は出力に残るか」。
  具体例: PR #1036 のレビューサイクルで revision baseline の欠落を調べる際、`graph edges --json` の出力を `artifacts.some((artifact) => feedback.has(...))` で集計した。`map_deps` は `[roadmap_md, roadmap_pfdsl]` の2出力を持ち、`roadmap_pfdsl` にだけ baseline があったため、`roadmap_md` の欠落が消えた。5プロセスと報告したが、全出力を個別に測ると7プロセス9 artifact だった。PR #1036 は Validation 12 に複数出力の全件検査を追加して機構化した（#1037 でカタログへ統合）。

  **掃く主体が2つ並行して走ると、掃き漏れは互いのスコープの隙間に落ちる。** 同じ主題（例: edge 集合からのグルーピング）を扱う複数の並行 issue/PR は、各々が自分のスコープ内でしか重複を見ないため、相手側のリファクタが通った後も残った同型に誰も気付かない。単独作業の掃き漏れと違い、grep の範囲を広げても相手の変更がまだツリーに無ければ見えない。
  問いの形の追加: 「このリファクタが対象にしなかった箇所に、同種のループ/パターンがもう一方の並行リファクタの後にも残っていないか」。
  検出の機会: 2つの並行ブランチを rebase/merge で合流させるとき。コンフリクトした箇所だけでなく、双方の diff で「同じ処理を別名の変数で書いている箇所」を横断 grep する。
  具体例: `computeOpenInputs`（multifile.ts）に externalInputs 計算を委譲するリファクタと、edges グルーピングを共有ヘルパーに統合するリファクタが並行して走り、audit.ts 内の produced/consumed Set 構築（前者の対象外）が後者のヘルパーからも漏れて残った（takasek/pfdsl #460）。
