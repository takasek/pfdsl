# ADR-0034: pfdsl は `.pfdsl` frontmatter のフォーマットを所有する

- Status: Accepted
- Date: 2026-07-28

## Context

`.pfdsl` の frontmatter は YAML である。現在 `fmt` は frontmatter を一切正準化せず、コメント・空行・flow-style をそのまま素通しする（`packages/core/src/index.ts` の `format()`、frontmatter 部分を文字列スライスのまま出力に結合）。

その結果、frontmatter を編集する4コマンド（`meta set` / `sort` / `reindex` / `insert-definition`）はいずれも正規表現による行・文字位置ベースの手術で書き換えを実装している（共有ヘルパー `packages/core/src/frontmatter-text.ts`）。YAML の表現の形が増えるたびに分岐が増える構造で、#415（flow-style）・#430（引用 id）・#530（空行）・ブロックスカラーと実際にバグクラスが増えてきた。

`core` は既に `yaml@^2.4.0` に依存しており（`frontmatter.ts` の読み取り専用パース）、`scripts/pfdsl/audit-issues-flow.mjs` が `roadmap.pfdsl` に対して `parseDocument` → `setIn`/`getIn`/`deleteIn` → `toString()` の CST 往復を実運用している前例がある。

判断の前提（#578 適用点1）: 本 issue が扱う2案は〈`.pfdsl` の frontmatter は YAML であり、その表現の自由度をユーザーに残すか奪うかの二択である〉を前提にしている。この前提を否定した案（frontmatter を YAML でなく pfdsl 自身の構文にする）は、既存ファイル・既存ツール（エディタの YAML 補完等）への影響が桁違いに大きいため却下する。

## Decision

**pfdsl は frontmatter のフォーマットを所有する。**

- `fmt` は frontmatter も CST（`yaml` パッケージの `Document`）経由で正準化する。`parseDocument` → 書き換え → `toString()` の3行が基本形になる。
- `meta set` / `sort` / `reindex` / `insert-definition` の正規表現ベースの手術コードを CST ベースの書き換えに置き換える。`frontmatter-text.ts` の手術専用ヘルパー（`indentOf` / `findFrontmatterFences` / `locateSection` 等の書き込み用途）は削除する。診断（エラー位置特定、読み取り専用）に使う `detectChildIndent` / `escapeRe` は本 ADR のスコープ外とし維持する。
- `insert-definition` は他3コマンドと同じく「新しい frontmatter 全文の文字列」を返す契約に統一する。従来の行番号 `Insertion` 型は廃止する。呼び出し元の VS Code 拡張（`packages/vscode-extension/src/def-insertion.ts`）は frontmatter 全体を差し替える `WorkspaceEdit` に変更する。
- `toString` オプションは `{ lineWidth: 0 }` のみを採用する。自動折り返しによる意図しない改行挿入を防ぐために必須の設定であり、これ以外のオプション（`flowCollectionPadding` 等）は追加しない。
- スカラーの引用は `yaml` パッケージ既定（YAML 1.2 core schema）の判断に委ねる。現行の「YAML 1.1 前提の過剰引用」規則（日付・`yes`/`no` の引用等）は廃止する。

## 検討したが不採用の案

- **`{ lineWidth: 0, flowCollectionPadding: false }` を採用する案**: 実測では roadmap.pfdsl / workflow.pfdsl / runtime-pipeline.pfdsl のいずれの組み合わせでもバイト同一にはならない（3パターンの実測比較を issue #578 本文に記録済み）。どちらに倒しても無関係な行が書き換わるなら、オプション数が少ない方を理想形として選ぶ。
- **frontmatter を pfdsl 自身の構文にする案**: 上記「前提」節の通り、既存ファイル・既存ツールへの影響が桁違いに大きく、所有権の判断（本 ADR の主題）が先に必要なため却下。

## Consequences

- 所有すると決めたことで、採用リポの既存 `.pfdsl` は `fmt` / `meta set` 等の実行時に再整形される。破壊的変更であり、移行の告知が必要（実装 issue 側で対応）。
- #415 / #430 / #530 のようなフォーマットの形ごとのバグクラスは、CST 化によって構造的に解消する。
- `insert-definition` の VS Code 拡張呼び出し側は、行単位の最小挿入から frontmatter 全体差し替えの `WorkspaceEdit` に挙動が変わる（undo 粒度が変わる）。理想形の一貫性（4コマンドとも「全文の文字列を返す」契約に統一する）を優先する。副作用として #494 が導入した並行編集ガード（他行への影響なしを保証する最小 insert）が frontmatter ブロック単位に縮小する — ブロック外の同時編集は引き続き保護されるが、ブロック内の同時編集は上書きされうる。
- 実装（CST ベースへの書き換え自体）は本 ADR のスコープ外とし、別途 `flow:managed` issue で管理する。
- 本 ADR は再整形がどこまで及ぶかの線引きを持たない。ADR-0037 がこれを狭め、folded scalar (`>`) の手書き折返しは保存する（インデント幅は正準化する）と定めた。所有の判断自体は維持される。

## References

- #578（本 ADR の起票元 issue、実測比較・前提・否定案の記録）
- #415 / #430 / #530（手術の分岐が増えた実績）
- `scripts/pfdsl/audit-issues-flow.mjs`（CST 往復の前例実装）
- ADR-0027（同種の「所有権を確定してから機構化する」spec 決定の先例）
