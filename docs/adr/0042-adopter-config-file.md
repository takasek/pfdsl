# ADR-0042: 採用先の宣言の値を `.pfdsl/config.json` に置き、completed-chain sweep を既定で無効にする

- Status: Accepted
- Date: 2026-09-30

## Context

GitHub Issues バックエンドを採用した採用先には、`check-install-sync.mjs --deploy` が `pfdsl-sweep-completed-chains.yml` を配置する。
この workflow は既定ブランチへの push のたびに完了チェーンを回収し、bot の PR を起票する。
移行ガイドは、使うかどうかを commit の前に所有者が判断するよう求めていた。

2026-09-30 の distribution review で、移行ガイドの予行（`docs/distribution-review/2026-09-30-diff.md`）がこの判断を先に取れないことを示した。

- installer には特定のファイルを配置から外す option が無く、workflow は必ず置かれる。
- 配置したファイルは、チームや CI に届かせるには commit するしかない。再配置のたびの「配置ファイルの更新」コミットに workflow が紛れ込み、所有者が選ばないまま有効になる。
- 外すには毎回削除するか commit しないしかなく、manifest には置いていないファイルが残り、次の配置で戻る。

採用先の判断を、再配置で上書きされない場所に、レビューできる形で残す必要があった。
同じ回の probe は、binding の散文で書かれた宣言（pfd-retro D 層の監査対象）がどこまで宣言に当たるかで迷った。

## Decision

採用先の宣言のうち、切り替えや列挙のような値は、採用先のリポジトリの `.pfdsl/config.json` に置く。
このファイルは installer の配置対象に含めず、採用先が git で管理し PR でレビューする。
手順・判断基準・理由のような散文は、従来どおり `.pfdsl/bindings/<スキル名>.md` に置き、値は `.pfdsl/config.json` のキーを指す。
値を置く場所を1つにし、workflow・installer・スクリプトと agent が同じ値を読む。

このファイルに置く最初のキーは次の2つである。

- `sweepCompletedChains`: completed-chain sweep の有効化。`{"enabled": true}` のときだけ、workflow は回収と PR の起票を行う。ファイルやキーが無い、または `enabled` が真偽値の `true` でなければ、checkout の直後に通知を出して何もせず成功で終わる。ファイルが JSON として読めない、または値の型が違う場合は workflow を失敗させ、宣言が壊れたまま回収が黙って止まることを避ける。
- `knowledgeLifecycleAudit`: pfd-retro D 層の採用宣言と監査対象（ADR-0041）。

上流リポ自身も同じ workflow を使うため、`.pfdsl/config.json` で sweep を有効にする。

移行状態（#1319 の設計案。採用先が移行を適用した版の記録）も、実装する際はこのファイルに置く。
キーの名前と形は、その設計の時点で決める（[ADR-0043](0043-applied-migration-state.md) が `appliedMigration` と決めた）。
この ADR は置き場所だけを先に決め、宣言の置き場所が複数できることを防ぐ。

## 検討した対案

- **GitHub の Actions 変数で sweep を有効化する。** 再配置で消えず、checkout の前に判定できる。一方で判断がリポ設定に隠れて履歴もレビューも残らず、手元の installer やスクリプトからは読めない。
- **binding に宣言行を置く（ADR-0041 の同日の最初の版と同じ形）。** 新しいファイルの種類が増えない。一方で workflow が Markdown の行を解釈することになり、値を機械的に検証できない。移行状態のような構造を持つ宣言の置き場所にも向かない。
- **読み手で置き場所を分ける（機械が読む値は config、agent が読む値は binding）。** 当初の案である。agent が読む値も、切り替えや列挙である限り機械的に検証できるほうがよく、置き場所が2つになる理由にならない。改めた。
- **installer に配置から外す option を足す。** 判断が採用先に残らず、再配置を実行する人ごとに option を覚えておく必要がある。
- **sweep workflow を配置しない既定にする。** 使いたい採用先に別の手順が要り、配置物と manifest の対応が採用先ごとに分かれる。

## Consequences

- sweep は、`.pfdsl/config.json` で有効にした採用先でだけ動く。無効の間は、push のたびに workflow の通知として現れる。移行ガイドの Unreleased 節に項目を置く。
- `.pfdsl/` 配下に `.pfdsl` でも companion でもないファイルが置かれる。`.pfdsl/` の配下を一律に PFD や companion とみなす処理が無いことを、導入時に確かめた（どの処理も拡張子かパターンで絞っている）。
- 作業項目バックエンドの採用の有無など、値として持つべき宣言が今後現れたときの置き場所は、このファイルになる。
