# 資産棚卸しの記録

追記でしか触られない蓄積型カタログを、集合として洗い直した記録を置く。
対象の登録と発火の閾値は `scripts/lib/asset-sweep.mjs` の `SWEEP_TARGETS` が一次情報 — ここには複製しない。

## ファイル

- `<target-id>.json` — 棚卸し済み commit。`{ commit, date, log }` の3フィールドで、形式は `docs/distribution-review/reviewed.json` と同じ
- `<YYYY-MM-DD>-<target-id>.md` — 回ごとの実行記録。何を廃止・統合・修正したか、判定に迷ったが手を付けなかった項目とその理由

記録が**無い**ことは「まだ一度も棚卸ししていない」を意味する。
`scripts/check-asset-sweep.mjs` はその状態を fail-closed で扱い、`make release` を止める。
空のレコードを先回りして置くと、走っていない棚卸しが現行を主張することになる。

## 走らせ方

対象ごとに専用のスキルが手順を持つ。`SWEEP_TARGETS` の各要素の `skill` フィールドがそれを指す。
`node scripts/check-asset-sweep.mjs` が、いまどの対象が閾値を超えているかを印字する。
