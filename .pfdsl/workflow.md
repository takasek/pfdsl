# workflow.md — 運用手続き（workflow.pfdsl の companion）

`workflow.pfdsl` のグラフが運べない、複数ノードをまたぐ運用手続きをここに置く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## 知見の振り分け（3経路）

実践・レビューで得た知見は3経路に振り分ける:

1. **即時ルール化** — 配布スキル群の直接改訂。pfdsl スキルの品質ガイドは `quality_guide` artifact（= docs/quality-guide.md）を、スキル本文は `skill_template` artifact（= scripts/skill-template/SKILL.md）を直接改訂する（`maintain_template` プロセス）。pfd-grill / pfd-ops / pfd-retro / pfd-ecosystem は `.claude/skills/` 配下の SKILL.md・references を直接改訂する（`distill_ops` プロセス。リポローカルスキルは `distill_local_skills`、bindings・companion・ガード機構は `externalize_bindings` — #672 で分割）。スキル改善は issue を通さず対話から直接行う
2. **設計決定** — ADR 起草（`docs/adr/`）。ADR 化した判断は適用ルールのガイド蒸留要否も判定する
3. **作業項目** — issue 起票 + 依存グラフ更新（`roadmap.pfdsl`。手段は roadmap.md 参照）

このリポが pfdsl スキルの上流であるため経路1（品質ガイド改訂）が成立する。配布先リポでは経路1は存在しない場合がある。

散文として書く前の機械化の検討と、hook で機械化する場合に決定を選ぶ軸（防ぎたい害が実行そのものか、結果の読み違いか）は、pfd-ops SKILL.md のプロトコル6が一次情報。
このリポの既存機構は pre-commit・`gate-check.mjs`・CI であり、例外 (b)（重複になる）の判定はこの3つに対して行う。
#650 本文の3条件は、機械判定できる候補が複数出揃った状況でどれに着手するかを絞り込む AND フィルタであり、書く前の毎回の判断にそのまま持ち込むと機械化優先の原則が弱まる。

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

**changelog エントリは maintain_spec（統合フェーズ）でタイトル行 bump と同じ作業の中で書く** — 消費する `spec_proposals` に概要・設計判断・影響範囲がすでに揃っているので、この時点が最も情報が新鮮。「同一コミットである必要はない」（複数コミットに分けてよい、spec.md と spec-history.md が別ファイルになった #692 以降 per-commit では機械強制しない）だけであり、「release まで書かなくてよい」という意味ではない。

`make release` の pre-tag checks（`scripts/check-spec-history.mjs`）はこの手続きの取りこぼしを拾うブロッキングな安全網であり、一次的な執筆トリガーではない。#689 の distribution review ゲートと機構は同型だが、あちらは「レビューは公開境界でのみ走る」性質そのものが正当な設計（プロンプトの読み手は公開時にしか現れない）なのに対し、こちらは integrate 時点で書ける・書くべき情報を release まで持ち越す理由がない。忘れた場合の検出が release-status（非ブロッキング）と release（ブロッキング）に付いている、という位置づけ。

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

一般形（生成物が適合すべき既存構造は実物から読んで委譲入力に明示する）は pfd-ops `references/work-cycle.md` 手順2 適用点3 が一次情報。
proposal 起草での「既存構造」は対象 spec の現行 frontmatter キー構造・制約節番号であり、`spec.md` の該当節を読ませる/grep させることで渡す。
渡さなかった実例が 2026-06-20 の捏造（spec に無い `presentation` ブロック — review-perspectives A「入力充足」の委譲版）で、戻り後レビューで検出した。

## .pfdsl 変更後のスナップショット更新

`packages/core/src/__fixtures__/` 内のフィクスチャ `.pfdsl` を変更した場合、`pnpm --filter @pfdsl/core exec vitest run -u` でスナップショットを更新してからコミットする。pre-commit hook（`.pfdsl` staged 時）と CI の両方で更新漏れを自動検出する。`.pfdsl/roadmap.pfdsl` / `.pfdsl/workflow.pfdsl` 等の運用 PFD を変更してもスナップショットは変化しない（fixture ベースのため）。

## 生成物の再生成と自動ドリフト検査（gen-skill / gen-plugin / gen-samples / gen-readme-cli）

`docs/spec/spec.md` / `docs/samples/` を変更したら `make gen-skill`（スキル `references/`）・`make gen-samples`（サンプル `.dot` / README / `.svg`）で生成物を再生成する。`packages/cli/src/` の CLI コマンド定義を変更したら `make gen-readme-cli`（README `## CLI` セクション）で再生成する。

現在のcanonical inputは、`scripts/lib/harness-inventory.mjs` が選ぶ手書きの`.claude/skills`・`.claude/commands`・`.claude/agents`配布対象と、`CLAUDE.md`・`.claude/settings.json`・`hooks/`である。Claude CodeとCodexのadapterは同じinventoryを消費する。`.claude/skills/pfdsl` は `plugin/pfdsl/skills/pfdsl` への生成symlinkであり、canonical inputでも編集先でもない。

これらの入力、またはgen-skillの入力を変更したら、`pnpm -r build && make gen-plugin` を実行する。これはClaude Code用のmirrorとmanifest、Codex用のplugin manifest・command skill、リポジトリの`AGENTS.md`・`.agents/`・`.codex/`を同時に再生成する。生成先は手編集しない。編集元を直して同じコマンドで再生成する。distが無い、または鮮度確認だけを行う場合は `node scripts/gen-plugin-dist-independent.mjs` を使えるが、`plugin/pfdsl/skills/pfdsl/SKILL.md` は含まれない。

Codex pluginのmanifestは現在 `Skills` capabilityのみを表す。このためCodex native agentとhooksはpluginに同梱せず、リポジトリ側の`.codex/agents/`と`.codex/hooks.json`へ生成する。Codexではcommandとskillが同じplugin skill名前空間を共有するため、同名の場合は生成器がcommand側を`source-command-<name>`へ改名する。

中立canonical sourceへの移行は今回の対象外である。将来はinventoryのsource pathと共通本文の置場を差し替え、Claude CodeとCodexのadapter出力契約とidentity検査を維持する。

再生成漏れは機械的に検出されるため手動チェックは不要である。gen-skill / gen-plugin の identity はpre-commit（各々の入力 staged 時）とCI（check-gen-plugin.yml）、`.dot` / README のドリフトはgraphviz-exporterのvitestテスト、`.svg` のドリフトはpreview-engineのvitestテスト（いずれもpre-commitの`docs/samples/` staged時とCI test）、README `## CLI` セクションのドリフトは`make check-readme-cli`（pre-commitの`packages/cli/src/` / `README.md` staged時とCI test.yml）が検査する。`references/*.md` を含むpluginのdist非依存部分は `scripts/gen-plugin-dist-independent.mjs` が生成し、pre-commit はdist必須のSKILL.md検査とは別のcheck_driftでこれを常時検査する。distがstaleでgen-skill / gen-pluginのSKILL.md部分の検査がskipされても、このドリフトはここで止まる（#593。前身は#586のreferences専用検査で、粒度拡張の経緯は`scripts/pre-commit`の当該コメントが一次情報）。

**dist 鮮度の機械検査**: pre-commit の drift 検査（README `## CLI` セクション・gen-skill の SKILL.md 部分・gen-plugin）は対象 dist（`packages/cli/dist/cli.js` 等）を実行または import して出力を取得する。`scripts/lib/dist-freshness.mjs` が dist の mtime を sibling `src/` の最新 mtime と比較し、dist が存在しない場合と同様に古い場合も検査を skip して「run 'pnpm -r build'」を促す（#450/#452）。skip は「検査対象が信頼できないので判定を CI に委ねる」意味であり、ローカルで検査 PASS しなかったからといって drift が無いとは限らない — コミット前に `pnpm -r build` を済ませて skip を解消してから判断する。gen-skill の `references/*.md` 部分と gen-plugin の SKILL.md 以外の部分は dist に触れないため、この skip の影響を受けない（#586 / #593）。

**pfd-ops `install/` は生成物**: `.claude/skills/pfd-ops/install/**` は手編集しない。
生成の構造（ソース・生成器・向き）は `workflow.pfdsl` の `ops_install_sources >> gen_install -> ops_install_templates` が一次情報 — ここには手続きだけを書く。
配布対象は `scripts/lib/install-templates.mjs` の明示リストが決める（`scripts/pfdsl/` には配布しない repo ローカルの `*.test.mjs` が同居するため、glob でなく明示リストにしている）。
テンプレートを増減したらこのリストも更新する。

drift 検査は pre-commit（`gen-install` の check_drift。他の drift 検査と違い dist を要求しないので、ビルド未実施でもローカルで走る）と CI（`check-pfd-ops-sync.yml`）が行う。
生成側を手編集した場合も、再生成が作業ツリーの手編集を上書きしたうえで検査が落ちる。
テンプレートのソースを変更したコミットは再ステージが2往復必要になる（1回目で `install/`、2回目で `plugin/`）。
2ホップの生成チェーンに「直して exit 1」の流儀を適用した結果であり、意図した挙動である。

**生成物 drift 検査はコミット分割を制約する**: 規則は配布層（pfd-ops `references/work-cycle.md` のコミット粒度ゲート）が一次情報。このリポで該当する検査は `gen-plugin`（inventoryが選ぶ手書き入力と `CLAUDE.md`・settings・hooks → Claude Code / Codexの生成物）と `gen-install`。

**出力抑制**: `make gen-samples` / `make gen-skill` はpnpm全パッケージbuild + 全サンプルcheckのwarningを毎回出力するため数百行に及ぶ。実行後は `git status --short docs/samples/ plugin/pfdsl/ AGENTS.md .agents/ .codex/` で変更ファイルのみ確認すれば足りる（ビルド自体の成否は非ゼロ終了コードで分かる）。

**配布スキルの新規追加時の横断照合**: `scripts/check-skill-wiring.mjs`（`make check-docs` 経由で CI も実行）が機械的に検査する（#699）。同梱スキル・agent の artifact が `workflow.pfdsl` の `distill_ops` 出力エッジ（一次情報としての生産）と `runtime-pipeline.pfdsl` の `gen_plugin` 入力エッジ（同梱素材としての消費）の両方に在るかを見て、欠けていれば file:line で報告する。以前は目視追随であり、#481 で `grill_skill` 追加時に3箇所を見落として pfd-retro の A層監査が事後に拾った。

検査対象は手書きリストでなく既存データから導く（列挙を持つとそれ自体が追随漏れの対象になる）。同梱されるかは `scripts/lib/gen-plugin.mjs` の `PLUGIN_MIRRORS`（組み立てと `distribution-review` の逆写像が既に読んでいる同梱マニフェスト）が答え、artifact の `location:` とエッジは `@pfdsl/core` の `analyze()` から取る。`pfdsl_skill` はマニフェストが「rendered, not mirrored」として除外するため特別扱いが要らない。

**2つのエッジは要求範囲が異なる（#944）**: `gen_plugin` 入力エッジは同梱される全ての手書き artifact に要求するが、`distill_ops` 出力エッジは `workflow.pfdsl` が宣言している artifact にのみ要求する。`pfd_commands` は `runtime-pipeline.pfdsl` にしか宣言が無く（#780）、そもそも `workflow.pfdsl` のエッジに載る資格を持たないため、両方を要求すると偽陽性になる。非対称は id の手列挙でなく「どちらの図が宣言しているか」から導出する。両図が宣言する artifact は workflow 側の宣言を採り、finding は1件に畳む。

照合先は ADR-0035 の描き直しで4箇所から2箇所に減った。旧 `publish_cli` 入力エッジは判断部分が `decide_release` になり素材列挙を持たなくなり、`runtime-pipeline.pfdsl` の旧 `assemble_plugin` は `workflow.pfdsl` の旧 `gen_plugin` と同一物の二重モデル化だったため統合した。実際にこの二重化は `pfd_lens_agent` / `implementer_agent` が片方の図にしか無いという乖離を生んでいた。

**判断軸による分担（ADR-0035）**: 判断を含まない生成・公開の変換は `runtime-pipeline.pfdsl` が持つ。`make gen-skill` / `make gen-install` / `make gen-plugin` / `make gen-samples` と、タグ push 以降の npm publish・vsix 生成・marketplace アップロードがそちらにある。この図に残るのは「リリースするか・どの版で切るか」の判断（`decide_release`）までである。生成コマンドの手続き・drift 検査の話はこの companion が引き続き一次情報として持つ（グラフで運べない散文のため）。

**生成の一次ソースは `graph io` の終端に出る（ADR-0035 の副作用）**: `gen_skill` / `gen_plugin` / `publish_packages` / `package_vsix` が消費する生成の一次ソースは、この図では消費者を持たない終端 artifact として報告される。消費側のエッジは `runtime-pipeline.pfdsl` に実在するが、`graph io` はファイル単位で走るため参照できない。該当する artifact をここに列挙しない — 一次情報は消費側のエッジであり、現在の集合は下記の機械振り分けが `.pfdsl/` を横断して毎回そこから取り直す。

**これらに `todo` プレースホルダの消費者を立てない。** 立てると ADR-0035 が解消した二重モデル化（同一変換を2ファイルが別ノードIDで持つ状態）を作り直すことになる。終端ゲートのプロトコル5(b) 判定では「消費者は sibling の `runtime-pipeline.pfdsl` に在る」と記録して該当なしとする。

**この振り分けは `gate-check.mjs` が機械的に行う（#671）**: 新規終端の報告は、`.pfdsl/` 内の他の `.pfdsl` を `graph edges --json` で読み、`>>` 入力エッジで消費されているものを別見出し「New terminal artifacts consumed in a sibling graph」へ分ける。ただし振り分けは PASS/FAIL でなく報告材料であり、手段か納品物かの分類は MANUAL のまま残る。sibling 見出しに出た artifact は、該当なしと記録する前に消費側のエッジを実際に確認する。

**本来の見出しに残ったことは、それだけでは門番違反の確定ではない。** sibling が構文エラー等で `graph edges --json` に落ちた場合、その図の消費エッジは黙って読み飛ばされ、消費者は0件として扱われる（読めなかった側に倒すと本物の違反を沈黙させるため、見に行けと言う側に倒してある）。門番違反と言えるのは、sibling が読めたうえで消費者が無いときである。判定時は `.pfdsl/runtime-pipeline.pfdsl` を単体で `graph edges` に通し、パースが通ることを確かめてから結論する。

合成を CLI でなく `gate-check.mjs` に置いたのは spec §2.9.1 が ID をファイルローカルに保ち、複数ファイルを跨いだ平坦化ビューの構成を禁じているためである。「同名 ID は同じ成果物」はこのリポの `.pfdsl/` のローカルな慣行であり、規範ではない。慣行が及ぶ範囲は `scripts/lib/gate-check.mjs` の `SIBLING_ID_NAMESPACE_DIRS` が持ち、`.pfdsl/` だけを列挙する — `docs/samples/` は互いに無関係なチュートリアル図が `spec` / `code` を使い回しており、同一ディレクトリという理由だけで合成すると本物の門番違反が sibling 見出しへ落ちる。`>>?` フィードバック消費も合成の対象に入れない — `graph io` の `terminals` は spec §15.11 の audit-terminal でフィードバック消費を無視するため、sibling 側だけフィードバックを数えると同じ artifact が消費者の置き場所次第で別分類になる。

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
`distill_local_skills` が生産し、`review_distribution` へは `>>?` でしか入らないため、primary の消費エッジを持たない。
能力成果物が世代をまたいで還流する形（ADR-0011）の帰結であって欠陥ではない。
`pfdsl_skill` と違い消費者は sibling の `runtime-pipeline.pfdsl` に**無い** — このスキルは配布されないので `gen_plugin` の入力にならない。
終端ゲートのプロトコル5(b) 判定では、手段（能力成果物）であり後続門番を要さないものとして扱う。

**この手順は配布しない。**
`.claude/skills/distribution-review/` は repo-local であり、上の「配布スキルの新規追加時の横断照合」の対象外である（`runtime-pipeline.pfdsl` の `gen_plugin` 入力エッジに足さない）。
利用側リポには配布という行為自体が無く、この手順の実施先が存在しない。
`spec_stress_skill` / `vscode_ext_debug_skill` と同じ扱いで、`distill_local_skills` の出力にだけ現れる。

## 新 frontmatter フィールド追加時の sample 追加

frontmatter に新フィールドを追加する develop では、対応する `docs/samples/` のサンプルファイルを同一 PR で追加する（「フィールドが仕様にあるがサンプルに示されていない」状態を防ぐ設計ルール）。生成物の再生成・ドリフト検査は上記のとおり機械的に強制される。

## VS Code 拡張の UI 動作確認

`vscode-extension` の挙動変更（webview インタラクション・クリック動作等）を含む develop は、PR 作成前に `/vscode-ext-debug` スキルを用いてビルド後の実動作を確認する。確認結果をユーザーから受け取るまでサイクル完了とみなさない（pfd-ops 手順2）。

## subagent へ worktree 作成を委譲する場合の安全確認

一般形は pfd-ops `references/work-cycle.md` 手順2「委譲先の外向き操作の制御」の 1（agent の選択）が一次情報。
このリポで再利用判定を持つ手順は `superpowers:using-git-worktrees` skill の Step 0（既存 isolation 検出時は再利用）で、バイパスを明記する先は `.claude/agents/` の agent 定義（例: `.claude/agents/issue-worker.md`）。
乗っ取りが実際に起きたのは issue #439 の issue-worker 試走で、呼び出し元ブランチは無傷で復旧できたが、一歩間違えば作業中のコミット履歴を破壊しかねなかった。

## workflow.pfdsl に登録する agent の範囲

一般形（登録するのは図の変換の参加者だけで、参加者性の代理を基準に据えない）は pfd-ops SKILL.md プロトコル5が一次情報。
判定はその一般形どおり2節で行う — その agent を要求している図のプロセスを名指しできるか、または生産・消費している図の成果物を名指しできるか。
下の PreToolUse ガードの節が前者しか書いていないのは、そこで扱う機構がいずれも前者で決着したためで、判定を1節に狭める規定ではない。
`PLUGIN_AGENT_FILES`（plugin 同梱物）への所属は出発点として使ってよいが、基準ではない。
同梱は参加者性の代理であり、基準として閉じると参加者でありながら同梱されていない agent が機械的に落ちる。

登録済みの一覧とそれぞれの要求元は `workflow.pfdsl` の `distill_ops` 出力と artifact 定義が一次情報。`node packages/cli/dist/cli.js graph neighbors .pfdsl/workflow.pfdsl distill_ops` で出力集合を引き、agent artifact の定義を参照する。

repo scope の agent（`ci-triage` 等、このリポの開発都合の道具）はいずれも、要求している図のプロセスも、生産・消費している図の成果物も名指しできない。
この結果が現状 `PLUGIN_AGENT_FILES` の内外と一致しているのは観測であって、判定規則ではない。

## agent を追加するサイクルの動作確認

原則（起動できるかは確かめるまで分からないので送る前に1回呼ぶ・引き渡す検証手順は壊れたことの確認を含む）は配布層（pfd-ops `references/work-cycle.md` 手順2）が一次情報。
このリポでの実測は #754 — `Agent` tool が `Agent type 'local-check-triage' not found` を返し、引き渡した `git stash push -- <file>` は当該変更のコミット後に空振りして検査が緑を返した。
前者は「同一セッションからは起動できない」の実例として記録されていたが、harness のドキュメントは定義の追加を検出して再起動なしに使えると述べており、再起動が要るのはディレクトリごと新設した場合等に限られる。
#754 が当たったのはその例外側だったとみられる — 1事例から一般則を立てた形なので、同種の記録は「この回はこうだった」までに留める。

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

## hook の artifact 登録基準（#854）

一般形（登録するのは図の変換の参加者だけで、参加者性の代理を基準に据えない）は pfd-ops SKILL.md プロトコル5が一次情報。
このリポでの適用対象は `.claude/settings.json` に配線された hook 全般（PreToolUse ガードと PostToolUse advisory の双方）で、登録先は `externalize_bindings` の出力としての `workflow.pfdsl`。
節の名前を PreToolUse に限っていた頃に PostToolUse advisory（`companion-prose-advisory`）が現れ、判定の宛先が無いように読める状態になったため、対象を hook 全般へ広げてある。
登録しない側に当たるのは `stale-dist-guard` / `command-usage-guard` / `closes-create-guard` / `roadmap-publish-guard` / `verification-tree-guard` / `worktree-write-guard` / `companion-prose-advisory` 等で、いずれも個別事故への対処であって図のプロセスの出力ではない。

artifact 登録済みの一覧とそれぞれの要求元は `workflow.pfdsl` の `externalize_bindings` 出力と artifact 定義が一次情報。`node packages/cli/dist/cli.js graph neighbors .pfdsl/workflow.pfdsl externalize_bindings` で出力集合を引き、hook artifact の定義を参照する。
PostToolUse advisory であっても、要求元の手順を名指しできれば登録側になる。advisory か guard かは判定軸ではなく、上の列挙で登録しない側に並ぶ `companion-prose-advisory` との違いも、要求元の手順を名指しできるかどうかだけである。
**issue 番号に紐づくことは非参加者の判定根拠にならない** — 既存の登録 artifact にも issue 由来の機構がある。区別は出自の issue でなく、運用手順がその機構を要求しているか（＝図のプロセスの出力として生まれるか）で付ける。

判定に迷う新規 hook は、その hook を要求している図のプロセスを名指しできるかで振り分ける。
`externalize_bindings` の出力だと言えることは根拠にならない — 同 description が「PreToolUse ガード機構へ外化する」と書いているため、登録しない側も等しくそう言える。

## flow:exempt issue の roadmap 追加除外

判定基準・タイミングは L3 reference（`github-issues-backend.md`「ラベル判定基準」）が一次情報。`file_issues` の「起票と同時に roadmap 追加」ルールの例外。

## develop 着手時の artifact status 更新

汎用ルール（着手時 todo→wip、PR を待たない）は pfd-ops プロトコル「進捗更新」が一次情報。このリポでは flow-sync が merge 後に `done` へ自動遷移させるが、`todo` → `wip` は人手のため着手と同時に行う。

## workflow.pfdsl に status を書かない

汎用ルール（flow 種別の artifact に `status:` を書かない。同一 id が複数の図に現れる場合も一次情報は roadmap 側に一元化する）は `docs/quality-guide.md`「進捗 status は roadmap にだけ書く」が一次情報。このリポで両図に現れる id は `article` で、workflow 側にも status を書いたため #763 の食い違いが起きた。

## release milestone artifact の作成規約

roadmap の CLI release milestone（`cli_release_<slug>` 等）はバージョン番号の事前予約ではない。**下流作業がそれを入力として要求する時点**でのみ作成する（pfd-ops プロトコル2・5の適用）。バージョン番号は roadmap 本体に書かず、done 後の label/criteria に事実として付記するのみ — 番号を先に書いて後から実態と合わせる運用（#278 導入前の運用）は廃止した。

複数の実装 issue を1つの PR/リリースに束ねる場合も、milestone ノードは束ねた内容を表す1つの slug で作成すればよい。「中間バージョンをスキップ/統合するか」という判断自体が発生しない — バージョン番号を roadmap に書かないため、スキップ対象になるバージョン番号付きノードが最初から存在しない。

`make release cli` は roadmap 上 ready になった `publish_cli_*` プロセスの出力を機械的に done 化する（バージョン番号からの artifact ID 逆算はしない）。計画外リリースで ready な milestone が無ければ何もしない。

## hotfix 運用（issue 省略）

判定3条件と省略規則は L3 reference（`github-issues-backend.md`「hotfix 運用」）が一次情報。このリポでは `[gh_issues, roadmap_pfdsl, spec] >> develop` 通常経路の例外ケースに当たる。

## コアライブラリ型を拡張する場合の設計判断

vscode-extension 等で新しいノード種別をホバー対応する場合、「`NodeKind`（コア公開型）に追加する」vs「provider 内で独自チェックする」の選択が生じる。判断基準: `analyze()` の `nodeKinds` マップに新種別が自然に乗る（frontmatter でスコープが確定する）なら型に追加する。provider ローカルの一時的な判定なら独自チェックにとどめる。コアへの変更は全パッケージの再ビルドと `Record<NodeKind, ...>` の exhaustive check 修正が必要になるため、影響範囲を確認してから選択する。

## 終端ゲートの根拠

汎用ゲート項目（status 更新 / check 通過 / 論理単位コミット / PR 集約）に加え、このリポでは issue 固有項目を合成する。issue 固有項目は `roadmap.md` を参照。
