# runtime-pipeline.md — 変換境界の補足（runtime-pipeline.pfdsl の companion）

`runtime-pipeline.pfdsl` のグラフが運べない、変換境界に関する補足をここに置く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

この図は「システムが動くとき、データは何に変換されるか。変換の境界はどこか」だけに答える。
収録範囲は**判断を含まない決定的変換**である（ADR-0035）。
判断・承認・裁量が変換の一部であるものは workflow.pfdsl 側にあり、実行主体が人か LLM か機械かは判定に使わない。

互いに独立した3本のチェーンを持つ。

- **b層**: .pfdsl ドキュメント変換（source → 構文木 → 正準化グラフ → 各出力）
- **生成**: 一次ソース → リポ内生成物（スキル・install/・plugin・描画物）
- **配布・公開**: plugin → 採用リポ／ユーザー環境、タグ → npm・Marketplace

3本は互いにエッジで繋がらない。
`group` は成果物の存在様式（住処）で切り、層識別は `tags` で表す（両者は独立の軸）。

ファイルが実用上の限界に近づいた場合の分割候補は「読み手が完全に別」の線であり、b層（読み手は CLI ユーザー・VSCode 拡張ユーザー）と生成・配布（読み手はメンテナ・採用リポ）の間に入る。
現時点では分割していない。

## a-g 層との対応

- **a（言語仕様）**: `docs/spec/spec.md`。図に現れない — validate が適用する V/W ルールの根拠だが、実装へ反映されるのは設計時であり、実行時に読まれる入力ではないため
- **b（処理系）**: `tags: [b]` の process 群。実体は `@pfdsl/core` + `graphviz-exporter` + `preview-engine` + `metadata-exporter` の4パッケージ（各 process の `location` 参照）
- **c（PFD読み書き分析skill）**: `pfdsl_skill`。bのホストとしては図外（次節）だが、`gen_skill` の生成物であり `gen_plugin` の同梱素材でもあるため、その2つの役では図に現れる
- **d（VSCode拡張）**: `packages/vscode-extension/`。図に現れない — bのホストであり、データを供給も保管もしないため（次節）
- **e（a,bの配布）**: `push_cli_release_tag` / `publish_cli`、`push_libraries_release_tag` / `publish_libraries`、`package_vscode_release` / `verify_vsix` / `upload_vsix`。ADR-0035 までは workflow.pfdsl 側にあったが、release request 以降の変換に判断は入らないためこちらへ移した。リリース可否・版数の判断は workflow.pfdsl の3種の decide process が持ち、この図は kind ごとの release request を入力として受ける
- **f（PFD運用フレームワーク）**: `tags: [f1]`（L1+L2 汎用層）/ `tags: [f2]`（L3 GitHub Issues バックエンド層）。f2 は規約本文（`ops_skill_l3`）と採用テンプレート（`ops_install_templates`）の2 artifact に分かれる — 前者は手書き、後者は `gen_install` の生成物であり、生成経路も ADR-0035 でこの図へ移った（`ops_install_sources` → `gen_install` → `ops_install_templates`）。内容・retro フィードバックの一次情報は workflow.pfdsl の `ops_skill_general` / `ops_skill_l3`
- **g（fの配布）**: `tags: [g]` の process 群。make gen-plugin（Claude Code / Codex両対応の組み立て）・Claude Code plugin marketplace（既存のインストール経路）・check-install-sync.mjs（実配置とランタイム照合）が実装。`gen_plugin` と `gen_install` は生成でもあるため `gen` タグも併せ持つ

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
- **format（`formatter.ts`）**: ソーステキストから独立に再 lex/parse し整形済みテキストを生成する。check の parse 結果を再利用しない別経路。frontmatter は yaml CST（`frontmatter-cst.ts`）経由で正準化する（ADR-0034）
- **sort_meta（`sort.ts` の `sort(source, opts)`）**: 入力はソーステキスト（format と同じく独立再 parse）。構文木を受け取る経路ではない。frontmatter の並べ替えは yaml CST（`frontmatter-cst.ts`）経由（ADR-0034）
- **set_meta（`frontmatter-cst.ts` の `setFrontmatterField(source, kind, id, field, value)`）**: sort_meta と同じくソーステキストを入力に取り、指定ノードの指定フィールドだけを yaml CST 上で書き換える。対象ノードの定義が無い場合の新規挿入は `insert-definition.ts` が担う
- **reindex_meta（`reindex.ts` の `reindex(source, opts)`）**: ソーステキストを入力に取り、`computeTopoOrder` の順序に沿って `index` フィールドを採番し直す。位相順を要するため内部で `analyze()` を通す点が sort_meta / set_meta と異なる
- **render_graph（`graphviz-exporter` の `exportDot(graph, frontmatter)`）**: 正準化グラフと frontmatter（layout / title / statusStyles）から DOT 文字列を組む
- **export_image**: DOT→SVG は `@hpcc-js/wasm`（`preview-engine` の `renderDotToSvg`）で外部依存なし。PDF/PNG は `svgToBinary` が `puppeteer` を動的 import し、未インストール時は明示エラーで失敗する（フォールバックしない）
- **export_metadata（`metadata-exporter` の `extractMetadata(graph, frontmatter)`）**: VSCode 拡張の `pfdsl.export`（`export.ts`）のみが呼ぶ
- **diff_graphs（`diff.ts` の `diffGraphs(a, b, fmA, fmB)`）**: 入力は2組の（グラフ, frontmatter）。この図は単一ドキュメントの変換を軸にモデル化しているため、比較対象の2つ目は図上に現れない

生成・公開チェーン（ADR-0035 で workflow.pfdsl から移動）:

- **gen_skill（`scripts/gen-skill.mjs`）**: 一次ソース（skill-template / spec / samples / examples / review-perspectives）からリポ内 pfdsl スキルを組む。`references/*.md` の生成は `packages/cli/dist` に触れない `scripts/lib/gen-skill-refs.mjs` に切り出し済みで、SKILL.md（`pfdsl help` 埋め込み）のみ dist を必要とする（#586）。
同モジュールを単体で呼ぶ CLI エントリもあったが、`scripts/pre-commit` が呼び出しをやめた後は誰も起動しておらず削除した（#668）。
dist 非依存の手動再生成は `scripts/gen-plugin-dist-independent.mjs` が担う
- **gen_install（`scripts/lib/install-templates.mjs` の明示リスト）**: repo ルートの配布ソースから `install/` ミラーを一方向で再生成する。生成の向きは repo ルート → `install/` → `plugin/` の一本のみ（#547 で双方向 sync を廃止）
- **plugin root assembly（`scripts/gen-plugin.mjs`）**: `pnpm -r build && make gen-plugin` が、手書きのClaude Code source topologyとschemaを中立capability recordへdecodeして四target contractを検証し、その同じrecord objectから両ハーネスの出力を生成する。pfdsl skillの中立な生成正本は`generated/skills/pfdsl`であり、`.claude/skills/pfdsl`はそこへの生成symlinkなので手編集しない。Claude Code adapterはplugin tree・manifest・marketplace記述を`plugin/pfdsl/`へidentity互換に組み立てる。Codex adapterは生成済みClaude rootやmanifestを読まず、repositoryの`AGENTS.md`・`.agents/`・`.codex/`とnative skill tree・manifest・hooksを`plugin/pfdsl-codex/`へ生成する。公式Codex validator/runtimeはplugin rootの`skills/`を固定するため、二つのrootを混在させない。内部でgen_installを実行するため、pluginが古い`install/`から組まれることはない
- **render_previews（`make gen-samples`）**: 機能カタログとロードマップを dot/svg に描画する。`.dot` / README は graphviz-exporter、`.svg` は preview-engine の wasm graphviz で生成され、いずれも決定論的（#588）
- **push_cli_release_tag / publish_cli**: `make release` が `v*` tag を push し、その tag だけを起動条件として `publish-cli.yml` が `@pfdsl/cli` を npm publish する（Trusted Publishing / OIDC）
- **push_libraries_release_tag / publish_libraries**: `make release-libs` が `lib-v*` tag を push し、その tag だけを起動条件として `publish-libraries.yml` が core → graphviz-exporter → preview-engine の順で npm publish する
- **package_vscode_release / verify_vsix / upload_vsix**: `make vscode-package` は未検証 `.vsix` を生成し、成功後に `vscode-v*` tag を push する。1回の実行が正常完了したときの `.vsix` candidate と remote tag を同じ process の複数出力とし、tag に対応する publish workflow は置かない。人が candidate をローカルインストールして拡張の起動を確認した後、検証済み `.vsix` を marketplace.visualstudio.com へアップロードする

**判断の境界は kind ごとの release request にある。** リリースするか・どの版で切るかは workflow.pfdsl の `decide_cli_release` / `decide_libraries_release` / `decide_vscode_release` が判断し、request 以降の変換に判断は入らない。CLI と libraries は tag が対応する publish workflow をゲートする。VSCode拡張は `scripts/release.mjs` の実行順どおり `.vsix` 生成後に tag を push するが、tag 処理は `.vsix` ファイルを読まないため両者をデータ依存の別 process にせず、同じ process の必須出力として順序を description に記す。ローカル検証は candidate を実際に読む別 process であり、検証済み package だけを upload へ渡す。
そのため公開チェーン全体がこの図の収録対象になる。

**`verify_vsix` と `upload_vsix` はこの図の2つの人手ノードである。** どちらも判断を含まないため、実行主体が人であってもこちらに置く（ADR-0035）。
機械の変換チェーンに残る人手境界が、そのまま自動化候補の指摘になっている。
ローカルインストールの smoke test と marketplace の発行 API を使う経路を整えれば、それぞれのノードは消える。

## plugin 配布チェーンの依存

- **同梱対象リストの一元化（`harness_inventory`）**: 同梱スキル・コマンド・agent・hookと生成分類の一次情報に加え、各capabilityの`claude-repository`・`claude-plugin`・`codex-repository`・`codex-plugin` mappingは`scripts/lib/harness-inventory.mjs`が持つ。スキル・agentを追加するときは四targetすべてへnative・transform・intentional exclusionのいずれか一つを宣言する。PFD側の照合先はworkflow.pfdsl companionの「配布スキルの新規追加時の横断照合」が一次情報（ADR-0035以前の二重モデル化とその乖離の経緯もそちら）。
- **二重ハーネスのadapter境界**: `decode_harness_capabilities`がClaude Code固有のsource encodingを中立recordへ閉じ込め、`gen_plugin`と`assemble_codex_plugin`はcontract検証済みの同じrecord objectを兄弟入力としてそれぞれのrootを作る。Claude Code rootは`plugin/pfdsl/`、Codex native rootは`plugin/pfdsl-codex/`である。Codex adapterは生成済みClaude rootやmanifestを入力にせず、run固有のtemporary siblingへstageし、rootのassembly lock下でまとめて置換する。公式Codex validator/runtimeがroot直下の`skills/`を固定するため、異なるskill treeを単一rootに置かない。Codex plugin manifestのcapabilityは現在Skillsのみだが、同梱の`hooks/hooks.json`は既定discoveryで公開され、Codex runtimeの`CLAUDE_PLUGIN_ROOT`互換環境でhook commandを解決する。native agentとrepo-local hook設定はリポジトリの`.codex/`へ出力する。command skillの所有manifestは削除・改名後のstale dirを掃除し、commandとskillの出力名が衝突する場合はcommandを`source-command-<name>`へ改名する。
- **正本の移行余地と生成物**: inventoryが選ぶ手書きの`.claude`配布対象、`CLAUDE.md`、settings、hooksが現時点のsource decoder入力であり、生成済みpfdsl skillの正本だけは`generated/skills/pfdsl`に置く。`.claude/skills/pfdsl`はこの中立正本への生成symlinkであり、正本ではない。ほかのsourceを中立directoryへ移す場合はdecoderのsource pathだけを差し替え、capability ID・四target mapping・Claude Code / Codex出力のidentity契約を保つ。`plugin/pfdsl/`、`plugin/pfdsl-codex/`、`AGENTS.md`、`.agents/`、`.codex/`は生成物なので手編集しない。編集元を更新して`pnpm -r build && make gen-plugin`で中立pfdsl skill、二つのroot、repository assetsを再生成する。`check_plugin_drift`は実体を新たに作らず、Claude Code rootを正本と照合済みにした`claude_plugin_dist`、Codex rootを正本と照合済みにした`codex_plugin_dist`、repository assetsを正本と照合済みにした`verified_codex_repo_assets`を別成果物として出力する。distが無い場合は`node scripts/gen-plugin-dist-independent.mjs`でdist非依存部分を再生成し、gen-plugin-bulkが差分を照合できる。

## ハーネスsurface変更前の四target確認

Claude Code起点かCodex起点かを問わず、source topology、semantic schema、delivery mapping、output surfaceのいずれかを変更する前に、影響するcapabilityについて`claude-repository`・`claude-plugin`・`codex-repository`・`codex-plugin`の四targetすべての処分をnative・transform・intentional exclusionから一つずつ決める。
Nativeまたはtransformを選ぶtargetには、そのtargetの生成物だけを読むtarget-local consumer probeと対象output surfaceを同時に宣言する。
Intentional exclusionを選ぶtargetには、空でない理由と利用者への影響範囲を宣言し、そのcapabilityが対象targetへ混入しないfixtureを対応づける。
変更をadapter出力へ進める前に、source decoder closure、四target mappingの一意性、probe fixtureとの対応、各adapterのoutput closureが検査対象になっていることを確認する。
Claude outputをCodexの期待値に使わず、Codex outputをClaudeの期待値に使わない。各probeは対象targetのrootだけをfixtureとして読み、兄弟rootが無い状態でも成功しなければならない。
- **`deploy_install_layer` のコピー元は plugin 同梱 canonical**: `check-install-sync.mjs --deploy` は `<skill root>/install/` から採用リポルートへコピーする。ローカル編集された配置済みファイルは hash 不一致として skip・警告され、`--overwrite-local-edits` でのみ上書きされる（ADR-0028）。canonical から消えた旧ファイルは、ローカル編集が無ければフラグ無しで削除され、編集を抱えている場合のみ独立した `--delete-edited-orphans` を要する（#603。単一 `--force` は掃除の意図で渡したときに新パスのカスタマイズまで巻き戻した）。canonical 側のリネームで新旧パスが `missing` / `orphaned` に分かれた場合は `Possible renames` として対で報告され、旧パスのローカル編集を新パスへ引き継ぐ手掛かりになる。
このコピーの向きが成立するのは target が採用リポの場合だけなので、実行のたび target の役割を上流マーカーで分類し、上流リポ・canonical 不明と判定した回は `--deploy` を案内も実行もしない（#971）。
- **採用リポの drift 検知はランタイムのみ**: `check-pfd-ops-sync.yml` は採用リポへ配布されない。pfd-ops 発火時の `check_install_sync` が唯一の安全網で、警告への対応は pfd-ops SKILL.md「配置ファイルの鮮度セルフチェック」が定める。

## モデル化対象外のツール

`scripts/gate-check.mjs`・`scripts/pfdsl/audit-issues-flow.mjs`・`scripts/check-scaffold-sync.mjs` 等、PR ゲート・監査目的の開発者向けツールはこの図の対象外とする。pfdsl の実行時変換でも配布物でもなく、このリポ自身の開発フローを検証するメタツールのため。pfd-ops 終端ゲート「変換コンポーネントを追加・変更・削除した場合...」の判定で、この種のツールの新規追加・変更は該当なしと扱ってよい。

## エラー・例外処理

- `package_vscode_release` は正常完了時の出力をモデル化する。`.vsix` 生成後に tag 作成または push が失敗すると `.vsix` やローカル tag が残ることがあるが、remote に tag が無い限り release は未完了であり、それらの残存物を正常成果物とは扱わない。`verify_vsix` が失敗した場合は remote tag が残る一方、検証済み `vsix_package` は生産されず `upload_vsix` がブロックされる
- 診断は `severity: "error" | "warning"` を持つ。`check --strict` は一部の警告（例: V011 フィードバック検証）をエラー昇格させる
- `svgToBinary`（PDF/PNG化）は `puppeteer` が未インストールだと例外を投げる（メッセージ本文は `packages/graphviz-exporter/src/index.ts` が一次情報）。SVG化（wasm 経路）はこの依存を必要としない
- primary graph（`>>` / `->`）の循環は `check` が V010 error として検出する（`>>?` は対象外）。循環する構造は `>>?` か改版 artifact で表現する — pfdsl skill の品質ガイド参照
