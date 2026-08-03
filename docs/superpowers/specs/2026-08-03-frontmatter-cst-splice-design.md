# frontmatter CST 書き込みをバイト範囲スプライス方式へ 設計

## 背景・問題

`meta set` で無関係なフィールド（例: `status`）を更新すると、同じノードの `description: >` で意図的に複数行へ折り返していた記述が1行に潰れる。実リポジトリで再現確認済み。

原因は `frontmatter-cst.ts` の書き込みパスが「フロントマター全体を `yaml` パッケージの `Document.toString()` で再シリアライズする」方式である点。`yaml` の folded scalar (`>`) は仕様上、改行の位置を値として保持しない（改行はスペースへ折り畳まれ、一度パースすると元の改行位置情報は失われる）。編集対象のフィールドを一切触らず素通りさせる（parse→即toString）だけでも同じ1行化が再現することを確認済みで、これは「編集で壊れた」のではなく「全文再直列化そのものが不可逆な情報損失を起こす」構造的な問題。

`renderFrontmatterCst`（全文 `toString()`）は `setFrontmatterField`（`meta set`）だけでなく `reindex.ts` / `insert-definition.ts` / `sort.ts` の4箇所で共有されており、全て同じ損失を潜在的に抱える。特に `sort.ts` は並び替えのためだけに全ノードの全フィールドを再直列化しており、移動していないノードの書式まで巻き込まれる。

ADR-0034 は `{ lineWidth: 0 }` を「自動折り返しによる意図しない改行挿入を防ぐ」目的で採用したが、逆方向（意図的な改行の喪失）は検討されていなかった。

## 方針

`frontmatter-cst.ts` から「全文 `toString()` で書き込む」経路を撤退させ、**バイト範囲スプライス方式**に置き換える。`yaml` の各ノードは元ソースのバイト範囲 (`node.range`) を持つ。論理的に変更したい箇所だけを元ソース文字列に対してピンポイントで置換し、触っていない部分は `toString()` を一切通さない。コメント・quoteスタイル・flow/block選択・折り返し位置、全てバイト単位で温存される。

`renderFrontmatterCst`（全文 `toString()`）は「フロントマター自体が存在しない新規作成」の特殊ケースにのみ残す。

## 新規プリミティブ

`frontmatter-cst.ts` に純粋なテキスト操作関数を追加する。

```ts
interface Splice {
  start: number;
  end: number;
  replacement: string;
}

function applySplices(source: string, splices: Splice[]): string
```

範囲が重複する splice が渡されたら例外を投げる。降順オフセットで安全に適用し、途中のオフセットずれを起こさない。各呼び出し元はこの上にドメイン知識（値置換／新規追加／並び替え）を積む。

## 呼び出し元ごとの実装

### `setFrontmatterField`（`meta set`、既存フィールド更新）

`doc.getIn([kind, id, field], true)` でノード取得。既存なら `node.range` で値部分だけを新値の直列化テキストへ置換する1件の splice を作る。フィールドが未存在なら「新規挿入」パスへ。

### 新規フィールド挿入（`setFrontmatterField` の add時、`insert-definition.ts`）

対象マップの最後の Pair の `range` 終端直後に、兄弟キーのインデント幅を踏襲した `\n  key: value` を挿入する splice を作る。マップ自体が空（対象 `kind.id` が全く存在しない等、温存すべき元テキストが無い場合）に限り、その1ノード分だけ `toString()` で生成してよい。

### `reindex.ts`（複数ノードの一括更新）

変更対象ノードごとに値置換 splice を収集し、`applySplices` に一括投入する。

### `sort.ts`（並び替え）

各 Pair の正確な範囲（先頭コメント/空行トリビアの開始位置〜値終端）を算出する。`hoistLeadingTrivia` は従来通り必要。新順序でその範囲群を元テキストから切り出して連結し、マップ全体の範囲を1回の splice で置換する。個々の Pair の中身は一切 `toString()` を通さないため、値の書式は無条件で温存される。

## エッジケース

- **anchor / alias**: 対象フィールドが anchor 参照を持つ場合、値ノードだけを切り離すと参照整合性が崩れる恐れがある。スコープ外とし、「anchor/alias を含むノードのフィールドは全文再直列化にフォールバック」する分岐を残し、ユニットテストでガードする。
- **CRLF**: 挿入するテキストの改行コードは既存の `cst.newline` に従う（現状のロジックを踏襲）。
- **書き込み前の安全弁**: `hasErrors(analyze(newSrc).diagnostics)` による事前検証は温存する。

## テスト方針（t-wada式 TDD）

1. Red: 今回の再現ケース（無関係フィールド更新で `>` 折り返しが1行化される）を先にテストとして書く。`setFrontmatterField` / `reindex` / `sort` / `insertDefinition` それぞれ最低1本。
2. 各プリミティブ（値置換 splice／挿入 splice／並び替え splice、および `applySplices` 自体）を最小ユニットから Green にする。
3. 既存の `meta set` / `reindex` / `sort` / `insert-definition` のテストスイートは全て通過必須。ただし後述の2件は期待値そのものを更新する。

## `fmt` は対象外

`packages/core/src/index.ts` の `format()`（`fmt`）も `renderFrontmatterCst` 全文再直列化を使うが、インデント幅の正規化は `fmt` 本来の責務であり、splice 方式（未変更バイトの温存）をそのまま適用できない。一方で `>` の折り返し位置はユーザー裁量であり `fmt` が触ってよい対象ではない。つまり `fmt` には「インデントは正規化しつつ fold の折り返しだけ温存する」という、今回の4箇所とは別種の修正（元の折り返し行を新インデント幅へ再インデントしてスプライスし直す）が要る。実装量・検証観点が異なるため別 issue/plan へ先送りする。

## 既存テストの期待値変更（insert-definition）

`insert-definition.test.ts` の以下2件は、全文再直列化の副作用を期待値として固定していたことが判明した。splice 方式ではこの副作用自体が起きなくなるため、期待値を「元の書式を保持する」方向に更新する。

- **インデント幅の正規化**: 4スペースインデントの既存ファイルへ挿入すると、現行は2スペースへ強制正規化される。splice 方式（兄弟キーのインデントを踏襲）では元の4スペースのまま保持される。挿入という操作自体はインデント正規化（`fmt` の責務）とは無関係な副作用だったため、これは是正であって新たな欠陥ではない。
- **ヘッダ末尾コメントの位置**: `artifact: # user artifacts` のような一行コメントは、現行では別行 `artifact:\n  # user artifacts\n` へ強制的に移動する。splice 方式では元の一行コメントのまま保持される。

## スコープ外

- `renderFrontmatterCst` の全文再直列化パス自体の削除（`fmt` および「フロントマター自体が存在しない新規作成」時は引き続き使用）。
- anchor/alias を含むフィールドの splice 対応（フォールバックで現状維持のみ）。
- `fmt` の fold 保存修正（別 issue/plan で扱う）。
