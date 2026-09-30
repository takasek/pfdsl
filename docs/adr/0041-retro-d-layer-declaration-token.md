# ADR-0041: pfd-retro D 層の採用宣言を3値の構造化宣言にし、宣言が無い状態を報告する

- Status: Accepted（同日、宣言の置き場所を binding の行から `.pfdsl/config.json` へ移して改訂。置き場所の原則は ADR-0042）
- Date: 2026-09-30

## Context

ADR-0039 は、pfd-retro D 層（知識成果物のライフサイクル監査）を選択項目にした。
`.pfdsl/bindings/pfd-retro.md` に `知識成果物ライフサイクル監査: 採用する` の行があるときだけ監査し、行が無ければ監査しない、という決定である。

#1275 が、この宣言の形に2つの問題を示した。

- 宣言は日本語のキーと日本語の値だった。行の一致を機械や別の書き手が取るには表記の揺れが大きく、宣言として通用する形が散文から読み取れなかった。
- 値が「採用する」の1値だったので、宣言を知らない旧版の採用先（キーが無い）と、選んだうえで採用しない採用先（キーが無い）を区別できなかった。旧版から更新した採用先は、D 層が止まったことを何の通知もなく迎える。

ADR-0039 の決定、つまり D 層を選択項目にすることは問題ではない。
問題は、採用先が選ぶ機会を得ないまま既定値だけが変わることだった。

同日の最初の版は、宣言を binding の ASCII の1行（`knowledge-lifecycle-audit: adopt` / `decline`）にした。
公開前の distribution review（`docs/distribution-review/2026-09-30-diff.md`）で、採用側の読み手は binding の散文のどれが「監査対象の明示」に当たるかで迷った。
同じ日に、機械が読む採用先の宣言を `.pfdsl/config.json` に置くことが決まった（ADR-0042）。
その版は未公開で、採用先に届いていなかったため、同日の設計続行として本文を改めた。

## Decision

宣言を、採用先の `.pfdsl/config.json` のキー `knowledgeLifecycleAudit` に置く。

```json
{"knowledgeLifecycleAudit": {"mode": "adopt", "targets": ["docs/adr/", "the criteria of .pfdsl/roadmap.pfdsl"]}}
```

- `mode` は `adopt` か `decline` の2値である。
- `adopt` のときは `targets` に監査対象を名指す文字列を1つ以上並べ、`references/knowledge-lifecycle.md` を読んでそれらだけを監査する。`targets` はパスに限らず、ファイルの一部を指す限定を含んでよい。配列に載っていることが監査対象の明示であり、binding の散文から対象を補わない。
- `decline` のときは監査せず、報告もしない。
- ファイルが無い、JSON として読めない、キーが無い、`mode` が不正、`adopt` なのに `targets` が無いか空か文字列でない要素を含む、のいずれかなら監査しない。そのうえで、何が問題で、所有者が宣言する必要があることを毎回報告する。
- binding は宣言を持たず、`.pfdsl/config.json` のキーを指す1文だけを置く。節見出しや散文は宣言の代わりにならない。
- 旧記法（日本語の行、および同日の最初の版の `knowledge-lifecycle-audit:` 行）は宣言として扱わない。見つかった場合は、宣言が `.pfdsl/config.json` へ移ったことを報告する。
- scaffold は `.pfdsl/config.json` に `{"knowledgeLifecycleAudit": {"mode": "decline"}}` を置く。

これは版別の移行検出ではなく、恒久の仕様規則である。
宣言が無い状態を毎回報告するので、旧版の採用先が宣言を知らないまま D 層が止まる状況は、更新後の最初の retro で所有者に届く。
版ごとの手順は `docs/migration-guide.md` が持ち、この規則はそれに依存しない。

ADR-0039 の決定は変えない。変えるのは宣言の置き場所と形、値の明示、宣言が無い状態の報告だけである。
ADR-0039 の本文は書き換えず、Status 行から本 ADR を指す。

## 検討した対案

**日本語のキーを保ち、版別の移行検出を追加する。**
`plugin-version-check.mjs` 等で旧記法や D 層の見出しを検出して知らせる案である。
検出は版ごとに作り直す必要があり、検出器が追随を止めた後に同じ問題が再発する。宣言の側を恒久の規則にすれば、検出器なしで同じ状態が毎回報告される。採らない。

**binding の ASCII の1行に置く（同日の最初の版）。**
新しいファイルの種類を増やさずに済む。
一方で、監査対象は binding の散文として書くことになり、どの文が対象の明示に当たるかを読み手が判断する必要が残った。
値を機械的に検証できず、宣言の置き場所も ADR-0042 の `.pfdsl/config.json` と二重になる。改訂で採らなかった。

**2値のまま、宣言が無い状態も監査しない既定を保つ。**
ADR-0039 の運用そのままだが、#1275 の「選ぶ機会を得ない」問題が残る。採らない。

**宣言が無い状態を `adopt` とみなす。**
旧版の挙動へ戻せるが、ADR-0039 が選択項目にした理由（配布側の保守責務を伴う項目を採用者に強いない）を無効にする。採らない。

## Consequences

宣言は `.pfdsl/config.json` の `knowledgeLifecycleAudit` を見れば見つかる。
SKILL・scaffold・自リポの宣言が同じキーと値を使うことは、`scripts/lib/knowledge-lifecycle-declaration.test.mjs` が検査する。

旧記法を宣言として扱う互換は置かない。旧記法の採用先は、次回の retro で報告を受けて `.pfdsl/config.json` に宣言を書く。
この ADR は品質ガイド（pfdsl スキル）への蒸留を要する規則を含まない。
