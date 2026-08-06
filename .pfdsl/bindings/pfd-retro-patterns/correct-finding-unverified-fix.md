---
tags: [method:respond-review]
---

- **指摘は正しいが修正案が指摘を解かない trap**: レビュー（`/simplify`・`/code-review`・agent）が返す finding は「診断」と「修正案」の2部からなるが、検証されているのは診断だけであることがある。
  診断が実測付きで正しいと、その正しさが修正案の正しさへ横滑りし、案の側は誰も試さないまま採用される。
  適用しても finding が残ったまま「対応済み」になるため、レビューを回した記録だけが残って穴は塞がらない。
  問いの形: 「この修正案は、指摘が挙げた入力そのもので走らせて確かめたか。診断が正しいことを、案が正しい根拠に使っていないか」。
  具体例: `/simplify` の altitude 角度が「`--force` の pre-check が `--force=value` を取りこぼす」と正しく指摘し（実測付き）、修正案として「`force: { type: "boolean" }` を options に宣言して post-parse で移行メッセージを raise せよ」と書いた。
  実際には boolean 宣言だと strict parse が先に「does not take an argument」で弾くため post-parse に到達せず、移行メッセージは出ない — 提案どおり実装すれば finding はそのまま残っていた（#631 のサイクル。`--force=` 前方一致を pre-check に加える形で解消）。
  対策: finding を採用するときは、案の形でなく **finding が挙げた入力を先にテストへ落とす**（Red を作る）。提案どおりの実装で緑にならなければ、提案でなく finding のほうを信じる。
