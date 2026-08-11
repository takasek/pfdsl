---
tags: [method:sweep]
---

- **対策の適用漏れ（trap を1箇所だけ直す）**: trap を検出して対策の道具まで作っても、同じ形をした他の箇所を横断で掃かなければ、道具の存在が「もう安全だ」という誤った完了感だけを残す。
  パターンが binding に記録済みであることは、そのパターンが残っていないことを意味しない — 記録は再発時の**診断**を速くするが、既存箇所の**掃き出し**は別作業である。
  問いの形: 「この trap の対策を入れたとき、同じ判定を書いている他の箇所を grep したか。道具を作って終わりにしていないか」。
  具体例: 「検査の自己参照 trap」への対策として `scripts/lib/dist-freshness.mjs` を導入した際（#452、2026-07-11）、pre-commit の `check_drift` だけを鮮度判定に切り替えた。同じ `existsSync(dist)` だけを条件にしていた `packages/cli/src/cli-smoke.test.ts`（2026-06-12 から存在）は掃かれず、stale な bundle に対して緑を返し続けた（PR #579 で修正）。
  同じ trap は3巡目にも起きた。stale な dist を読む操作そのものへ警告を出す `scripts/lib/stale-dist-guard.mjs`（#647、2026-07-29）を導入した際も、対象は `typecheck`/`vitest`/`node --test` 等の import 解決経路に限られ、`.pfdsl/bindings/pfd-ops.md`「CLI はこのリポでは常にローカルビルドを叩く」が義務付ける `node packages/cli/dist/cli.js` の直接実行は検知対象から漏れた。#672 のサイクル（PR #826）で stale dist のまま `graph stats`/`meta get`/`check`/`fmt` を10回以上実行し警告ゼロだった実測を経て、#827 で `TRUSTS_BUILD_OUTPUT` に直接実行パターンを追加した。
  対策: trap の対策を入れる PR では、置き換える前の判定式（この例では `existsSync` と dist パスの組、あるいは `TRUSTS_BUILD_OUTPUT` の正規表現）でリポジトリ全体を grep し、ヒットした全箇所の採否をその PR 内で決める。掃かない箇所があるなら理由を残す。
