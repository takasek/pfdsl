# #1208 R6b: 配布バンドルのローカル読取確認

対象版は `b3fdd6482bf5e4b3ce38e531c65d82af9f775fbc`（2026-09-26 の `origin/main`）である。
この記録は R6b のうち、外部認証を要しない D 層の採用判断と #1227 の両 backend の参照経路だけを扱う。
実際の採用リポでの作業サイクルや Claude Code Remote の操作は実施していない。

## D 層の3条件

会話を継承しない別 agent に Codex 配布バンドルの `pfd-retro/SKILL.md` と `references/knowledge-lifecycle.md` だけを読ませ、次の採用側 binding の3条件を与えた。
配布本文は採用宣言を必要条件とし、宣言があっても対象の列挙がなければ欠落を報告して D 層を適用しないと明記する。

| 与えた採用側 binding の内容 | agent の読取結果 | 対象 |
|---|---|---|
| 見出しと `対象: docs/decisions/*.md` はあるが採用宣言なし | D 層を適用しない | なし |
| `知識成果物ライフサイクル監査: 採用する。対象: docs/decisions/*.md` | D 層を適用する | `docs/decisions/*.md` のみ |
| 採用宣言あり、対象列挙なし | 列挙不足を報告して D 層を適用しない | なし |

3条件とも `## 知識成果物ライフサイクル監査` の見出しを持つ。
第1条件には `対象: docs/decisions/*.md` の行を与え、第3条件には `知識成果物ライフサイクル監査: 採用する` の行だけを与えた。
agent は、第1条件の見出しと対象行は採用宣言の代わりにならず、第3条件では対象を推測しないと報告した。
この確認は配布文面から条件分岐を再現したもので、実在する採用側 binding の内容や監査の実行結果を証明しない。
対象列挙の文法と実在ファイルへの解決を機械的に検証した結果でもない。

## 両 backend の参照経路

ビルド済み CLI の `meta get` で `workflow.pfdsl` の `ops_skill_l3.location` が GitHub Issues とファイルベースの両 reference を指すことを確認した。
同じ版の `meta check-links .pfdsl/workflow.pfdsl` は `All location paths exist.` を返した。
`check-distributed-prose.mjs` は50ファイルの検査を通過した。
これらは #1227 の両 path の正準参照先の実在と、正準配布文面の静的検査の証拠である。
配布コピーとの同一性や、どちらの backend の採用側サイクルが成立するかの証拠ではない。

## 残る受入

#1208 の R6b には、GitHub/file-based の実際の採用側完了契約、昇格判断、binding の全工程、直読み・plugin root・scaffold の入口、R1 の故障例、Remote の通常 GitHub 操作、最終版の統合整合が残る。
PR #1255 の R4 文書整理はこの対象版に含まれず、レビュー待ちである。
配布内容に関係する変更が main に揃った後、その変更で失効した証拠を選んで再確認する。
