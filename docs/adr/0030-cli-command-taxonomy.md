# ADR-0030: CLI コマンド体系を操作対象の種類で分類する

- Status: Accepted
- Date: 2026-07-18

## Context

`pfdsl` CLI はフラットな17コマンドとして育ってきたが、コマンド数の増加につれて系統が構造に現れなくなっていた。
命名も不揃いだった: `sort-meta` と `status-set` はハイフン連結、`get` は単語1つ、`normalize` は対象を明示しない動詞のみで、共通の分類軸がない。

「audit」という語も二重に使われていた。
`check --audit` の「監査」と `audit-sync` の「監査」は指す対象が異なり、同じ語が別々の検査を指すため読み手が混同しやすい。

さらに `check --audit --json` は歪みを抱えていた。
`check` は本来ファイルの妥当性検証コマンドであり、`--audit` はその検証結果とは独立した「終端 artifact 一覧」という別種の出力を割り込ませていた。
`--json` を付けると、この監査結果が検証結果とは別物であるにもかかわらず同じコマンドの出力に押し込まれ、機械可読化のたびにどちらの結果を JSON 化しているのか読み手が推測を要した。

pfdsl は外部ユーザーが不在の段階にある。
後方互換を取る動機（既存の外部利用者の断絶回避）がないため、旧コマンド名を存置するコストだけが残る。
この段階では後方互換より体系の最善を優先すべきと判断した。

## Decision

**CLI コマンドをトップレベル動詞とコマンドグループに再編する。エイリアスは持たず一括で切り替える。**

- **トップレベル動詞**（`check` / `explain` / `fmt` / `render` / `diff`）: ファイル全体に対する操作。
  1ファイル（または2ファイルの比較）を単位にした検証・整形・変換・差分という、対象が「ファイルそのもの」であるコマンド群。
- **`graph`**: 位相への読み取り専用問い合わせ。
  `summary` / `io` / `stats` / `neighbors` / `impact` / `depends-on` / `path` / `edges` を束ねる。
  いずれもグラフ構造を読むだけで、ファイルを書き換えない。
- **`meta`**: フィールドの型と意味を理解した frontmatter 読み書き（field-aware）。
  `get` / `set` / `sort` / `reindex` を束ねる。
  単なるテキスト置換ではなく、フィールドごとの型・制約を踏まえて読み書きする。
- **`status`**: status から導出される計画クエリ。
  `ready` / `gaps` を束ねる。

## Rationale

1. **分類軸は「何に対する操作か」であり利用頻度ではない**。
   よく使うコマンドをトップレベルに残す、といった頻度基準ではなく、操作対象の種類（ファイル全体 / 位相 / フィールド / status 由来の計画）で分けることで、コマンド名から系統が読み取れるようになる。

2. **`check` の純化**。
   `check --audit` を `graph io`（終端監査部分）と `check --hints`（consumer-asymmetry ヒント部分）に分離したことで、`check` は検証専念のコマンドに戻る。
   検証結果と監査結果が同じ出力に混在する歪みが解消される。

3. **`meta` の field-aware 性**。
   `meta set` は status enum の妥当性検証を経てから書き込む。
   `meta get` は指定フィールドの生値に加えて `location.resolved` / `command.cwd` 等の派生フィールドを自動で随伴させ、値を読んでそのまま `set` に渡せる往復安全性を持つ。
   これは単純なキー・バリュー置換ツールとは異なる責務であり、`meta` という専用グループを立てる根拠になる。

4. **唯一の明示的例外**: `meta set` は roadmap ファイルに対して newly-ready になったプロセスの報告を出力する。
   これは「フィールドを書き換えるだけ」の field-aware な責務からはみ出るように見えるが、ADR-0022 が定めた変更レポートの枠組み（`--write` 時に本体でなくレポートを stdout に出す gofmt モデル）でカバーされる正当な例外であり、新設の逸脱ではない。

5. **`audit-sync` → `status gaps` への改名理由**。
   `audit-sync` はロードマップと flow ファイルを「同期」するコマンドではなく、両者の差分（ギャップ）を報告するだけである。
   コマンドがしないことを名前に含めていた誤りを正し、実際に返す情報（gaps）を名前にする。

## Consequences

- 旧コマンド名（`graph <file>` / `normalize` / `neighbors` 等トップレベル / `check --audit` / `check --summary` / `get` / `sort-meta` / `reindex` / `status-set` / `ready` / `audit-sync` / `fmt --mode`）はすべて廃止し、呼び出すと exit 2（invalid usage）になる。
  移行期間・警告付き非推奨は設けない。
- 本ブランチのコミット群で、スキル（`.claude/skills/pfdsl` 生成元・`scripts/skill-template/SKILL.md`）・スクリプト（`scripts/*.mjs`）・`docs/spec/spec.md`・生成物（plugin / README.md / docs/samples/README.md）を一括更新する。
- `graph` グループは将来追加される位相への問い合わせコマンドの名前空間になる。
  新しい読み取り専用グラフクエリは、トップレベルに足すのではなく `graph` の下に追加する。

## References

- ADR-0022（ファイル書き換え CLI コマンドの出力モデル — `meta set` の newly-ready 報告を正当化する変更レポートの枠組み）
- 本ブランチ（`claude/cli-command-restructure-xvhybg`）のコミット群（コマンド体系再編の実装）
