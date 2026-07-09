# runtime-pipeline.md — 変換境界の補足（runtime-pipeline.pfdsl の companion）

`runtime-pipeline.pfdsl` のグラフが運べない、変換境界に関する補足をここに置く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

この図は「システムが動くとき、データは何に変換されるか。変換の境界はどこか」だけに答える。
互いに独立した2本のチェーンを持つ: .pfdsl ドキュメント変換チェーン（b層）と、スキル配布チェーン（g層）。
`group` は成果物の存在様式（住処）で切り、層識別は `tags` で表す（両者は独立の軸）。

## a-g 層との対応

- **a（言語仕様）**: `docs/spec/spec.md`。図に現れない — validate が適用する V/W ルールの根拠だが、実装へ反映されるのは設計時であり、実行時に読まれる入力ではないため
- **b（処理系）**: `tags: [b]` の process 群。実体は `@pfdsl/core` + `graphviz-exporter` + `preview-engine` + `metadata-exporter` の4パッケージ（各 process の `location` 参照）
- **c（PFD読み書き分析skill）**: `pfdsl_skill`。bのホストとしては図外（次節）、配布素材としてのみ `bundle_skills` の入力に現れる
- **d（VSCode拡張）**: `packages/vscode-extension/`。図に現れない — bのホストであり、データを供給も保管もしないため（次節）
- **e（a,bの配布）**: このファイルの対象外。npm 公開は workflow.pfdsl 側で表現する
- **f（PFD運用フレームワーク）**: `tags: [f1]`（L1+L2 汎用層）/ `tags: [f2]`（L3 GitHub Issues バックエンド層）。内容・retro フィードバックの一次情報は workflow.pfdsl の `ops_skill_general` / `ops_skill_l3`。L4 はリポ固有で配布対象外・pfd-ops 自体に含まれない。ここでは配布素材としてのみ扱う
- **g（fの配布）**: `tags: [g]` の process 群。`pfdsl skill sync` とビルド時バンドルが実装

## ホスト（c/d）とbの関係

`@pfdsl/cli`（cが指示する実行主体）と `vscode-extension`（d）は互いに依存しない。
両者とも `@pfdsl/core`・`graphviz-exporter`・`preview-engine` を個別に import し、`metadata-exporter` は vscode-extension のみが import する（`packages/cli/src/index.ts` と `packages/vscode-extension/src/*.ts` の import 文で確認済み）。

**ホストはグラフに現れない。** c/d はb層パイプラインを起動・実行する側であって、変換に投入されるデータでも変換結果でもない。
`>>` 入力にすると「bがc/dに依存する」向きに逆転し（実際はc/dがbを呼ぶ側で、bはc/dの存在を知らない）、tag で表すにしても is-a（層識別）と is-called-by（呼び出し関係）が同じ名前空間に混在して誤読を招く — いずれも過去の版で実際に踏んだ誤りである。
呼び出し経路の情報は各 process の description（「双方が呼ぶ」「拡張のみが呼ぶ」等）とこの節で運ぶ。

- b の全 process は CLI・VSCode 拡張の双方から呼ばれる。例外は `export_metadata`（CLI サブコマンドがなく、拡張の `pfdsl.export` のみが呼ぶ）
- 人間の読み手は artifact 側の `externalStakeholders`（CLIユーザー / VSCode拡張ユーザー / CI）で表す
- 拡張の preview / hover / codelens / jump / document-link 等の UI 専用機能は、出力がエディタ内の一時表示のみで保存・再利用されないため artifact 化しない（設計判断）

## 変換境界の定義

- **parse（`@pfdsl/core` の `parse()`）**: frontmatter 読込 → lex → parse の3段を1トランザクションとして扱う。出力は `document`（構文木）と `frontmatter`。個別サブコマンドとしては露出しない内部境界
- **normalize（`normalizer.ts` + `buildGraph`）**: parse の出力からエッジリスト・ノード種別・孤立ノード集合・`Graph` 構造を組み立てる。CLI `normalize` コマンドはこれをそのまま JSON 出力する
- **validate（`validator.ts`）**: 正準化グラフと frontmatter に V/W ルールを適用し診断を生成する。CLI `check` は parse→normalize→validate を1回で実行する。VSCode 拡張は `analyze()` 経由で同じ validate をエディタ内リアルタイム診断に使う（`diagnostics.ts`）
- **format（`formatter.ts`）**: ソーステキストから独立に再 lex/parse し整形済みテキストを生成する。check の parse 結果を再利用しない別経路
- **sort_meta（`sort.ts` の `sort(source, opts)`）**: 入力はソーステキスト（format と同じく独立再 parse）。構文木を受け取る経路ではない
- **render_graph（`graphviz-exporter` の `exportDot(graph, frontmatter)`）**: 正準化グラフと frontmatter（layout / title / statusStyles）から DOT 文字列を組む
- **export_image**: DOT→SVG は `@hpcc-js/wasm`（`preview-engine` の `renderDotToSvg`）で外部依存なし。PDF/PNG は `svgToBinary` が `puppeteer` を動的 import し、未インストール時は明示エラーで失敗する（フォールバックしない）
- **export_metadata（`metadata-exporter` の `extractMetadata(graph, frontmatter)`）**: VSCode 拡張の `pfdsl.export`（`export.ts`）のみが呼ぶ
- **diff_graphs（`diff.ts` の `diffGraphs(a, b, fmA, fmB)`）**: 入力は2組の（グラフ, frontmatter）。この図は単一ドキュメントの変換を軸にモデル化しているため、比較対象の2つ目は図上に現れない

## skill sync（配布チェーン）の依存

- **skill_source_bundle の出所（`bundle_skills`）**: ビルド時（`packages/cli/tsup.config.ts` の `onSuccess`）に4スキルツリーと `commands/pfd-*.md`・`agents/pfd-*.md`（#357）を `dist/` へコピーし npm パッケージに同梱する。4スキル名・agents パターンは tsup.config.ts と skill-sync.ts の `runSkillSync` の両方にハードコードされており、スキル・agent 追加時は両方の更新が必要。pfd-ops 内部の f1/f2 の区別をコピー処理は関知しない（丸ごとコピー）
- **`sync_agents` は `sync_commands` と同型**: `DISTRIBUTABLE_COMMAND_PATTERN`（`/^pfd-.*\.md$/`）を再利用し、`.claude/agents/` のうち `pfd-*.md` に一致するものだけを採用リポの `.claude/agents/` へコピーする（非破壊的な `cpSync` 上書き）
- **`resolveSkillRoot` のフォールバック**: 公開後の実行は `dist/skills/<name>` を、ソース/テスト実行時（pre-build）は3階層上の `.claude/skills/<name>` を参照する。どちらにも無ければ例外
- **`sync_skill_tree` は破壊的コピー**: 各エントリを `rmSync` で削除してから `cpSync` する。アップストリームで削除・改名されたファイルが採用リポに残留しない設計
- **`sync_install_layer` のコピー元はバンドル**: `copyInstallLayer(skillRoot, targetRoot)` はバンドル内 `pfd-ops/install/` から採用リポルートへコピーする（採用リポの `.claude/skills/pfd-ops/install/` からではない）。L3 採用済み（`install/` 由来ファイルが1つでも存在）の場合のみ実行し、未採用時は `cp -r .claude/skills/pfd-ops/install/. .` を促す案内のみ返す（自動アップグレードしない）
- **`ensure_labels` は GitHub 側の副作用**: `sync_install_layer` が実行された場合のみ、`gh` CLI で `flow:managed` / `flow:exempt` ラベルの存在を確認・作成する。`--yes` 未指定時は対話確認を挟む。gh 不在時は手動作成の案内を返す（エラーにしない）

## エラー・例外処理

- 診断は `severity: "error" | "warning"` を持つ。`check --strict` は一部の警告（例: V011 フィードバック検証）をエラー昇格させる
- `svgToBinary`（PDF/PNG化）は `puppeteer` が未インストールだと `PDF/PNG export requires puppeteer.` で例外を投げる。SVG化（wasm 経路）はこの依存を必要としない
- primary graph（`>>` / `->`）の循環は `check` が V010 error として検出する（`>>?` は対象外）。循環する構造は `>>?` か改版 artifact で表現する — pfdsl skill の品質ガイド参照
