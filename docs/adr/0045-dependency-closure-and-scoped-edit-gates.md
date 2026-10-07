# ADR-0045: 依存閉包を共有し、編集の拒否を影響する関係に絞る

- Date: 2026-10-07
- Status: Accepted
- Related: #1397、#1407、#1396

## 判断

依存ファイルの取得・役割・参照診断を core の `loadDependencyClosure` にまとめる。
非同期の editor loader も同じ traversal を使う。
entry・subflow・preset の役割は集合とし、同じファイルの兼任を保持する。
subflow と extends の循環判定は分け、同じ extends 循環へ異なる子図から到達しても診断は一度にする。
表示継承の expanded post-order、precedence、循環時の lenient fallback は変えない。

`check` は依存全体の局所診断・preset の V028・参照診断・入れ子 boundary を検査する。
`rename` / `delete` は同じ閉包から操作に必要な判断材料を選び、全依存の error を一律の書込み拒否条件にしない。
これは所有者の「問題が起こるシナリオがない範囲でできるだけゆるくしてあげたい。シナリオが見つかるなら仕方ない」という方針に従う。

`rename` はローカル結果の error、継承 group との衝突、preset 由来で更新できない child-parent 関係を拒否する。
group の存在を判断できなくなる欠落・解析不能の preset は拒否する。
通常の子図の ID は変更せず、artifact rename は実効 boundary 対応を保持するため、無関係な子図 error は拒否条件にしない。
entry の外部入力・終端が変わる rename/delete は、変更後も到達可能な entry への戻り subflow を検査し、新しい boundary 診断を作る場合だけ拒否する。

`delete` は既存のローカル入力ゲートを保持する。
group または不明 ID の分類では継承 group を調べ、preset-only とローカル override を書込み前に拒否する。
artifact 削除で変わる、生き残った entry process の通常入出力・boundary map だけを変更後に検査する。
その子図が取得・構文解析不能、または変更後の対応が不一致なら拒否する。
削除される process の欠落 subflow、無関係な子図の error、preset の style error / V028 は編集を止めない。

## 比較した案と反例

全コマンドが全依存 error で拒否する案は、検査済み文書だけを編集する前提に立つ。
この前提を外すと、欠落 subflow を持つ process の削除、余分な親入力を削除する boundary 修復、無関係な style error がある preset を使う group 編集が必要になる。
一律拒否はこれらの安全な操作も止めるため採用しない。

診断をコマンドごとに構築する現状維持案は、同じ extends 循環の重複と判定材料の不一致を残すため採用しない。
競合する実装案としてコマンド側の共有 helper も比較したが、editor と CLI の両方が同じ取得規則を必要とするため core の API を採る。
CLI の拒否ポリシーは core の取得規則に埋め込まない。

境界検査を全くしない案は、親 `[a,c] >> p -> b`、子 `[a,c] >> q -> b` から親の `a` だけ削除すると V034 を新設するため採用しない。
自己 subflow `a >> p -> b` の `a` を `a2` へ rename すると、親 map が `{a2: a}` になり、同時に変わる子入力から `a` が消えて V030 を新設する。
子図から entry へ戻る参照も同じ問題を持ち、process 削除が entry の外部入力を変える場合もあるため、操作種別ではなく外部境界の変化から検査を選ぶ。
削除後に到達不能となる子図の戻り参照は対象外とし、循環を除去する process 削除を止めない。
同じ実ファイルへの symlink/hardlink も書込みの影響を受けるため、CLI は dev/ino で entry の別名を識別し、変更後の snapshot で境界を検査する。
group rename の衝突判定だけでは、preset の `child.parent: g` を残したままローカル `g` を `h` へ変えて階層を失う。
その関係をローカル override で更新できる場合は許可し、できない場合だけ拒否する。

## 検証の所在と限界

core の `dependency-closure.test.ts` が読取回数・兼任・混合参照・循環の一意性を固定する。
CLI の `dependency-mutations.test.ts` が安全な編集・境界破損・修復・preset-only の batch 原子性を固定する。
この判断は entry と到達可能な依存に限る。
entry から到達不能な別ファイルの親は既存の one-file command 契約どおり検査・変更せず、呼出側がその親を別途 `check` する。
到達可能な親も書き換えず、新しい境界破損を作る操作を拒否する。
PFD 記法の品質規則を変更していないため、pfdsl スキルへの蒸留は行わない。
