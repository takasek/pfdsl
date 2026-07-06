# runtime-pipeline.md — 変換境界の補足（runtime-pipeline.pfdsl の companion）

`runtime-pipeline.pfdsl` のグラフが運べない、変換境界に関する補足をここに置く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## 全体構成（a-g）

層識別は各ノードの`tags`（a/b/c/d/f1/f2/g）で表現する。`group`は実装パッケージ・habitatによる分類で、tagとは独立の軸。

- **a（言語仕様）**: `pfdsl_spec`。`docs/spec/spec.md`。`validate`が適用するV/Wルールの根拠
- **b（処理系）**: `core`グループの一連のprocess（parse/normalize/validate/format/render_graph/export_image/export_metadata/diff_graphs/sort_meta）。実体は`@pfdsl/core`+`graphviz-exporter`+`preview-engine`+`metadata-exporter`の4パッケージ。cとdは互いに依存せず、双方が独立にbを呼ぶ
- **c（PFD読み書き分析skill）**: `pfdsl_skill`。AIエージェントに`npx @pfdsl/cli <command>`を指示するスキル。全b processの呼び出し元として`>>`入力に明示
- **d（VSCode拡張）**: `vscode_extension`。CLIを介さずbを直接呼ぶ。全b processの呼び出し元として`>>`入力に明示（`metadata_tsv`は現状dのみが呼ぶ経路）。`pfdsl.preview`/hover/codelens/jump/document-link等のUI専用機能は検証可能な成果物を持たないためこのグラフの対象外（設計判断: 出力がエディタ内の一時表示のみで保存・再利用されない機能はartifact化しない）
- **e（a,bの配布）**: このファイルの対象外。npm公開（`published_cli`/`published_libraries`）はworkflow.pfdsl側で表現する
- **f（PFD運用フレームワーク）**: このファイルの対象外。内容（L1+L2=一般層(f1)・L3=GitHub Issuesバックエンド層(f2)。L4はリポ固有で配布対象外・pd-ops自体には含まれない・retroフィードバック）の一次情報はworkflow.pfdslの`ops_skill_general`/`ops_skill_l3`。ここでは`bundle_skills`の入力（配布対象コンポーネント）としてのみ扱う
- **g（fの配布）**: `skill`グループの一連のprocess（bundle_skills以降）。`pfdsl skill sync`が実装

fの内容そのもの（pd-opsのL1〜L4構成・pd-retroからのフィードバック経路）はworkflow.pfdslが一次情報。このファイルはfを「配布される既製コンポーネント」としてのみ扱い、authoring（誰がどう書くか）は範囲外とする。

## c/dの依存構造

`@pfdsl/cli`（cが指示する実行主体）と`vscode-extension`（d）は互いに依存しない。両者とも`@pfdsl/core`・`graphviz-exporter`・`preview-engine`を個別にimportし、`metadata-exporter`はvscode-extensionのみがimportする（`packages/cli/src/index.ts`と`packages/vscode-extension/src/*.ts`のimport文で確認済み）。旧版では`export_image`（cli固有groupと誤認）の入力に`vscode_extension`を混在させ、あたかもcliがextensionに依存するかのような構造になっていた — `core`groupへ統合し是正した。

## 変換境界の定義

- **parse（`@pfdsl/core` の `parse()`）**: frontmatter読込 → lex → parseの3段を1トランザクションとして扱う。出力は`document`（構文木）と`frontmatter`。個別サブコマンドとしては露出しない内部境界
- **normalize（`normalizer.ts` + `graph.ts`の`buildGraph`）**: parseの出力からエッジリスト・ノード種別・孤立ノード集合・`Graph`構造を組み立てる。check/graph/diff/sort-meta/exportMetadataの共通入力。CLI `normalize`コマンドは`normalized_graph`をそのままJSON出力する
- **validate（`validator.ts`）**: 正準化グラフに対してV/Wルールを適用し診断を生成する。CLI `check`コマンドはparse→normalize→validateを1回で実行し`diagnostics_report`を可視化する。VSCode拡張は`analyze()`経由で同じvalidateをエディタ内リアルタイム診断に使う（`diagnostics.ts`）
- **format（`formatter.ts`）**: `pfdsl_source`から独立に再lex/parseし整形済みテキストを生成する。checkのparse結果を再利用しない別経路（CLI `fmt`コマンド・VSCode拡張の`pfdsl.format`コマンドがそれぞれ単体で呼ぶ）
- **render_graph（`graphviz-exporter`の`exportDot`）**: `normalized_graph`と`parsed_doc`（frontmatterのlayout/title/statusStyles）からDOT文字列を組む。CLI `graph`コマンド・VSCode拡張の`pfdsl.preview`/`pfdsl.export`が共通で呼ぶ
- **export_image**: DOT→SVGは`@hpcc-js/wasm`（`preview-engine`の`renderDotToSvg`）で外部依存なし。DOT→SVG→PDF/PNGは`svgToBinary`が`puppeteer`を動的importする — 未インストール時は明示的なエラーメッセージで失敗する（フォールバックしない）
- **export_metadata（`metadata-exporter`）**: CLIサブコマンドを持たない。VSCode拡張の`pfdsl.export`コマンド（`packages/vscode-extension/src/export.ts`）が`analyzeDocument`の`graph`/`frontmatter`から直接呼ぶ経路のみ
- **diff_graphs（`diff.ts`の`diffGraphs`）**: 2つのグラフ間の構造差分を計算する。CLI `diff`コマンド・VSCode拡張の`pfdsl.diff`コマンドが共通で呼ぶ。このpfdsl自体は単一ドキュメントの変換を軸にモデル化しているため、比較対象の2つ目のグラフは図上には現れない
- **sort_meta（`sort.ts`の`sort`）**: 指定キーでfrontmatterのノード定義を並べ替える。CLI `sort-meta`コマンド・VSCode拡張の`pfdsl.sortMeta`コマンドが共通で呼ぶ

### skill sync（`pfdsl skill sync`）の依存

`pfdsl skill sync`は上記の.pfdsl変換パイプラインとは独立した、ファイル配布のためのサブパイプライン。

- **skill_source_bundle の出所（`bundle_skills`）**: ビルド時（`packages/cli/tsup.config.ts`の`onSuccess`）に`.claude/skills/{pfd-ops,pfd-retro,pfd-ecosystem,pfdsl}`と`.claude/commands/`（`pfd-*.md`のみ）を`packages/cli/dist/skills/`・`dist/commands/`へコピーし、npmパッケージに同梱する。この4スキル名の並びはtsup.config.tsとskill-sync.tsの`runSkillSync`両方にハードコードされており、スキル追加時は両方の更新が必要。コピー元の`pfd-ops`は内部でL1+L2（ops_skill_general）とL3（ops_skill_l3）に分かれるが、コピー処理自体は両者を区別しない機械的な丸ごとコピー（L4はリポ固有・配布対象外でこのコピーに含まれない）
- **`resolveSkillRoot`のフォールバック**: 公開後の実行は`dist/skills/<name>`を、ソース/テスト実行時（pre-build）は3階層上の`.claude/skills/<name>`を参照する。どちらにも無ければ例外
- **`sync_skill_tree`は破壊的コピー**: 各エントリを`rmSync`で削除してから`cpSync`する。アップストリームで削除・改名されたファイルが採用リポに残留しない設計
- **`sync_install_layer`はゲート付き**: L3（GitHub Issuesバックエンド）が採用リポで既に採用済み（`install/`由来ファイルが1つでも存在）の場合のみ`install/`をリポルートへコピーする。未採用時はファイルを一切生成せず、`cp -r .claude/skills/pfd-ops/install/. .`を促す案内メッセージのみ返す（自動アップグレードしない）
- **`ensure_labels`はGitHub側の副作用**: `sync_install_layer`が実行された場合のみ、`gh`CLIで`flow:managed`/`flow:exempt`ラベルの存在を確認・作成する。`--yes`未指定時は対話確認を挟む

## エラー・例外処理

- 診断は`severity: "error" | "warning"`を持つ。`check --strict`は一部の警告（例: V011フィードバック検証）をエラー昇格させる
- `svgToBinary`（PDF/PNG化）は`puppeteer`が未インストールだと`PDF/PNG export requires puppeteer.`で例外を投げる。SVG化（wasm経路）はこの依存を必要としない
- `check`はグラフの循環を検出しない（primary graphはDAG前提。循環がある場合は`>>?`か改版artifactで表現する — pfdsl skillの品質ガイド参照）
