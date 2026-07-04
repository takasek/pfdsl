# subflow open input の feedback 除外仕様案 (#298)

## 対象仕様バージョン

v0.0.11 → v0.0.12

## 概要

subflow 境界照合における open input artifact の定義を terminal artifact と対称にし、
「生成元プロセスを持たず、フィードバック（`>>?`）でのみ消費される artifact」を境界照合から除外する。
これにより、フィードバックループに触れるプロセスを `subflow:` で階層化できるようになる。

## 仕様変更

### §2.9.3 open input / terminal の判定

open input artifact の定義を次に改める。

> open input artifact は、生成元プロセス（`->`）を持たず、**かつ通常入力（`>>`）で1回以上消費される** artifact とする。
> 生成元を持たずフィードバック入力（`>>?`）でのみ消費される artifact は横断的な修正ループの要素であり、
> open input ではない（境界に出さない）。terminal 側の「フィードバックのみで消費される artifact は terminal ではない」と対称の規定である。

terminal artifact の定義は変更しない。

### §15.11 境界整合制約

open input の判定を上記の定義に従って行う（checker の照合集合から feedback のみ消費の無生成 artifact が外れる）。

### §16 / 診断コード

新しい error / warning は追加しない。既存の境界不一致 error の判定集合が変わるのみ。

## 理由

v0.0.8 統合時、§2.9.3 は「フィードバック入力は境界整合の対象外」を原則として掲げ、
terminal 側の定義（`>>` でも `>>?` でも消費されない）はこれを反映したが、
open input 側の定義（生成元プロセスを持たない）には対応する除外規定が入らなかった。

この非対称の帰結として、子フローが「外部で生成された成果物を `>>?` で受ける」ことが一切できず、
フィードバックループに触れるプロセスを subflow 化すると「境界不一致 error になるか、
子フローからフィードバック情報を捨てるかの二択」になっていた
（具体例トレースと agent 実書き実験による実証は
`docs/adr/0020-spec-stress-testing/spec-v0011-review.md` F1 /
`docs/adr/0020-spec-stress-testing/subflow-agent-probe.md` 実験A）。

本変更は原則（feedback は階層的 I/O 契約に含めない）に操作的定義を一致させるものであり、
従来 valid だったファイルは引き続き valid（検証の緩和のみ・破壊的変更なし）。

## 影響範囲

- `packages/core/src/multifile.ts` の `computeOpenInputs` — `>>` で消費される無生成 artifact のみを返すよう修正
- `computeTerminals` は変更なし（既に対称の除外を実装済み）
- 従来 error だった「子の feedback 専用 open artifact」構成が pass に変わる（意図した緩和）。
  既存の境界違反検出（余剰 terminal・名前不一致・side 越境・非全単射）には影響しない

## 関連

- issue: https://github.com/takasek/pfdsl/issues/298
- ADR-0020（仕様制約の具体例 stress-test）と付随資料 `docs/adr/0020-spec-stress-testing/`
- 後続: #300（v0.0.11 レビュー残余の編集整備。F19 で本節の規範文の一本化を行う）
