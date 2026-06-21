# PFDSL 実装計画 (Claude Code 向け)

PFDSL v0.0.2 仕様に基づくツールチェーン実装計画。
元のPFDSL記述を実装可能な粒度のタスクに分解したもの。

## 前提

- 言語: TypeScript (コア層 + VSCode extension を統一するため)
- パッケージ管理: pnpm (monorepo構成)
- 参照仕様: `PFDSL仕様書 v0.0.2`
- 配布目標: VSCode Marketplace

---

## リポジトリ構成 (Monorepo)

```
pfdsl/
├── packages/
│   ├── core/                 # コアライブラリ (lexer/parser/normalizer/validator/formatter)
│   ├── graphviz-exporter/    # Graphviz DOT 出力
│   ├── preview-engine/       # プレビュー描画エンジン
│   ├── cli/                  # CLIラッパー
│   └── vscode-extension/     # VSCode拡張
├── examples/                 # .pfdsl サンプル集
├── docs/spec/                # 仕様書 (v0.0.2)
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Phase 0: アーキテクチャ定義

### Task 0.1: コアアーキテクチャ決定

- **目的**: 仕様書から実装単位を導出
- **成果物**: `docs/architecture.md`
- **内容**:
  - データフロー: `source → [frontmatter split] → lexer → parser → AST → normalizer → EdgeSet → validator → diagnostics`
  - 公開API境界の定義
  - モジュール間依存の明示

### Task 0.2: スキーマ定義 (共有型)

- **目的**: 全モジュールが参照する型定義を先に固める
- **成果物**: `packages/core/src/types/`
- **内容**:
  - `Token` 型定義
  - `AST` ノード型 (Chain, Edge, ArtifactExpr など)
  - `EdgeSet` (正規形) 型
  - `Diagnostic` 型 (error / warning / info + 位置情報)
  - `Graph` 型 (Primary / Feedback の二層表現)

---

## Phase 1: コア層実装

### Task 1.1: Lexer

- **入力**: ソース文字列
- **出力**: Token列
- **要件**:
  - 最長一致で `>>?` → `>>` → `->` を認識
  - bare-id の Unicode Letter / Number + `_` `-` を許可
  - quoted-id `"..."` のエスケープ処理 (`\"` `\\` `\n` `\t`)
  - 行コメント `#` 処理 (quoted-id 内は除外)
  - `[` `]` `,` `;` `\n` をトークン化
  - 位置情報 (line, column, offset) を全トークンに付与

### Task 1.2: Frontmatter Loader

- **入力**: ソース文字列
- **出力**: `{ frontmatter: object | null, body: string, bodyStartLine: number }`
- **要件**:
  - ファイル先頭が `---` で始まるときのみ front matter を抽出
  - YAML パースには `yaml` パッケージを使用
  - 本文の開始行番号を保持 (エラー位置計算に必須)
  - 不正YAMLは Diagnostic として報告

### Task 1.3: Parser

- **入力**: Token列
- **出力**: AST
- **要件**:
  - BNF 準拠の再帰下降パーサ
  - チェーン構文 `X >> R -> Y >> S -> Z` の左から線形走査
  - 集合記法 `[a, b]` のパース (改行またぎも許容すべき — 仕様 v0.0.3候補)
  - 文区切り: 改行 / `;`
  - 構文エラーは回復可能な範囲で継続パース (複数エラーを一度に報告)

### Task 1.4: Normalizer

- **入力**: AST + front matter
- **出力**: 正規形 EdgeSet (`Artifact >> Process` / `Artifact >>? Process` / `Process -> Artifact`)
- **要件**:
  - チェーン記法を個別 edge に展開
  - 集合記法 `[a, b] >> P -> [x, y]` を直積展開
  - 重複 edge を除去 (warning として報告)
  - ID種別推論 (仕様 5.1)
  - Primary Graph と Feedback Graph の2層構築

### Task 1.5: Validator

- **入力**: EdgeSet + Graph + front matter
- **出力**: Diagnostic列
- **要件**:
  - 単一生成元制約 (15.1)
  - プロセス完全性制約: 入力0 or 出力0 のプロセスは error (15.2)
  - 型矛盾検出: 同一IDが Artifact / Process 両方として使われていないか (5.1.4)
  - parts 制約: Process ID混入禁止、自己参照禁止、循環禁止 (15.5)
  - strict mode: フィードバック到達可能性の警告 (15.3)

### Task 1.6: Canonical Sorter

- **入力**: EdgeSet + Primary Graph
- **出力**: ソート済み Edge配列
- **要件** (仕様14):
  - 第1キー: 連結成分順 (成分内 node ID 辞書順最小値で比較)
  - 第2キー: ランク順 (Primary Graph のみで計算、Feedback edge は除外)
  - 第3キー: edge種別順 (`>>` → `>>?` → `->`)
  - 第4キー: node ID 辞書順
  - `>>?` は接続先 Process のランクに従って配置

### Task 1.7: Formatter

- **入力**: AST + Canonical順序
- **出力**: 整形済みソース文字列
- **要件**:
  - 正規形を読みやすい形で出力 (チェーン化する / しないは設計判断)
  - コメント保持ポリシーを決定 ← **要仕様追補**
  - 集合記法の折り返しルール
  - 末尾改行、インデント統一

### Task 1.8: Core Library 統合

- **成果物**: `@pfdsl/core` パッケージ
- **公開API**:
  ```ts
  export function parse(source: string): ParseResult;
  export function normalize(ast: AST, fm: Frontmatter): EdgeSet;
  export function validate(edges: EdgeSet, fm: Frontmatter): Diagnostic[];
  export function format(source: string, options?: FormatOptions): string;
  export function buildGraph(edges: EdgeSet): { primary: Graph; feedback: Graph };
  ```
- **テスト**: 各モジュール単体 + 統合テスト (examples/ の .pfdsl を全通過)

---

## Phase 2: 出力層

### Task 2.1: Graphviz Exporter

- **入力**: Graph
- **出力**: DOT 文字列
- **要件**:
  - Artifact は箱、Process は楕円(PFD慣例)で表現
  - front matter の `label` を node label に反映 (未指定時はID表示)
  - Feedback edge は点線 + 別色
  - layout.direction を `rankdir` にマッピング

### Task 2.2: Preview Engine

- **入力**: Graph
- **出力**: SVG or Canvas描画命令
- **要件**:
  - 初期実装は Graphviz (WASM: `@hpcc-js/wasm`) でレンダリング
  - ズーム/パン操作
  - ノードクリック時のイベント (エディタとの連携用)

### Task 2.3: CLI Tool

- **成果物**: `@pfdsl/cli` (`pfdsl` コマンド)
- **サブコマンド**:
  - `pfdsl check <file>` — バリデーション実行
  - `pfdsl fmt <file>` — フォーマット (`--write` で上書き)
  - `pfdsl normalize <file>` — 正規形出力
  - `pfdsl graph <file> --format dot|svg` — 可視化
  - `pfdsl diff <a> <b>` — 構造差分

---

## Phase 3: VSCode Extension

### Task 3.1: Extension Shell

- **成果物**: `packages/vscode-extension`
- **内容**:
  - `package.json` の `contributes` 定義
  - 言語ID `pfdsl`、拡張子 `.pfdsl` の関連付け
  - アクティベーションイベント設定

### Task 3.2: Syntax Highlighting

- **成果物**: TextMate grammar (`syntaxes/pfdsl.tmLanguage.json`)
- **対象**:
  - 演算子 `>>` `>>?` `->`
  - 集合記法 `[` `]` `,`
  - コメント `#`
  - quoted-id `"..."`
  - front matter YAML 部分 (YAML grammar を埋め込み)

### Task 3.3: Language Service (LSP)

- **成果物**: `@pfdsl/language-service`
- **機能**:
  - 診断 (保存時/入力中)
  - ホバー (ID の front matter 情報を表示)
  - 定義ジャンプ (ID → front matter 定義箇所)
  - シンボル一覧 (Artifact / Process の分類表示)
  - リネーム (一括ID置換)

### Task 3.4: Preview Panel

- Webview で Preview Engine をホスト
- エディタ変更に追従してリアルタイム更新 (debounce 300ms)
- プレビュー側ノードクリック → エディタ側該当行にジャンプ

### Task 3.5: Format Command

- `editor.action.formatDocument` 連携
- `formatOnSave` 対応

### Task 3.6: Hover Support

- ID にホバー時、front matter の label / description / owner / tags を表示
- parts 宣言がある場合は構造図を小さくレンダリング

### Task 3.7: Diagnostics UI

- Language Service の Diagnostic を VSCode Problems パネルに表示
- エラー位置の赤波線表示
- クイックフィックス候補提示 (将来拡張)

---

## Phase 4: リリース

### Task 4.1: RC パッケージング

- バージョニング規則: semver (初版 `0.1.0`)
- CHANGELOG.md 整備
- README.md (機能紹介 + gif)
- LICENSE (MIT想定)

### Task 4.2: Marketplace 公開

- `vsce publish` で VSCode Marketplace に公開
- Open VSX にも同時公開 (Cursor / VSCodium対応)

---

## Phase 5: 継続改善 (フィードバックループ)

実運用で得た知見 (`workflow_usage`) を、既存の実装プロセス (`implement_validator` / `implement_formatter` / `implement_preview_engine`)
にフィードバック入力として再投入する。

```
workflow_usage >>? implement_validator
workflow_usage >>? implement_formatter
workflow_usage >>? implement_preview_engine
```

これにより validator / formatter / preview_engine の生成元は `implement_*` プロセス単一のまま保たれ、単一生成元制約 (15.1) を満たす。

### Task 5.1: CI Actions

- GitHub Actions で `pfdsl check` を実行するワークフロー
- PRに対する差分コメント (diff_analyzer 利用)

### Task 5.2: Diff Analyzer

- 2つの .pfdsl の構造差分
- node追加/削除/移動を Primary Graph 構造で判定
- レポート出力 (Markdown / JSON)

---

## 実装順序 (推奨)

| 段階 | マイルストーン | 完了基準 |
| --- | --- | --- |
| MVP0 | Core Library | `parse → validate → format` が examples 全ケースで動作 |
| MVP1 | CLI + Graphviz | `pfdsl fmt` と `pfdsl graph` が使える |
| MVP2 | VSCode Extension 基本 | ハイライト + 診断 + プレビュー |
| MVP3 | LSP 高度機能 | ホバー / 定義ジャンプ / リネーム |
| MVP4 | Marketplace 公開 | RC → 正式版 |
| 継続 | CI + diff analyzer | dogfooding 開始 |

---

## 仕様追補が必要な論点 (v0.0.3 送り候補)

実装中に浮上した、仕様本体で決めておくべき論点:

1. **集合記法の改行許容**: `[a,\n b, c]` を許容するか
2. **コメントの保持ポリシー**: フォーマッタがコメントを保持すべきか
3. **Frontmatter 処理順序**: Lexer前に分離するのが素直 (parser後段ではなく) — 本計画では反映済み

---

## 参考リンク

- Claude Code: https://docs.claude.com/en/docs/claude-code/overview
- VSCode Extension API: https://code.visualstudio.com/api
- LSP Spec: https://microsoft.github.io/language-server-protocol/
- Graphviz WASM: https://github.com/hpcc-systems/hpcc-js-wasm
