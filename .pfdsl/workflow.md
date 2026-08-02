# workflow.md — 運用手続き（workflow.pfdsl の companion）

`workflow.pfdsl` のグラフが運べない、複数ノードをまたぐ運用手続きをここに置く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## 知見の振り分け（3経路）

実践・レビューで得た知見は3経路に振り分ける:

1. **即時ルール化** — 配布スキル群の直接改訂。pfdsl スキルの品質ガイドは `quality_guide` artifact（= docs/quality-guide.md）を、スキル本文は `skill_template` artifact（= scripts/skill-template/SKILL.md）を、pfd-grill / pfd-ops / pfd-retro / pfd-ecosystem は `.claude/skills/` 配下の SKILL.md・references を直接改訂する。スキル改善は issue を通さず対話から直接行う（`maintain_template` プロセス）
2. **設計決定** — ADR 起草（`docs/adr/`）。ADR 化した判断は適用ルールのガイド蒸留要否も判定する
3. **作業項目** — issue 起票 + 依存グラフ更新（`roadmap.pfdsl`。手段は roadmap.md 参照）

このリポが pfdsl スキルの上流であるため経路1（品質ガイド改訂）が成立する。配布先リポでは経路1は存在しない場合がある。

**散文として書く前に機械化を検討する**: 上記いずれかの経路で companion 等に散文を追記する前に、その内容が機械判定できるか（コマンド文字列・ファイルパス・git の状態から決まるか）を確認する。機械判定できるなら、原則として hook 化が散文に優先する — 散文は読まれて初めて効くが、hook は毎回必ず発火する。散文にとどめてよいのは例外に当たる場合だけで、例外は2つ: (a) 守り忘れたときのコストが警告を出すコスト（hook の実装・維持・誤発火の煩わしさ）を明確には上回らない、(b) 既存機構（pre-commit・gate-check・CI）が既に同じ対象を検査しており hook が重複になる。どちらにも当たらないなら hook 化を先に済ませ、散文はその後で書く。

hook 化した場合、散文は「hook の deny/advisory メッセージが全情報を運ぶなら書かない」「hook でカバーしきれない残りだけを書く」のどちらかにとどめる — hook へのポインタを機械的に書き足すだけでは、メッセージと重複する散文が残る（#650 の retro で発覚。#650 本文の3条件は、機械判定できる候補が複数出揃った状況でどれに着手するかを絞り込む AND フィルタであり、書く前の毎回の判断にそのまま持ち込むと機械化優先の原則が弱まる）。

## 学習ループ

実践 → レビュー → ガイド改訂 → 再実践。ラウンド比較で「ルールで消えたミス / 残ったミス」を分離計測し、残ったものは lint 要件（ツール側）へ送る。根拠は ADR-0006「品質担保の二層構造 — ルールで防げるミスと防げないミス」。

ラウンド比較・lint 要件送りはツールチェーン開発を持つリポ固有の運用。

### 経路1判断のretrieval実証（PR #369）

品質ガイドを本文からポインタ2行へ抽出（`references/quality-guide.md`）した際、「ポインタを見て agent が実際に guide を Read するか」を empirical-prompt-tuning（Task-tool subagent dispatch）で検証した。runtime-pipeline実行ホストトラップ／roadmap命名トラップの2シナリオ×ポインタ版・抽出前インライン版の2アーム×2repsで計8体を dispatch。結果: ポインタアーム4/4で quality-guide.md 実 Read を確認、ルール遵守率もインライン版と同等（両アームともほぼ全項目○）。Iter 1で収束、劣化なし — 経路1でのガイド抽出は blank-slate executor に対しても機能する。

waxa CLI（blank-slate, ツール呼び出し不可）では retrieval 有無を測定できない制約を確認済み — 同種の抽出判断を検証する際は empirical-prompt-tuning（実 Read tool_uses 計測可）を使う。

## code-review / simplify の実施粒度

原則（diff の規模に review の重さを合わせる）は配布層（pfd-ops `references/work-cycle.md` 手順3）が一次情報。
ここにはこのリポの基準値のみを書く。

- 軽い側: 数十行・1〜2ファイル中心。角度を2〜4に絞るか、委譲せず自分で Read/Grep する
- 重い側: `/code-review` の既定 fan-out（8角度 finder × 候補ごと検証 agent、計10体以上の subagent 起動）は大規模 PR 向け

## payoff_log 追記条件

PFD の効果を体感した局面は `docs/pfd_payoff_log.md`（`payoff_log` artifact）に **日付・局面・効果・参照** の形式で追記する。pfdsl の効果実証が目的（このリポ固有の動機）。

## spec バージョンの権威

**spec のバージョンはタイトル行（`# PFDSL仕様書 vX.Y.Z`）が唯一の権威。** `docs/spec/spec-history.md` の changelog は変更点の記述であり、バージョンの確認に使わない。バージョンを参照・更新する際は必ずタイトル行を読み、タイトル行を更新してからコミットする。changelog 冒頭やその他の本文で版番号を再記載しない（タイトル行との二重管理になり bump 時の同期漏れを生む。changelog 見出しの「vX.Y.Z からの主な変更点（vA.B.C）」形式は変更点の記述として許容する）。

## 実装 PR での spec 直接更新

issue が spec 変更を明示しており、変更が単一の制約節・severity 定義の修正程度の規模であれば、`spec_proposals` 文書を省略して実装 PR に spec.md 更新を含めてよい。省略の判断基準: 既存 proposal 不要・統合レビューの対称性チェックが不要なスコープ。

## spec_proposals ライフサイクル

`docs/spec/proposals/*.md` は `draft_proposals` が生成し `maintain_spec`（integrate フェーズ）が消費する中間成果物。

- **作成タイミング**: issue 着手時、spec 改版の起草フェーズ
- **消費**: `maintain_spec` で spec 本文に統合される
- **マージ後**: 削除しない。歴史的記録として残す（`docs/spec/spec-history.md` の変更点リストと対になる証跡）
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

`docs/spec/spec.md` / `docs/samples/` を変更したら `make gen-skill`（スキル `references/`）・`make gen-samples`（サンプル `.dot` / README / `.svg`）で生成物を再生成する。`packages/cli/src/` の CLI コマンド定義を変更したら `make gen-readme-cli`（README `## CLI` セクション）で再生成する。`.claude/skills/pfd-grill` / `.claude/skills/pfd-ops` / `.claude/skills/pfd-retro` / `.claude/skills/pfd-ecosystem` / `.claude/agents/pfd-lens.md` / `.claude/commands/pfd-cycle.md` / `.claude/commands/pfd-init.md` / `.claude/commands/pfd-retro.md` または gen-skill の入力を変更したら `make gen-plugin`（`plugin/pfdsl/`、marketplace 配布プラグイン。gen-skill 分は内部で自動実行）で再生成する（ADR-0028 で pfd-ops も同梱対象に追加）。再生成漏れは機械的に検出されるため手動チェックは不要 — gen-skill / gen-plugin の identity は pre-commit（各々の入力 staged 時）と CI（check-gen-plugin.yml）、`.dot` / README のドリフトは graphviz-exporter の vitest テスト、`.svg` のドリフトは preview-engine の vitest テスト（いずれも pre-commit の `docs/samples/` staged 時と CI test）、README `## CLI` セクションのドリフトは `make check-readme-cli`（pre-commit の `packages/cli/src/` / `README.md` staged 時と CI test.yml）が検査する。`references/*.md` を含む plugin/ の dist 非依存部分（install/ ミラー・静的 skills・commands・agents・hooks・plugin.json・skill references）は `scripts/gen-plugin-dist-independent.mjs` が生成し、pre-commit は dist 必須の SKILL.md 検査とは別の check_drift でこれを常時検査する。dist が stale で gen-skill / gen-plugin の SKILL.md 部分の検査が skip されても、このドリフトはここで止まる（#593。前身は #586 の references 専用検査で、粒度拡張の経緯は `scripts/pre-commit` の当該コメントが一次情報）。

**dist 鮮度の機械検査**: pre-commit の drift 検査（README `## CLI` セクション・gen-skill の SKILL.md 部分・gen-plugin）は対象 dist（`packages/cli/dist/cli.js` 等）を実行または import して出力を取得する。`scripts/lib/dist-freshness.mjs` が dist の mtime を sibling `src/` の最新 mtime と比較し、dist が存在しない場合と同様に古い場合も検査を skip して「run 'pnpm -r build'」を促す（#450/#452）。skip は「検査対象が信頼できないので判定を CI に委ねる」意味であり、ローカルで検査 PASS しなかったからといって drift が無いとは限らない — コミット前に `pnpm -r build` を済ませて skip を解消してから判断する。gen-skill の `references/*.md` 部分と gen-plugin の SKILL.md 以外の部分は dist に触れないため、この skip の影響を受けない（#586 / #593）。

**pfd-ops `install/` は生成物**: `.claude/skills/pfd-ops/install/**` は手編集しない。
生成の構造（ソース・生成器・向き）は `workflow.pfdsl` の `ops_install_sources >> gen_install -> ops_install_templates` が一次情報 — ここには手続きだけを書く。
配布対象は `scripts/lib/install-templates.mjs` の明示リストが決める（`scripts/pfdsl/` には配布しない repo ローカルの `*.test.mjs` が同居するため、glob でなく明示リストにしている）。
テンプレートを増減したらこのリストも更新する。

drift 検査は pre-commit（`gen-install` の check_drift。他の drift 検査と違い dist を要求しないので、ビルド未実施でもローカルで走る）と CI（`check-pfd-ops-sync.yml`）が行う。
生成側を手編集した場合も、再生成が作業ツリーの手編集を上書きしたうえで検査が落ちる。
テンプレートのソースを変更したコミットは再ステージが2往復必要になる（1回目で `install/`、2回目で `plugin/`）。
2ホップの生成チェーンに「直して exit 1」の流儀を適用した結果であり、意図した挙動である。

**生成物 drift 検査はコミット分割を制約する**: 規則は配布層（pfd-ops `references/work-cycle.md` のコミット粒度ゲート）が一次情報。このリポで該当する検査は `gen-plugin`（生成元 `.claude/skills/pfd-*` 等 → 生成物 `plugin/`）と `gen-install`。

**出力抑制**: `make gen-samples` / `make gen-skill` は pnpm 全パッケージビルド + 全サンプル check の warning を毎回出力するため数百行に及ぶ。実行後は `git status --short docs/samples/ .claude/skills/pfdsl/ plugin/pfdsl/` で変更ファイルのみ確認すれば足りる（ビルド自体の成否は非ゼロ終了コードで分かる）。

**配布スキルの新規追加時の横断照合**: 新しい配布スキル（`.claude/skills/pfd-*`）を追加したら、`grep -rn "<既存スキルID>\b" .pfdsl/ scripts/` で既存の兄弟スキル（例: `retro_skill`）の全参照箇所を洗い出し、新スキルにも同じ箇所が揃っているか1つずつ照合する。照合先は2箇所である。

- `workflow.pfdsl` の `distill_ops` 出力エッジ（スキルの一次情報としての生産）
- `runtime-pipeline.pfdsl` の `gen_plugin` 入力エッジ（同梱素材としての消費）

`scripts/gen-plugin.mjs` の静的リストと `plugin.json` description は pre-commit の drift 検査が機械的に強制するが、PFD 側のこれらのエッジは check で強制されず目視追随に依存する（#481 で `grill_skill` 追加時に発見。当初3箇所を見落とし、pfd-retro の A層「同種対称性」監査で気付いた）。

照合先は ADR-0035 の描き直しで4箇所から2箇所に減った。旧 `publish_cli` 入力エッジは判断部分が `decide_release` になり素材列挙を持たなくなり、`runtime-pipeline.pfdsl` の旧 `assemble_plugin` は `workflow.pfdsl` の旧 `gen_plugin` と同一物の二重モデル化だったため統合した。実際にこの二重化は `pfd_lens_agent` / `implementer_agent` が片方の図にしか無いという乖離を生んでいた。

**判断軸による分担（ADR-0035）**: 判断を含まない生成・公開の変換は `runtime-pipeline.pfdsl` が持つ。`make gen-skill` / `make gen-install` / `make gen-plugin` / `make gen-samples` と、タグ push 以降の npm publish・vsix 生成・marketplace アップロードがそちらにある。この図に残るのは「リリースするか・どの版で切るか」の判断（`decide_release`）までである。生成コマンドの手続き・drift 検査の話はこの companion が引き続き一次情報として持つ（グラフで運べない散文のため）。

**`pfdsl_skill` は `graph orphans` に出る**: `runtime-pipeline.pfdsl` の `gen_skill` が生産する境界 artifact であり、この図では `>>?` フィードバック入力としてのみ現れる。primary エッジを持たないため `graph orphans` が報告するが、これは能力成果物が世代をまたいで還流する形（ADR-0011）の帰結であって欠陥ではない。

**生成の一次ソースは `graph io` の終端に出る（ADR-0035 の副作用）**: `skill_template` / `quality_guide` / `feature_samples` / `review_perspectives` / `release_tag` と、`distill_ops` が生産する配布スキル・agent 群は、この図では消費者を持たない終端 artifact として報告される。消費者（`gen_skill` / `gen_plugin` / `publish_packages` / `package_vsix`）は `runtime-pipeline.pfdsl` 側に実在するが、`graph io` はファイル単位で走るため参照できない。

**これらに `todo` プレースホルダの消費者を立てない。** 立てると ADR-0035 が解消した二重モデル化（同一変換を2ファイルが別ノードIDで持つ状態）を作り直すことになる。終端ゲートのプロトコル5(b) 判定では「消費者は sibling の `runtime-pipeline.pfdsl` に在る」と記録して該当なしとする。判定時は `.pfdsl/runtime-pipeline.pfdsl` の `gen_skill` / `gen_plugin` / `publish_packages` / `package_vsix` の入力エッジに当該 artifact が列挙されているかを確認する — 列挙が無ければそれは本物の門番違反である。

## 配布プロンプトのレビューと承認記録（`review_distribution`）

`make release` は `docs/distribution-review/reviewed.json` の commit と HEAD の間に配布 `.md` の差分があると pre-tag checks で止まる。
逃げ道は用意していない。
公開は稀で、かつ利用側が実際にその散文を渡される唯一の瞬間なので、その希少性自体を起動条件に使っている（ADR-0029 が起動条件ゼロで休眠した反省）。

**hash を進めるのは差分モードだけである。**
全文モードは実行記録と修正だけを残す。
全体を見る分ひとつの変更に対する解像度が差分モードに劣るため、これで承認済みとすると差分観点の穴を見逃したまま記録が進む。
全文モードで直したものは未レビュー差分として残り、次の差分モードが必ず拾う。

**記録コミットで配布プロンプトを触らないこと。**
触ると記録が指す内容と HEAD の内容がその場でずれ、自分で自分を無効化する。
修正は先にコミットし、`reviewed.json` の更新は別コミットにする。

**`distribution_review_skill` は終端 artifact として報告される。**
`distill_ops` が生産し、`review_distribution` へは `>>?` でしか入らないため、primary の消費エッジを持たない。
能力成果物が世代をまたいで還流する形（ADR-0011）の帰結であって欠陥ではない。
`pfdsl_skill` と違い消費者は sibling の `runtime-pipeline.pfdsl` に**無い** — このスキルは配布されないので `gen_plugin` の入力にならない。
終端ゲートのプロトコル5(b) 判定では、手段（能力成果物）であり後続門番を要さないものとして扱う。

**この手順は配布しない。**
`.claude/skills/distribution-review/` は repo-local であり、上の「配布スキルの新規追加時の横断照合」の対象外である（`runtime-pipeline.pfdsl` の `gen_plugin` 入力エッジに足さない）。
利用側リポには配布という行為自体が無く、この手順の実施先が存在しない。
`spec_stress_skill` / `vscode_ext_debug_skill` と同じ扱いで、`distill_ops` の出力にだけ現れる。

## 新 frontmatter フィールド追加時の sample 追加

frontmatter に新フィールドを追加する develop では、対応する `docs/samples/` のサンプルファイルを同一 PR で追加する（「フィールドが仕様にあるがサンプルに示されていない」状態を防ぐ設計ルール）。生成物の再生成・ドリフト検査は上記のとおり機械的に強制される。

## VS Code 拡張の UI 動作確認

`vscode-extension` の挙動変更（webview インタラクション・クリック動作等）を含む develop は、PR 作成前に `/vscode-ext-debug` スキルを用いてビルド後の実動作を確認する。確認結果をユーザーから受け取るまでサイクル完了とみなさない（pfd-ops 手順2）。

## subagent へ worktree 作成を委譲する場合の安全確認

`.claude/agents/` の agent に worktree 作成を含むフローを委譲する場合、`superpowers:using-git-worktrees` skill の Step 0（既存 isolation 検出時は再利用）を素通しにしない。subagent は呼び出し元セッションが使用中の worktree 内で起動されることがあり、Step 0 はその共有 worktree を「既存の分離ワークスペース」と誤認識して乗っ取る（issue #439 の issue-worker 試走で発生。呼び出し元ブランチは無傷で復旧できたが、一歩間違えば作業中のコミット履歴を破壊しかねない）。agent 定義側で「Step 0 をバイパスし常に新規 worktree を作成する」旨を明記する（例: `.claude/agents/issue-worker.md`）。

## 委譲先の外向き操作の制御（3層）

3層の**原則**は配布層（pfd-ops `references/work-cycle.md` 手順2）が一次情報（#558 で昇格）。
ここにはこのリポの実装値のみを書く。

**1. agent の選択。** 実装だけを委譲するなら `pfd-implementer`（`tools:` に `mcp__github__*` を含まない）。
`general-purpose` は `tools: *` で GitHub MCP を丸ごと持つので、実装委譲には使わない。
worktree 作成から PR 作成までを一気通貫でやらせる場合のみ `issue-worker` を使う。
`pfd-implementer.md` は `gen_plugin` が plugin へミラーする配布物でもあるため、リポ固有の agent 名・スクリプトパスを本文に書かない。

**2. PreToolUse hook。** 実装は `scripts/delegation-guard.mjs`、allowlist は `scripts/lib/delegation-guard.mjs` の `DEFAULT_ALLOWED_AGENTS`。
`settings.json` の `permissions.deny` を使わないのは、プロジェクト全体に効いて呼び出し元と `issue-worker` まで巻き込むため。

**3. 戻り時の検出。** 汎用手順のまま（`git log origin/<branch>..HEAD` と open PR 一覧の突合）。このリポ固有の追加値はない。

## flow:exempt issue の roadmap 追加除外

判定基準・タイミングは L3 reference（`github-issues-backend.md`「ラベル判定基準」）が一次情報。`file_issues` の「起票と同時に roadmap 追加」ルールの例外。

## develop 着手時の artifact status 更新

汎用ルール（着手時 todo→wip、PR を待たない）は pfd-ops プロトコル「進捗更新」が一次情報。このリポでは flow-sync が merge 後に `done` へ自動遷移させるが、`todo` → `wip` は人手のため着手と同時に行う。

## release milestone artifact の作成規約

roadmap の CLI release milestone（`cli_release_<slug>` 等）はバージョン番号の事前予約ではない。**下流作業がそれを入力として要求する時点**でのみ作成する（pfd-ops プロトコル2・5の適用）。バージョン番号は roadmap 本体に書かず、done 後の label/criteria に事実として付記するのみ — 番号を先に書いて後から実態と合わせる運用（#278 導入前の運用）は廃止した。

複数の実装 issue を1つの PR/リリースに束ねる場合も、milestone ノードは束ねた内容を表す1つの slug で作成すればよい。「中間バージョンをスキップ/統合するか」という判断自体が発生しない — バージョン番号を roadmap に書かないため、スキップ対象になるバージョン番号付きノードが最初から存在しない。

`make release cli` は roadmap 上 ready になった `publish_cli_*` プロセスの出力を機械的に done 化する（バージョン番号からの artifact ID 逆算はしない）。計画外リリースで ready な milestone が無ければ何もしない。

## hotfix 運用（issue 省略）

判定3条件と省略規則は L3 reference（`github-issues-backend.md`「hotfix 運用」）が一次情報。このリポでは `[gh_issues, roadmap_pfdsl, spec] >> develop` 通常経路の例外ケースに当たる。

## コアライブラリ型を拡張する場合の設計判断

vscode-extension 等で新しいノード種別をホバー対応する場合、「`NodeKind`（コア公開型）に追加する」vs「provider 内で独自チェックする」の選択が生じる。判断基準: `analyze()` の `nodeKinds` マップに新種別が自然に乗る（frontmatter でスコープが確定する）なら型に追加する。provider ローカルの一時的な判定なら独自チェックにとどめる。コアへの変更は全パッケージの再ビルドと `Record<NodeKind, ...>` の exhaustive check 修正が必要になるため、影響範囲を確認してから選択する。

## CI成果物の格納先変更時の workflow.pfdsl 更新

CI が生成・push する成果物（`pr_diagrams` 等）の格納先・push 方式を変える PR では、対応する `workflow.pfdsl` artifact の `description` / `criteria` / `location` を同一 PR で更新する。格納先の変更は artifact の定義を変えるため、workflow 図と実装が乖離する。

## 終端ゲートの根拠

汎用ゲート項目（status 更新 / check 通過 / 論理単位コミット / PR 集約）に加え、このリポでは issue 固有項目を合成する。issue 固有項目は `roadmap.md` を参照。
