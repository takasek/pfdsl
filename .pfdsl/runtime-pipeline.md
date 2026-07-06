# runtime-pipeline.md — 変換境界の補足（runtime-pipeline.pfdsl の companion）

`runtime-pipeline.pfdsl` のグラフが運べない、変換境界に関する補足をここに置く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## 変換境界の定義

- **parse（`@pfdsl/core` の `parse()`）**: frontmatter読込 → lex → parseの3段を1トランザクションとして扱う。出力は`document`（構文木）と`frontmatter`。個別サブコマンドとしては露出しない内部境界
- **normalize（`normalizer.ts` + `graph.ts`の`buildGraph`）**: parseの出力からエッジリスト・ノード種別・孤立ノード集合・`Graph`構造を組み立てる。check/graph/diff/audit/exportMetadataの共通入力
- **validate（`validator.ts`）**: 正準化グラフに対してV/Wルールを適用し診断を生成する。`check`コマンドはparse→normalize→validateを1回で実行し`diagnostics_report`のみを可視化する
- **format（`formatter.ts`）**: `pfdsl_source`から独立に再lex/parseし整形済みテキストを生成する。checkのparse結果を再利用しない別経路（`fmt`コマンドが単体で完結する設計）
- **render_graph（`graphviz-exporter`の`exportDot`）**: `normalized_graph`と`parsed_doc`（frontmatterのlayout/title/statusStyles）からDOT文字列を組む
- **export_image**: DOT→SVGは`@hpcc-js/wasm`（`preview-engine`の`renderDotToSvg`）で外部依存なし。DOT→SVG→PDF/PNGは`svgToBinary`が`puppeteer`を動的importする — 未インストール時は明示的なエラーメッセージで失敗する（フォールバックしない）
- **export_metadata（`metadata-exporter`）**: CLIサブコマンドを持たない。VSCode拡張の`pfdsl.export`コマンド（`packages/vscode-extension/src/export.ts`）が`analyzeDocument`の`graph`/`frontmatter`から直接呼ぶ経路のみ

### skill sync（`pfdsl skill sync`）の依存

`pfdsl skill sync`は上記の.pfdsl変換パイプラインとは独立した、ファイル配布のためのサブパイプライン。

- **skill_source_bundle の出所**: ビルド時（`packages/cli/tsup.config.ts`の`onSuccess`）に`.claude/skills/{pfd-ops,pfd-retro,pfd-ecosystem,pfdsl}`と`.claude/commands/`（`pfd-*.md`のみ）を`packages/cli/dist/skills/`・`dist/commands/`へコピーし、npmパッケージに同梱する。この4スキル名の並びはtsup.config.tsとskill-sync.tsの`runSkillSync`両方にハードコードされており、スキル追加時は両方の更新が必要
- **`resolveSkillRoot`のフォールバック**: 公開後の実行は`dist/skills/<name>`を、ソース/テスト実行時（pre-build）は3階層上の`.claude/skills/<name>`を参照する。どちらにも無ければ例外
- **`sync_skill_tree`は破壊的コピー**: 各エントリを`rmSync`で削除してから`cpSync`する。アップストリームで削除・改名されたファイルが採用リポに残留しない設計
- **`sync_install_layer`はゲート付き**: L3（GitHub Issuesバックエンド）が採用リポで既に採用済み（`install/`由来ファイルが1つでも存在）の場合のみ`install/`をリポルートへコピーする。未採用時はファイルを一切生成せず、`cp -r .claude/skills/pfd-ops/install/. .`を促す案内メッセージのみ返す（自動アップグレードしない）
- **`ensure_labels`はGitHub側の副作用**: `sync_install_layer`が実行された場合のみ、`gh`CLIで`flow:managed`/`flow:exempt`ラベルの存在を確認・作成する。`--yes`未指定時は対話確認を挟む

## エラー・例外処理

- 診断は`severity: "error" | "warning"`を持つ。`check --strict`は一部の警告（例: V011フィードバック検証）をエラー昇格させる
- `svgToBinary`（PDF/PNG化）は`puppeteer`が未インストールだと`PDF/PNG export requires puppeteer.`で例外を投げる。SVG化（wasm経路）はこの依存を必要としない
- `check`はグラフの循環を検出しない（primary graphはDAG前提。循環がある場合は`>>?`か改版artifactで表現する — pfdsl skillの品質ガイド参照）
