# ADR-0014: samples は TSV 管理、examples は frontmatter 管理

- Status: Accepted
- Date: 2026-06-15

## Context

`docs/samples/` と `docs/examples/` の2ディレクトリに対し、インデックス生成のためのメタデータ（ID・タイトル・説明）をどこに持つかを決定する必要があった。

issue #10 の P2 実装として当初「両ディレクトリとも frontmatter 駆動」で実装したが、最小サンプルの .pfdsl ファイルが frontmatter を持つことで文書として重くなり、かつ自動生成された Markdown 説明文に YAML クォート文字が混入するという問題が生じた（「最小サンプルなのに重く見えるし、Markdown の自然文になぜかダブルクォーテーションがついている」）。

## Decision

非対称方針を採用する:

- **`docs/samples/`**: メタデータは `samples.tsv` で外部管理。.pfdsl ファイル自体は構文説明の一次表現であり、余分な frontmatter を持たない。
- **`docs/examples/`**: メタデータは各 .pfdsl ファイルの YAML frontmatter（`title:` 等）で管理。realistic domain example は自然にタイトルを持つため frontmatter が馴染む。

## Rationale

`docs/samples/` の存在意義は「特定の構文機能を最小の形で見せる」こと。01-simple-chain のように本体が2〜3行のファイルに frontmatter を加えると本体よりメタデータが大きくなる。また、summary/description の自然文は TSV で書く方が編集しやすく、YAML エスケープ問題も生じない。

`docs/examples/` の存在意義は「現実的なドメイン事例として PFD を見せる」こと。これらは既に複数フィールドを持つ frontmatter を自然に必要とし（`statusStyles:`, `tagStyles:` 等）、`title:` の追加はその延長に過ぎない。

## Consequences

- `gen-skill.mjs` と `gen-samples.mjs` は非対称ロジックを持つ（samples: TSV 読み込み、examples: frontmatter パース）
- samples.tsv に登録されていない .pfdsl ファイルは生成物に現れない — 両スクリプトに reverse-scan 警告を追加して silent omission を検出可能にした
- この非対称性は意図的であり、将来「どちらかに統一しよう」という誘惑に負けないために本 ADR で根拠を恒久化する

## 蒸留判定

品質ガイドへの蒸留は不要 — このルールはツールチェーン実装の制約であり、PFD 作図時の判断には影響しない。
