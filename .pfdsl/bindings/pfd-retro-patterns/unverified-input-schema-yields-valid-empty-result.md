---
tags: [target:check-script, method:count]
phase: pre-artifact
---

- **未検証の入力 schema が有効な空結果を返す trap**: 入力 contract を確認せず推測した property を読むと、JavaScript の `undefined` や false の経路を通って例外ではなく0件を返すことがある。同じ処理の他の集計が成功すると、出力全体が schema に適合しているように見え、誤信が補強される。
  問いの形: 「この系列が読む property は input contract または実データ1件で確認したか。0件は期待した空集合か、それとも存在しない property を読んだ結果か。同じ処理の他系列の成功を、この系列の正しさへ流用していないか」。
  具体例: PR #1036 のレビューサイクルで `graph edges --json` の edge を `{from, to}` と推測して集計し、`retro_findings edges: 0` を得た。実際のフィールドは `{kind, artifact, process}` であり、実ファイルの grep では22本あった。同じスクリプトの total と feedback 集計は正しく動いていたため、部分的に正しい出力が0件を「該当なし」と読む根拠になりかけた（#1037 で記録）。
  対策: 集計を書く前に input contract と実データ1件の property を照合する。さらに、期待する系列が存在すると分かっている非空 fixture を使い、その系列の結果が非空になる検査を置く。
