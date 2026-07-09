# workflow.md — 運用手続き（workflow.pfdsl の companion）

`workflow.pfdsl` のグラフが運べない、複数ノードをまたぐ運用手続きをここに置く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## 知見の振り分け（3経路）

実践・レビューで得た知見は3経路に振り分ける:

1. **即時ルール化** — 配布スキル群の直接改訂。pfdsl スキルの品質ガイドは `quality_guide` artifact（= docs/quality-guide.md）を、スキル本文は `skill_template` artifact（= scripts/skill-template/SKILL.md）を、pfd-ops / pfd-retro / pfd-ecosystem は `.claude/skills/` 配下の SKILL.md・references を直接改訂する。スキル改善は issue を通さず対話から直接行う（`maintain_template` プロセス）
2. **設計決定** — ADR 起草（`docs/adr/`）。ADR 化した判断は適用ルールのガイド蒸留要否も判定する
3. **作業項目** — issue 起票 + 依存グラフ更新（`roadmap.pfdsl`。手段は roadmap.md 参照）

このリポが pfdsl スキルの上流であるため経路1（品質ガイド改訂）が成立する。配布先リポでは経路1は存在しない場合がある。

## 学習ループ

実践 → レビュー → ガイド改訂 → 再実践。ラウンド比較で「ルールで消えたミス / 残ったミス」を分離計測し、残ったものは lint 要件（ツール側）へ送る。根拠は ADR-0006「品質担保の二層構造 — ルールで防げるミスと防げないミス」。

ラウンド比較・lint 要件送りはツールチェーン開発を持つリポ固有の運用。

### 経路1判断のretrieval実証（PR #369）

品質ガイドを本文からポインタ2行へ抽出（`references/quality-guide.md`）した際、「ポインタを見て agent が実際に guide を Read するか」を empirical-prompt-tuning（Task-tool subagent dispatch）で検証した。runtime-pipeline実行ホストトラップ／roadmap命名トラップの2シナリオ×ポインタ版・抽出前インライン版の2アーム×2repsで計8体を dispatch。結果: ポインタアーム4/4で quality-guide.md 実 Read を確認、ルール遵守率もインライン版と同等（両アームともほぼ全項目○）。Iter 1で収束、劣化なし — 経路1でのガイド抽出は blank-slate executor に対しても機能する。

waxa CLI（blank-slate, ツール呼び出し不可）では retrieval 有無を測定できない制約を確認済み — 同種の抽出判断を検証する際は empirical-prompt-tuning（実 Read tool_uses 計測可）を使う。

## code-review / simplify の実施粒度

pfd-ops 終端ゲート「実装規模・品質基準は companion で定義」の実体はここ。
diff の規模に review の重さを合わせる。scoped な小〜中規模修正（数十行、1-2ファイル中心）に `/code-review` の高効度設定（8角度 finder × 候補ごと検証 agent、計10体以上の subagent 起動）をかけると diff サイズに対して過剰 — 軽い level（角度を絞る）を選ぶか、そもそも subagent を使わず自分で Read/Grep して直接レビューする。8角度並列 + 全候補検証の重量級構成は大規模 PR 向け。

## payoff_log 追記条件

PFD の効果を体感した局面は `docs/pfd_payoff_log.md`（`payoff_log` artifact）に **日付・局面・効果・参照** の形式で追記する。pfdsl の効果実証が目的（このリポ固有の動機）。

## spec バージョンの権威

**spec のバージョンはタイトル行（`# PFDSL仕様書 vX.Y.Z`）が唯一の権威。** §20 の changelog 節は変更点の記述であり、バージョンの確認に使わない。バージョンを参照・更新する際は必ずタイトル行を読み、タイトル行を更新してからコミットする。§20 冒頭やその他の本文で版番号を再記載しない（タイトル行との二重管理になり bump 時の同期漏れを生む。changelog 見出しの「vX.Y.Z からの主な変更点（vA.B.C）」形式は変更点の記述として許容する）。

## 実装 PR での spec 直接更新

issue が spec 変更を明示しており、変更が単一の制約節・severity 定義の修正程度の規模であれば、`spec_proposals` 文書を省略して実装 PR に spec.md 更新を含めてよい。省略の判断基準: 既存 proposal 不要・統合レビューの対称性チェックが不要なスコープ。

## spec_proposals ライフサイクル

`docs/spec/proposals/*.md` は `draft_proposals` が生成し `maintain_spec`（integrate フェーズ）が消費する中間成果物。

- **作成タイミング**: issue 着手時、spec 改版の起草フェーズ
- **消費**: `maintain_spec` で spec 本文に統合される
- **マージ後**: 削除しない。歴史的記録として残す（spec §20 の変更点リストと対になる証跡）
- **形式**: 概要 / 仕様変更 / 設計判断 / 影響範囲 の4セクション（詳細 + 完全チェックリストは ADR-0012）

### spec 直接変更（draft_proposals スキップ）の条件

実装 PR 内で spec に小規模追加を行う場合、`draft_proposals → spec_proposals → maintain_spec` 経路はスキップしてよい。スキップ可能条件:

- 変更が単一 issue の実装に付随する制約節（§15.X）と §16 への追記のみ
- 他の spec 提案との cross-validation が不要（既存節との矛盾・対称性チェックが自明）

上記を満たさない場合（新フィールド設計・複数節にまたがる変更・spec バージョン統合）は draft_proposals を経由する。

### 起草チェックリスト（最頻発ミス）

統合（`integrate_spec`）時の Opus 外部レビューで繰り返し指摘された項目:

- [ ] 型専用フィールドを追加した場合、逆型指定の error を制約節（§15.X）と §16 の両方に対称記載した
- [ ] 例示は front matter と flow edge が self-consistent（metadata フィールドを示す例は対応 edge も明示）

上記は個別 proposal 段階では見えず、統合時に他フィールドとの対称性比較で発覚する。`integrate_spec` では外部レビューを推奨する。

### 委譲時の入力（構造捏造の予防）

proposal 起草を subagent に委譲する場合、対象 spec の**現行 frontmatter キー構造・制約節番号**を委譲入力に明示する（`spec.md` の該当節を読ませる/grep させる）。渡さないと存在しない構造を捏造する（2026-06-20: spec に無い `presentation` ブロックを捏造 — review-perspectives A「入力充足」の委譲版。戻り後レビューで検出したが、入力を渡せば捏造自体を予防できる）。

## .pfdsl 変更後のスナップショット更新

`packages/core/src/__fixtures__/` 内のフィクスチャ `.pfdsl` を変更した場合、`pnpm --filter @pfdsl/core exec vitest run -u` でスナップショットを更新してからコミットする。pre-commit hook（`.pfdsl` staged 時）と CI の両方で更新漏れを自動検出する。`.pfdsl/roadmap.pfdsl` / `.pfdsl/workflow.pfdsl` 等の運用 PFD を変更してもスナップショットは変化しない（fixture ベースのため）。

## 生成物の再生成と自動ドリフト検査（gen-skill / gen-plugin / gen-samples / gen-readme-cli）

`docs/spec/spec.md` / `docs/samples/` を変更したら `make gen-skill`（スキル `references/`）・`make gen-samples`（サンプル `.dot` / README / `.svg`）で生成物を再生成する。`packages/cli/src/` の CLI コマンド定義を変更したら `make gen-readme-cli`（README `## CLI` セクション）で再生成する。`.claude/skills/pfd-ecosystem` / `.claude/skills/pfd-retro` / `.claude/commands/pfd-cycle.md` / `.claude/commands/pfd-init.md` または gen-skill の入力を変更したら `make gen-plugin`（`plugin/pfdsl/`、marketplace 配布プラグイン）で再生成する。再生成漏れは機械的に検出されるため手動チェックは不要 — gen-skill / gen-plugin の identity は pre-commit（各々の入力 staged 時）と CI（check-gen-skill.yml）、`.dot` / README のドリフトは graphviz-exporter の vitest テスト（pre-commit の `docs/samples/` staged 時と CI test）、README `## CLI` セクションのドリフトは `make check-readme-cli`（pre-commit の `packages/cli/src/` / `README.md` staged 時と CI test.yml）が検査する。`.svg` は graphviz バージョン依存のため検査対象外（roadmap.md ゲート参照）。

**`make gen-readme-cli` 前のビルド**: pre-commit の README drift 検査は `packages/cli/dist/cli.js` を実行して `pfdsl help` 出力を取得する。`packages/cli/src/` を変更した後、コミット前に `pnpm --filter @pfdsl/cli build`（または `pnpm -r build`）を済ませておかないと、dist が古いまま生成・検査され、新コマンドの追加が README に反映されずに通過する。

**出力抑制**: `make gen-samples` / `make gen-skill` は pnpm 全パッケージビルド + 全サンプル check の warning を毎回出力するため数百行に及ぶ。実行後は `git status --short docs/samples/ .claude/skills/pfdsl/ skills/pfdsl/` で変更ファイルのみ確認すれば足りる（ビルド自体の成否は非ゼロ終了コードで分かる）。

## 新 frontmatter フィールド追加時の sample 追加

frontmatter に新フィールドを追加する develop では、対応する `docs/samples/` のサンプルファイルを同一 PR で追加する（「フィールドが仕様にあるがサンプルに示されていない」状態を防ぐ設計ルール）。生成物の再生成・ドリフト検査は上記のとおり機械的に強制される。

## VS Code 拡張の UI 動作確認

`vscode-extension` の挙動変更（webview インタラクション・クリック動作等）を含む develop は、PR 作成前に `/vscode-ext-debug` スキルを用いてビルド後の実動作を確認する。確認結果をユーザーから受け取るまでサイクル完了とみなさない（pfd-ops 手順2）。

## flow:exempt issue の roadmap 追加除外

判定基準・タイミングは L3 reference（`github-issues-backend.md`「ラベル判定基準」）が一次情報。`file_issues` の「起票と同時に roadmap 追加」ルールの例外。

## develop 着手時の artifact status 更新

汎用ルール（着手時 todo→wip、PR を待たない）は pfd-ops プロトコル「進捗更新」が一次情報。このリポでは flow-sync が merge 後に `done` へ自動遷移させるが、`todo` → `wip` は人手のため着手と同時に行う。

## 複数 issue を一括実装する場合のバージョン戦略

複数の実装 issue を1つの PR に束ねる場合、中間バージョンの publish を省略してよい。ただし **選択判断は着手前に明示する**:

- roadmap の中間バージョン artifact（例: `cli_tool_v0010`）の扱い（スキップ / 統合 / 後日 publish）を PR body に記述する
- スキップする場合は「#NNN と #MMM を同一バージョンに統合し中間 publish を省略」と明記する

省略判断を暗黙にすると roadmap の依存構造と実態が乖離する。

## hotfix 運用（issue 省略）

判定3条件と省略規則は L3 reference（`github-issues-backend.md`「hotfix 運用」）が一次情報。このリポでは `[gh_issues, roadmap_pfdsl, spec] >> develop` 通常経路の例外ケースに当たる。

## コアライブラリ型を拡張する場合の設計判断

vscode-extension 等で新しいノード種別をホバー対応する場合、「`NodeKind`（コア公開型）に追加する」vs「provider 内で独自チェックする」の選択が生じる。判断基準: `analyze()` の `nodeKinds` マップに新種別が自然に乗る（frontmatter でスコープが確定する）なら型に追加する。provider ローカルの一時的な判定なら独自チェックにとどめる。コアへの変更は全パッケージの再ビルドと `Record<NodeKind, ...>` の exhaustive check 修正が必要になるため、影響範囲を確認してから選択する。

## CI成果物の格納先変更時の workflow.pfdsl 更新

CI が生成・push する成果物（`pr_diagrams` 等）の格納先・push 方式を変える PR では、対応する `workflow.pfdsl` artifact の `description` / `criteria` / `location` を同一 PR で更新する。格納先の変更は artifact の定義を変えるため、workflow 図と実装が乖離する。

## 終端ゲートの根拠

汎用ゲート項目（status 更新 / check 通過 / 論理単位コミット / PR 集約）に加え、このリポでは issue 固有項目を合成する。issue 固有項目は `roadmap.md` を参照。
