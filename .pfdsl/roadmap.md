# roadmap.md — issue 管理バインディング（roadmap.pfdsl の companion）

この companion を読んだ後、pfd-ops スキルが未ロードならロードして運用プロトコル（サイクル手順・終端ゲート・知見振り分け手続き等）を確認すること（ロード済みなら再ロード不要）。

`roadmap.pfdsl` は issue 依存構造のみ管理する。issue の一次情報と同期手段はここに書く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## バックエンド

GitHub Issues。規約と採用手順は `.claude/skills/pfd-ops/references/github-issues-backend.md`（L3 プリセット）に従う。

## このリポのインスタンス値

- 一次情報: github.com/takasek/pfdsl/issues
- 同期監査スクリプト: `scripts/pfdsl/audit-issues-flow.mjs`（`--fix` で機械的修復）
- 監査対象: `.pfdsl/roadmap.pfdsl`

## 運用対象の計画 PFD

ワークサイクルの選択ステップが列挙する対象:

- `.pfdsl/roadmap.pfdsl` — オープン issue の依存グラフ

## プリフライト・ゲート集約スクリプト（#354）

- **選択フェーズ（pfd-ops 手順1）**: `GH_HOST=github.com node scripts/cycle-status.mjs` — fetch 実行・base への遅れコミット数・flow-sync PR / その他 open PR の一覧・`status ready --best` の結果を1回の JSON 出力に集約する。`--base <branch>` で対象ブランチを変更可能（デフォルト `main`）。加えて次の3点を出力する（#461）:
  - `openFlowSyncPRs` の各要素に `ci`（`PASS`/`FAIL`/`PENDING`/`NONE`/`UNKNOWN`）を含む。`gh pr checks` の別往復は不要
  - 対象 issue の本文・コメント・起票者 login を fetch し、設計確定状態を `designUnsettledFor`（`{issue, source, unsettled, reason, matchedLines, optionCount, decision}`）で出力する（#669）。`reason` は `phrase`（未合意フレーズ一致）/ `enumerated-options-without-decision`（候補2件以上かつ起票者の `決定: 案N` 行なし）/ `decision-recorded` / `no-enumerated-options`。対象 issue は `--issue <n>` が最優先（`source: "flag"`）、無ければ best プロセスの `location:` から解決する（`source: "best-process"`）。どちらも得られない場合は `null` + `designUnsettledError` を返す — 旧 `designUnsettled` フィールドはどの issue に対する判定か区別できず、roadmap 非管理の issue に着手する回で無関係な判定を確定の根拠に取り違える経路になっていた
  - `behindBase > 0` のときは判定を一切出さず `staleTree`（`{base, message}`）と `behindBase` だけを返し、終了コード 1 で拒否する（#716）。プリフライトは作業ツリー内のスクリプトなので、遅れたツリーではその古い版が走り、出力は「どの判定が存在するか」からして古い版のものになる。`origin/<base>` を起点にサイクルのブランチを切ってから実行する。**この拒否は拒否する版へ更新されたツリーでしか起きない**ので、古い版のツリーでは `behindBase` を自分で見る
  - `currentBranch` と `commitsAheadOfBase`（`origin/<base>..HEAD` の件数）を出力する（#629）。0 でなければ前サイクルのブランチに乗っている可能性を示すが、既存ブランチの意図的な継続もあるためスクリプトは拒否せず判断を残す
  - 作業ツリーに未コミットの変更（追跡外ファイルを含む）があるときは、`behindBase` と同じく判定を一切出さず `uncommittedFiles` と `dirtyTree` だけを返し、終了コード 1 で拒否する（#744）。前サイクルの変更はブランチを切り替えてもツリーに残り、次サイクルの最初のコミットに紛れ込む — `commitsAheadOfBase` が塞ぐのと同じ失敗の型で、経路がコミットでなく作業ツリーであるだけ。`commitsAheadOfBase` と違い判断を残さず拒否するのは、サイクルは clean なツリーから始める前提であり、`git worktree add` がそれを作るため、拒否への答えが「weigh する」でなく「worktree を切る」で済むから。ツリーが base に遅れかつ汚れている場合は遅れの方を返す（走っているスクリプト自身が古い版だという判定が、汚れの判定の信頼性も奪う）
  - 設計選択記録の雛形を `designRecordTemplate`（`{note, lines}`）で毎回出力する（#720）。行頭の語は `gate-check.mjs` の `DECISION_LINE_PREFIX` / `DESIGN_RECORD_REQUIRED_PREFIXES` / `DISPOSITION_TOKENS` から引いており、散文に転記していない。対象 issue が候補を列挙している場合はその件数を添えた処分の行が加わる
  - best 候補プロセスの出力 artifact キーを `status ready --json` の `outputs` フィールドから引き、実行すべき `gate-check.mjs --artifact <key>` の完成形コマンド行を `gateCheckCommand` で出力する（転記ミス・フォールバック判定への意図しない低下を防ぐ。roadmap.pfdsl 自前 regex パースは二重パースで構文変更に弱いため CLI 側の `outputs` フィールドを正とする）
- **終端ゲートの機械項目 + 報告材料2種（pfd-ops 手順3・#462）**: `GH_HOST=github.com node scripts/gate-check.mjs [--base main] [--artifact <key> | --no-artifact] [--issue <n> ...]` — 内部で `git fetch origin` を試みたうえで `origin/<base>...HEAD` を基準に差分を取る（fetch 失敗時も既存 remote-tracking ref で続行し、ref 自体が無ければ明示エラーで終了する）。**項目名・PASS/FAIL/SKIP の判定・SKIP 条件はここに列挙しない** — スクリプトの出力が自己記述的であり、実行すれば全項目が detail 付きで印字される（#560。列挙をここに置くとスクリプト変更のたび手で追随することになり、追随を保証する機構が無い）。`--artifact <key>` を渡すと status 更新・wip 経由の両方をその artifact に厳密スコープする（省略時はどちらも粗いフォールバック判定になる旨を detail に明示）。出力 artifact を持たないサイクル（`flow:exempt` の bookkeeping 等）は `--no-artifact` で宣言する — `roadmap.pfdsl` を status 以外の理由で触ると、宣言なしでは構造的に FAIL する（#564）。表のほかに2種の報告材料が印字される（PASS/FAIL でなく判断材料）: 変更 `.pfdsl` ごとの新規終端 artifact リスト（`graph io` 差分。手段か納品物かの分類のみ MANUAL に残る）・`roadmap.pfdsl` 変更時の ready-set 差分（newly ready / no longer ready、手順4の報告に使う）。判定不能な残り項目は `MANUAL:` prefix で列挙される — SKILL.md の終端ゲートチェックリストから実行時に抽出するため手打ちコピーは持たない。その項目のみ個別に確認する
- **そのサイクルが閉じる issue を毎サイクル全て渡す（#669・#734）**: `--issue <n>` は繰り返し指定でき、渡した issue ごとに `design-selection record` と `knowledge-artifact size direction` の2項目が1行ずつ評価される。省略すると両項目とも SKIP する（対象 issue を推測しないため）。複数 issue を閉じる回で1件しか渡さないと、渡さなかった issue はゲートを一度も通らないまま表は緑になる — 選択記録の保証が必要なのは閉じる N 件すべてであって、そのうち1件ではない。判定条件は他項目と同じくスクリプト出力の detail が自己記述する — ここには列挙しない。運用側が事前に知る必要がある入力契約は3つで、選択記録の書式は L3 reference「設計確定の記法（`決定:` 行）」、知識成果物の縮小を目的とする issue は本文に行頭 `Size-Intent: shrink` を書く（これが無い回はサイズ方向の判定を行わない — 語句一致で意図を推し量ると、他 issue の案名を引用しただけで発火する）、サイズ増加を意図的に通す回は PR 本文の行頭 `Size-Override: <理由>`（理由なしの素通しを避けるためトークンだけでは通らない）。宣言の有無に関わらず、変更された知識成果物のバイト・行差分は報告材料として常に印字される。`cycle-status.mjs` の `gateCheckCommand` にはこのフラグが埋め込まれるので、そのままコピーすれば渡し漏れない。`cycle-status.mjs` 側の `--issue` も繰り返し指定でき、渡した分だけ `designUnsettledFor` に判定が並び、`gateCheckCommand` にも全件が並ぶ — サイクルが閉じる issue が preflight の時点で分かっているなら、そこで全て渡しておけば終端ゲートへの転記で落ちない
- どちらも `packages/cli/dist/cli.js` の存在を前提にする箇所がある（worktree では先に `pnpm install && pnpm -r build` を済ませる）。`gate-check.mjs` はビルド未完了でも最後まで走り、項目名・SKIP 条件・MANUAL 一覧は通常どおり印字される（CLI に依存する `pfdsl check` と gen-plugin identity の2項目が FAIL になるだけ。実測 #560）

## 自動生成 PR（ワークサイクル選択前に確認）

このリポでは issue close 時に `pfdsl-flow-on-issue-close.yml` が `flow-sync/*` ブランチで flow-sync PR を自動起票する。サイクル開始時に `flow-sync/*` ブランチの PR が open のものがあれば CI が green であることを確認してマージ先行（コンフリクトがある場合は手動解消してからマージ）。それ以外の open PR（機能追加・バグ修正等）は「今回の着手作業に競合するか」を判断軸としてケースバイケースで確認する。`node scripts/cycle-status.mjs` の `openFlowSyncPRs` / `otherOpenPRs` フィールドが手動 `gh pr list` の代替になる。

**flow-sync PR の CI が `pending`/`action_required` のまま動かない場合**: `github-actions[bot]` が起票した PR は workflow run が承認待ち（`action_required`）で止まり、放置すると CI が green にならないまま preflight が詰まる。GitHub MCP の `actions_list`（`list_workflow_runs`, branch でフィルタ）で該当 run の `conclusion` を確認し、`action_required` なら `actions_run_trigger`（`method: rerun_workflow_run`）で明示的に再実行する。

**`gh` CLI が使えない環境（Claude Code Remote 等）での代替**: `cycle-status.mjs` / `gate-check.mjs`（内部の `audit-issues-flow.mjs`）は `gh` を呼ぶが、`gh-exec.mjs` が `GH_TOKEN` / `GITHUB_TOKEN` のある環境では REST fallback へ落ちる（#489）。fallback が答えられる argv の形は `gh-compat.mjs` の `planGhRestCall` が持つものだけで、それ以外は `gh` 不在のエラーがそのまま出る。token も無い場合は GitHub MCP server のツール（`list_pull_requests` / `issue_read` / `pull_request_read` 等）で個別に代替する: PR一覧は `list_pull_requests`、issue 本文の design-unsettled 判定は `issue_read`（`get`）で本文を読んで手動判定、`audit-issues-flow` 相当は対象 issue の `location:`・`updated_at:` を roadmap.pfdsl の記載と手動突合する。

`gate-check.mjs` の per-issue 行が SKIP になるのは `gh` バイナリ不在のときだけで、それ以外の lookup 失敗（存在しない issue 番号・認証・ネットワーク・fallback の戻り形不一致）は実エラーを detail に出して FAIL する（#745）。「gh CLI unavailable」と出ていない SKIP は無い — 検査が走らなかった行を環境のせいと読み違える余地を残さないため。

## 終端ゲート追加項目（issue 固有）

**タイミング規約**: issue クローズと flow 確定（下記「マージ時のみ」の2項目）は **main への PR マージ時**に行う（生態系図 merge_pr: 進捗・issue 更新はマージで正本になる）。PR 作成時点では行わない — PR がレビューで変わる/却下される可能性があるため。サイクルが PR 作成で終わる場合、この2項目は「マージ時に実施」と記録して未了のまま閉じてよい。**feature branch への中間 PR では `closes #xxx` を使わない**（理由と規約は L3 reference「PR 本文規約」が一次情報）。**出力 artifact の status done 更新はこれに含まれない** — develop 完了時点（PR 作成前）で criteria 達成が言えるなら done にしてよい（プロトコル4のデフォルト通り）。

**着手時**: develop ブランチを切った時点で、実装対象の出力 artifact を `todo → wip` に更新する（workflow.md「develop 着手時の artifact status 更新」）。PR 作成・マージを待たない。

**着手前の選択記録**: 実装着手前に、選んだ方針を issue コメントとして残す。`--issue` を渡す全サイクルが対象で、issue が複数案を列挙しているかどうかは問わない（候補列挙のある回は各案の処分も要る）。選択を記録せず着手すると、issue 本文だけを読んだ第三者が「なぜその方針になったか」を実装差分からしか追えなくなる。
書式は覚えなくてよい — `cycle-status.mjs` が `designRecordTemplate` として毎回出すので、それを埋めて投稿する。

汎用ゲート（status 更新 / check 通過 / 論理単位コミット / PR 集約）に加え、**マージ時にのみ**:

- [ ] 完了した issue をクローズし、進捗・新発見を issue に反映した
- [ ] close 時の降格規則を適用した（定義は L3 reference。専属 process も含めて削除する）

**`/code-review` の実測期間中（#561 が open の間）**: `packages/` または `scripts/` に変更があるサイクルでは、終端ゲートの `/simplify` または `/code-review` 項目を省略しない。
散文・PFD のみのサイクルは**実測の対象外**として PR 本文にその旨を書く（「実施して指摘なし」として数えない — コード変更のないサイクルを分母に入れると出現率が下振れする）。
`sample` の判定は path でなく変更の実体で行う。
`packages/` / `scripts/` 配下でも、実行される内容を含まない散文（Markdown・テンプレートのコメント等）だけの変更は `sample=out` とする。
`sample=out` は計測の対象外を意味するだけで、レビューを省略してよいという意味ではない。
レビューの要否は diff の規模で別に判断し、省略する回はその理由を PR 本文に書く。
自己レビュー（差分の読み直し）は実施済みとみなし、それに**加えて**軽い設定のレビューを実施する（角度を絞る。8角度 × 検証 agent の高効度設定は使わない）。
実行手段は次の優先順で選ぶ。

1. **A — `/code-review`。** 既存 PR に対する大規模 diff のレビュー向け。プロトコルが 5 並列 finder agent + 候補ごとの検証 agent を起動し、結果を対象 PR にコメントする形なので、**PR 作成前のサイクル**と**数十行規模の diff** には構造的に合わない。選ぶのは PR が既にあり diff が大きい回に限る
2. **B — `code-reviewer` agent を Agent tool で起動する。** **導入が前提** — `pr-review-toolkit` / `feature-dev` plugin のいずれかを有効化していないと選べない
3. **C（既定）— `/simplify`。** 常に使え、PR 作成前でも回せる。角度は4つ固定。scoped な修正にはこれが規模相応

起動可否は harness と plugin の版に依存する。過去に「AI からは起動できない」と記録された手段でも、規約に従う前にその回の実体（コマンド定義の `disable-model-invocation`）を確認する。2026-07-28 時点で `/code-review` は `disable-model-invocation: false`。

記録はコミットの trailer に置き、`tool=` でどれを回したかを書く。
**1サイクルで複数回レビューしたら、その回数だけ書く** — 自己レビュー → ツール → 指摘対応、と複数パスが走るのが普通で、1本に丸めると何が何を見つけたかが失われる。集計はマージ（first-parent）単位でサイクルを数え、同一サイクル内の複数記録は合算する。
プールした rate は「レビューの価値」でなく「その回どちらを回したか」を測ってしまうため、tool 別の内訳は**レビューパス単位**で出す（1サイクルが2つのツールを回せば、サイクルは1・パスは2）。

```
Review-Measurement: sample=in new=2 adopted=1 tool=code-review angles="branch coverage; error paths"
Review-Measurement: sample=out
```

`tool` の値は `code-review` / `code-reviewer-agent` / `simplify` のいずれか。`sample=out` の回は不要。

`new` は自己レビューで気付いていなかった指摘の件数、`adopted` はうち採用した件数。
**`new=0` の回も必ず書く** — ヒットだけ記録すると分母が消えて出現率が出ない。
**レビューはコミットの前に回す。** trailer は commit message の一部であり、後から追記できない。
`sample=in` / `sample=out` の判定も**ブランチ最初のコミットを作る前**に行う。
終端ゲートで気付いた時点で push 済みなら、trailer の追加は履歴の作り直しになる。
確定していない件数を暫定値で書いて後で直す運びにすると、直す手段が履歴の作り直しになるか、暫定値のまま集計に混ざるかのどちらかになる。
記録先をファイルにも PR 本文にもしないのは、前者が並列 worktree で追記コンフリクトを起こし（ADR-0026 が同型の記録機構を廃止した理由）、後者は終端ゲート実行時点でまだ存在しないため。
記録漏れと `sample=` の食い違いは終端ゲートと CI（`check-review-measurement.yml`）が判定する。
どちらも `classifyCycle` を呼ぶだけで、マージ後の集計と同じ判断をブランチに対して先に行う。
集計は `node scripts/review-measurement.mjs --since <ref>` で行う。
10サイクル分そろったら #561 で集計し、省略条件を決めて本項目を差し替える。

develop 完了時点（PR 作成前、マージを待たない）で:

- [ ] 変更が公開物の挙動・同梱内容を変える場合（CLI 出力・拡張機能の動作変化に加え、plugin 同梱物 = 配布スキル群・pfd-* コマンド・agents（`make gen-plugin` の対象）の変更を含む — パスでなく挙動と同梱内容で判定）、npm 公開・Marketplace 公開が必要か確認した（`make release-status` で behind を確認。pending なら次サイクルの先頭タスクとして明記する）
- [ ] CLIコマンドを追加・変更した場合、HELP テキスト（`packages/cli/src/index.ts`）と README のコマンド一覧の両方を更新した
- [ ] 実装を subagent へ委譲した場合、戻り時に `git log origin/<branch>..HEAD` と open PR 一覧を確認し、委譲先がブリーフの留保作業（push・PR 作成・issue 操作）を実行していないか照合した
- [ ] `/simplify` または `/code-review` を実施した回は、実施直後（コミット作成前）に `Review-Measurement` trailer をそのコミットのメッセージへ含めた。レビュー実施とコミット作成の間に他の作業（PR 作成・push 等）を挟むと記載を失念しやすい — 実施済みで未記載のまま次の作業に進んでいないか、コミット直前に再確認する

**サイクルは worktree で回す**: ブランチをルート作業ツリー（`~/works/pfdsl` 直下）で切らない。ルートツリーの HEAD は複数のセッションが共有する資源で、他セッションの `git stash` / `git switch` が自分の未コミット編集をツリーから取り去り HEAD を別ブランチへ移す。編集ツールは成功を返すため、消失は次に同じ箇所を触るまで検出されない。消えた編集を探すときは `git stash list` を先に見る（`git stash` は内部で reset を行うため reflog では `git reset` と区別がつかない）。

**worktree 前提**: 新規 worktree では CLI/core が未ビルドのため `check` も snapshot 更新も失敗する。ゲート実行前に `pnpm install && pnpm -r build` を済ませる。`.claude/skills/pfdsl` は gitignore 済の symlink（#348・#714）のため新規 worktree に存在せず、そのままでは `make check-docs` が companion-bindings の dead path で失敗する — `make setup`（または `node scripts/link-repo-skill.mjs`）を先に実行する。ビルドは不要。

**vscode-extension を変更した場合**: `pnpm --filter @pfdsl/vscode-extension typecheck` を実行してエラーがないことを確認してからコミットする。`noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` の strict 設定により、他パッケージの型変更が vscode-extension 側でエラーを起こす場合がある。クリック・ホバー等の UI 挙動変更（DocumentLinkProvider・HoverProvider 等）、または preview/export の描画内容変更（statusStyles・tag・group 解決ロジック等）を含む場合は `/vscode-ext-debug` スキルで PR 作成前に実動作確認し、ユーザーの確認結果を受け取るまで完了とみなさない。

**`docs/spec/spec.md` / `docs/samples/` を変更した場合**: workflow.md「生成物の再生成と自動ドリフト検査」に従う（再生成手続きの一次情報はそちら。ここには複製しない）。

**Cycle 計画のパッケージ層明記**: PR body に対象パッケージ層を明記する（→ workflow.pfdsl `develop` プロセスの description 参照）。

**PR 本文の `Closes` キーワード確認**: L3 reference「PR 本文規約」に従う（main 直接マージのみ使用・中間 PR では使わない）。

**worktree での git 操作**: `git commit` など git コマンドは worktree ディレクトリ（`.claude/worktrees/<name>/`）から実行する。pre-commit hook（`.git/hooks/`）は全 worktree 共有で、他ブランチのセッションが `make setup` を実行すると当該ブランチ版の hook に置き換わる — 自ブランチに存在しないファイル・ターゲットを hook が要求して commit が拒否されたら、自 worktree で `make setup` を実行して hook を入れ直す。main repo パスから実行するとその HEAD ブランチ（main など）にコミットが積まれる。
`scripts/main-commit-guard.mjs` は `git commit` に加えてツリー・インデックスを変える git コマンドも見る（#777。deny / ask を分ける原則は CLAUDE.md「コミット粒度」節、割り当ての一次情報は `scripts/lib/main-commit-guard.mjs` の定数）。
読み取り系は素通しするので、main repo のツリーを読むだけの操作は従来どおり動く。
**worktree のパスはシェル変数に入れず literal で書く**。
guard は hook の payload だけを見る静的解析なので `git -C $W commit` の `$W` を解決できず、payload の cwd（cwd が戻っていれば main repo）で判定して deny する。
`git -C /Users/.../.claude/worktrees/<name> commit` と書けば通る。
なお deny は Bash 呼び出し全体を止めるため、`git -C $W add … && git -C $W commit …` が弾かれたときは add も実行されていない。

**hotfix PR の明示**: 緊急修正（バグ修正、誤り修正）を PR にのせる場合は description 冒頭に `hotfix:` を明記する。レビュー優先度・マージ判断の依拠になる。

**`flow:exempt` は roadmap に登録しない**（保守・基盤・修正など roadmap 非管理。判定は L3 reference の「ラベル判定基準」）。

**新 frontmatter フィールドを追加した場合**: 対応する feature sample（`docs/samples/`）を同一 PR で追加する（生成物 `.dot` / README / `references/` の再生成・ドリフト検査は pre-commit と CI が強制する）。加えて `packages/core/src/__fixtures__/pipeline-scale.pfdsl` にもそのフィールドを追記する（fixture がスナップショットの入力であり、feature sample とは別に網羅性を担う）。

**`make gen-samples` 実行後**: `.dot` / `.svg` / README はいずれも決定論的（純 JS + `@pfdsl/preview-engine` の wasm graphviz）に生成されるため、再生成された全ファイルの差分をそのままステージしてよい（#588）。

- [ ] このサイクルで起票した issue を `flow:managed` / `flow:exempt` に分類した（判定は L3 reference の「ラベル判定基準」。保守・基盤・修正は exempt）
- [ ] `flow:managed` の issue がすべて roadmap.pfdsl の artifact として登録済みか確認した（exempt は登録しない）
- [ ] `node scripts/pfdsl/audit-issues-flow.mjs` が差分なしで通過した（手動追記した `updated_at` のズレを機械的に検出する。`gate-check.mjs` 実行時はその一部として自動実行される）

**バージョン artifact を起こす契機**: 版を表す artifact（`spec_vXXX` / `cli_release_*` / `ext_vXXXX`）を roadmap に置く契機は次の2つに限る。
どちらにも当たらない版は、実体が公開されていても roadmap には起こさない。

1. **その版が後続プロセスをゲートする** — 版が上がらないと着手できないプロセスが roadmap にある
2. **その版自体が納品物であり、roadmap 管理下の実装 artifact を消費する publish プロセスの出力である**

spec 版は手段成果物であって納品物ではないため、1 にしか該当しえない。
つまり spec の版が上がったこと自体は artifact を起こす理由にならない。
npm・Marketplace の公開版は 2 に該当するが、roadmap 管理下の実装 artifact を含まない版（`flow:exempt` の修正のみで出た版等）は起こさない。

この規定の帰結として、**roadmap の版チェーンが実体の現行版より古いことは、それ自体では欠陥ではない**。
公開された版の履歴の一次情報は roadmap ではなく、spec は `docs/spec/spec-history.md`（`scripts/check-spec-history.mjs` が release 前に機械検査する）、npm は npm レジストリ、extension は Marketplace である。
artifact の `criteria` が図に存在しない版番号に言及していても同じで（例: `boundary_feedback` の「spec v0.0.12 に統合済み」）、その版番号は上記の一次情報を指す外部参照として読む。
`revises:` チェーンは起こした版どうしを繋ぐものであり、飛んだ版番号の存在は線形性の違反にならない。

判定の実測は `pfdsl status blocked` / `status ready` で行う（版待ちのプロセスが実在するかを見る。「そのうち要るはず」で起こさない）。

**spec バージョン artifact の issue 管理**: `spec_vXXX` 系の artifact（spec_v007 / spec_v008 / spec_v009 等）は GH issue 管理対象外。「完了した issue をクローズ」ゲートは NA とする（artifact の criteria 達成のみで完了を判断する）。

**spec 統合プロセスの前バージョン入力**: 新しい `integrate_spec_vXXX` プロセスを roadmap に追加する際は、前バージョンの spec artifact への `revises:` を新バージョン artifact に設定する（例: `spec_v0011.revises: spec_v0010`）。`>>?` フィードバック入力は使わない — V011（strict mode の feedback 到達性検査）は `>>?` を前方到達可能な修正ループとして検査するが、版の前後関係はそれに当たらず誤検出になる（#480 で `spec_v006 >>? integrate_spec` 等を `revises:` に置き換えて解消）。

**`integrate_spec_vXXX` の入力列挙**: `integrate_spec_vXXX` の通常入力には、そのバージョンで spec に統合される全ての変更を引き起こした artifact を列挙する。「実装が完了した artifact のうち、未統合のもの」を漏らさず書く（例: basepath と ready_cmd の両方が v0.0.10 の変更点なら `[basepath, ready_cmd] >> integrate_spec_v0010`）。

**publish_cli_vXXXX の入力列挙**: そのバージョンに含まれる全実装 artifact を入力として列挙する。実装 artifact の追加と同一サイクルで publish の入力集合も更新する（後回しにすると artifact が publish チェーンから切れる）。

**1公開イベント = 1 リリース artifact**: 計画段階で複数のリリースに分けていた実装群が結果的に1回の公開にまとまった場合、publish プロセスとリリース artifact も1つに統合する。
同じ版番号を持つ artifact を複数残すと、図が実在しない公開イベントを主張することになる。
統合したノードの `description` には、計画上いくつのリリースだったかを書く（統合の事実が失われると、入力集合が肥大しただけに見える）。

**レビュー findings の残余系 artifact（`i300_spec_editorial` 等）**: `description` に個別 finding 番号（例: F1, F2）を issue 番号付きで除外列挙している場合、その finding が個別 issue として切り出される都度、切り出し先 issue の PR と同一コミットで除外列挙に追記する。一次情報（レビュー findings 表）との二重管理になるため、追記漏れは列挙ドリフトの原因になる。
