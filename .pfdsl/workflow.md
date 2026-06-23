# workflow.md — 運用手続き（workflow.pfdsl の companion）

`workflow.pfdsl` のグラフが運べない、複数ノードをまたぐ運用手続きをここに置く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## 知見の振り分け（3経路）

実践・レビューで得た知見は3経路に振り分ける:

1. **即時ルール化** — pfdsl スキルの品質ガイド改訂（`skill_template` artifact = scripts/gen-skill.mjs 内）。スキル改善は issue を通さず対話から直接行う（`maintain_template` プロセス）
2. **設計決定** — ADR 起草（`docs/adr/`）。ADR 化した判断は適用ルールのガイド蒸留要否も判定する
3. **作業項目** — issue 起票 + 依存グラフ更新（`roadmap.pfdsl`。手段は roadmap.md 参照）

このリポが pfdsl スキルの上流であるため経路1（品質ガイド改訂）が成立する。配布先リポでは経路1は存在しない場合がある。

## 学習ループ

実践 → レビュー → ガイド改訂 → 再実践。ラウンド比較で「ルールで消えたミス / 残ったミス」を分離計測し、残ったものは lint 要件（ツール側）へ送る。根拠は ADR-0006「品質担保の二層構造 — ルールで防げるミスと防げないミス」。

ラウンド比較・lint 要件送りはツールチェーン開発を持つリポ固有の運用。

## payoff_log 追記条件

PFD の効果を体感した局面は `docs/pfd_payoff_log.md`（`payoff_log` artifact）に **日付・局面・効果・参照** の形式で追記する。pfdsl の効果実証が目的（このリポ固有の動機）。

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

proposal 起草を subagent に委譲する場合、対象 spec の**現行 frontmatter キー構造・制約節番号**を委譲入力に明示する（`spec.md` の該当節を読ませる/grep させる）。渡さないと存在しない構造を捏造する（2026-06-20: spec に無い `presentation` ブロックを捏造 — review-prompts A「入力充足」の委譲版。戻り後レビューで検出したが、入力を渡せば捏造自体を予防できる）。

## .pfdsl 変更後のスナップショット更新

`.pfdsl` ファイルを人手変更した場合、`pnpm --filter @pfdsl/core exec vitest run -u` でスナップショットを更新してからコミットする。pre-commit hook（`.pfdsl` staged 時）と CI の両方で更新漏れを自動検出する。

## spec.md 変更後の gen-skill 実行

`docs/spec/spec.md` を変更した場合、`make gen-skill` を実行してからコミットする。スキルの `references/spec.md` が spec 本文と一致していないと CI（check-gen-skill.yml）で失敗する。

## 新 frontmatter フィールド追加時の sample 更新

frontmatter に新フィールドを追加する develop では、対応する `docs/samples/` のサンプルファイルを同一 PR で更新し、`make gen-samples` を実行してからコミットする。feature sample の更新漏れは「フィールドが仕様にあるがサンプルに示されていない」状態になる。詳細は roadmap.md ゲート参照。

## VS Code 拡張の UI 動作確認

`vscode-extension` の挙動変更（webview インタラクション・クリック動作等）を含む develop は、PR 作成前に `/vscode-ext-debug` スキルを用いてビルド後の実動作を確認する。確認結果をユーザーから受け取るまでサイクル完了とみなさない（pfd-ops 手順2）。

## flow:exempt issue の roadmap 追加除外

`flow:exempt` ラベルの issue は roadmap_pfdsl への artifact 追加対象外。`file_issues` の「起票と同時に roadmap 追加」ルールの例外。起票時に `flow:exempt` / `flow:managed` を判定してから roadmap 追加要否を決める。

## 複数 issue を一括実装する場合のバージョン戦略

複数の実装 issue を1つの PR に束ねる場合、中間バージョンの publish を省略してよい。ただし **選択判断は着手前に明示する**:

- roadmap の中間バージョン artifact（例: `cli_tool_v0010`）の扱い（スキップ / 統合 / 後日 publish）を PR body に記述する
- スキップする場合は「#NNN と #MMM を同一バージョンに統合し中間 publish を省略」と明記する

省略判断を暗黙にすると roadmap の依存構造と実態が乖離する。

## hotfix 運用（issue 省略）

バグ修正で以下をすべて満たす場合、issue 起票・roadmap_pfdsl 更新を省略してよい:

- spec・仕様変更を伴わない（既存動作の回復のみ）
- PR 単体で完結し、依存解放を要しない
- PR description に "hotfix" と明記する

`[gh_issues, roadmap_pfdsl, spec] >> develop` の通常経路の例外ケース。issue なし develop は hotfix のみに限る。

**develop 開始前に hotfix 判定を行う。** 上記3条件を確認してから issue 起票・roadmap 追加の要否を決める。条件確認前に issue 起票・roadmap 追加を開始しない。

## CI成果物の格納先変更時の workflow.pfdsl 更新

CI が生成・push する成果物（`pr_diagrams` 等）の格納先・push 方式を変える PR では、対応する `workflow.pfdsl` artifact の `description` / `criteria` / `location` を同一 PR で更新する。格納先の変更は artifact の定義を変えるため、workflow 図と実装が乖離する。

## pfd-retro バインディング

A・B 層カタログ（図の監査プロンプト一覧）: `docs/review-prompts.md`

PFD 採用状況: roadmap（`.pfdsl/roadmap.pfdsl`）・workflow（`.pfdsl/workflow.pfdsl`）を採用。runtime-pipeline 未採用。

出力宛先は「知見の振り分け（3経路）」セクションに従う。companion への書き分け（どの companion に書くか）は `.claude/skills/pfd-ops/references/architecture.md` の「companion への書き分けルール」表が一次情報。

## 終端ゲートの根拠

汎用ゲート項目（status 更新 / check 通過 / 論理単位コミット / PR 集約）に加え、このリポでは issue 固有項目を合成する。issue 固有項目は `roadmap.md` を参照。
