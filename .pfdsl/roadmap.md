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
  - 対象 issue の本文・コメントを fetch し、設計確定状態を `designUnsettledFor`（`{issue, source, unsettled, reason, matchedLines, optionCount, record, recordRequired}`）で出力する（#669）。`reason` は `phrase`（未合意フレーズ一致）/ `enumerated-options-without-record`（候補2件以上かつ設計選択記録なし）/ `record-posted` / `no-enumerated-options`。`unsettled` は「設計対話が必要か」だけを表し、`no-enumerated-options` も含め `record-posted` 以外は常に `true`（列挙構造を検出できなかった回を対話省略可の既定にしない fail-close、#833）。`recordRequired` は record 投稿の要否を別軸で表す独立フィールドで、`record-posted` のときだけ `false`、それ以外は常に `true`（列挙構造の有無に関わらず design-selection record は全サイクル必須という規約と、`unsettled: false` を「記録不要」と誤読した実測 #809 を受けて `unsettled` から分離した、#868）。対象 issue は `--issue <n>` が最優先（`source: "flag"`）、無ければ best プロセスの `location:` から解決する（`source: "best-process"`）。どちらも得られない場合は `null` + `designUnsettledError` を返す — 旧 `designUnsettled` フィールドはどの issue に対する判定か区別できず、roadmap 非管理の issue に着手する回で無関係な判定を確定の根拠に取り違える経路になっていた
  - `behindBase > 0` のときは判定を一切出さず `staleTree`（`{base, message}`）と `behindBase` だけを返し、終了コード 1 で拒否する（#716）。プリフライトは作業ツリー内のスクリプトなので、遅れたツリーではその古い版が走り、出力は「どの判定が存在するか」からして古い版のものになる。`origin/<base>` を起点にサイクルのブランチを切ってから実行する。**この拒否は拒否する版へ更新されたツリーでしか起きない**ので、古い版のツリーでは `behindBase` を自分で見る
  - `currentBranch` と `commitsAheadOfBase`（`origin/<base>..HEAD` の件数）を出力する（#629）。0 でなければ前サイクルのブランチに乗っている可能性を示すが、既存ブランチの意図的な継続もあるためスクリプトは拒否せず判断を残す
  - 作業ツリーに未コミットの変更（追跡外ファイルを含む）があるときは、`behindBase` と同じく判定を一切出さず `uncommittedFiles` と `dirtyTree` だけを返し、終了コード 1 で拒否する（#744）。前サイクルの変更はブランチを切り替えてもツリーに残り、次サイクルの最初のコミットに紛れ込む — `commitsAheadOfBase` が塞ぐのと同じ失敗の型で、経路がコミットでなく作業ツリーであるだけ。`commitsAheadOfBase` と違い判断を残さず拒否するのは、サイクルは clean なツリーから始める前提であり、`git worktree add` がそれを作るため、拒否への答えが「weigh する」でなく「worktree を切る」で済むから。ツリーが base に遅れかつ汚れている場合は遅れの方を返す（走っているスクリプト自身が古い版だという判定が、汚れの判定の信頼性も奪う）
  - 設計選択記録の雛形を `designRecordTemplate`（`{note, lines}`）で毎回出力する（#720）。行頭の語は `gate-check.mjs` の `DESIGN_RECORD_REQUIRED_PREFIXES` / `DISPOSITION_TOKENS` から引いており、散文に転記していない。対象 issue が候補を列挙している場合はその件数を添えた処分の行が加わる
  - 公開 pending を `releasePending`（`{needsAction, report}`）で出力する（#814）。`scripts/release-status.mjs` をそのまま走らせた結果で、`needsAction` はその終了コード、`report` は印字された行。判定でなく報告材料で、pending は公開直後を除いて常に nonzero になる。`needsAction` は版比較と skill bundle のコミット数だけから出るため「`make release` が通るか」より狭い — distribution review の陳腐化と spec-history の未追随はどちらも `report` の行にしか出ない（`release.mjs` はその2つでも止まる）。読むのは行のほうで、boolean はその安い一部にすぎない。台帳へ書き写す運用を置かないのは、値の一次情報が npm レジストリ・Marketplace・git であり、書き写した側は無視されたうえに古くなるため
  - best 候補プロセスの出力 artifact キーを `status ready --json` の `outputs` フィールドから引き、実行すべき `gate-check.mjs --artifact <key>` の完成形コマンド行を `gateCheckCommand` で出力する（転記ミス・フォールバック判定への意図しない低下を防ぐ。roadmap.pfdsl 自前 regex パースは二重パースで構文変更に弱いため CLI 側の `outputs` フィールドを正とする）
- **終端ゲートの機械項目 + 報告材料2種（pfd-ops 手順3・#462）**: `GH_HOST=github.com node scripts/gate-check.mjs [--base main] [--artifact <key> | --no-artifact] [--issue <n> ...]` — 内部で `git fetch origin` を試みたうえで `origin/<base>...HEAD` を基準に差分を取る（fetch 失敗時も既存 remote-tracking ref で続行し、ref 自体が無ければ明示エラーで終了する）。**項目名・PASS/FAIL/SKIP の判定・SKIP 条件はここに列挙しない** — スクリプトの出力が自己記述的であり、実行すれば全項目が detail 付きで印字される（#560。列挙をここに置くとスクリプト変更のたび手で追随することになり、追随を保証する機構が無い）。`--artifact <key>` を渡すと status 更新・wip 経由の両方をその artifact に厳密スコープする（省略時はどちらも粗いフォールバック判定になる旨を detail に明示）。出力 artifact を持たないサイクル（`flow:exempt` の bookkeeping 等）は `--no-artifact` で宣言する — `roadmap.pfdsl` を status 以外の理由で触ると、宣言なしでは構造的に FAIL する（#564）。表のほかに2種の報告材料が印字される（PASS/FAIL でなく判断材料）: 変更 `.pfdsl` ごとの新規終端 artifact リスト（`graph io` 差分。手段か納品物かの分類のみ MANUAL に残る）・`roadmap.pfdsl` 変更時の ready-set 差分（newly ready / no longer ready、手順4の報告に使う）。判定不能な残り項目は `MANUAL:` prefix で列挙される — 抽出元は `scripts/lib/gate-check.mjs` の `GATE_CHECKLIST_SOURCE_PATH` が指すファイルの終端ゲートチェックリストで、実行時に抽出するため手打ちコピーは持たない。その項目のみ個別に確認する
- **そのサイクルが閉じる issue を毎サイクル全て渡す（#669・#734）**: `--issue <n>` は繰り返し指定でき、渡した issue ごとに `design-selection record` と `knowledge-artifact size direction` の2項目が1行ずつ評価される。省略すると両項目とも SKIP する（対象 issue を推測しないため）。複数 issue を閉じる回で1件しか渡さないと、渡さなかった issue はゲートを一度も通らないまま表は緑になる — 選択記録の保証が必要なのは閉じる N 件すべてであって、そのうち1件ではない。判定条件は他項目と同じくスクリプト出力の detail が自己記述する — ここには列挙しない。運用側が事前に知る必要がある入力契約は4つで、選択記録の書式は L3 reference「設計確定の証拠」、知識成果物の縮小を目的とする issue は本文に行頭 `Size-Intent: shrink` を書く（これが無い回はサイズ方向の判定を行わない — 語句一致で意図を推し量ると、他 issue の案名を引用しただけで発火する）、サイズ増加を意図的に通す回はコミット trailer の `Size-Override: <理由>`（理由なしの素通しを避けるためトークンだけでは通らない。`Review:` と同じ trailer 領域を走査するので、散文中に書いても宣言にはならない）、実装しないと決めた回は選択記録に行頭 `実装しない: <理由>` を書く（これが無い回は通常どおり timing 判定を行う — `Size-Intent: shrink` と同じ行頭一致で判定するため、前提・否定案・却下理由の中でこの語に触れるだけでは宣言にならない）。宣言の有無に関わらず、変更された知識成果物のバイト・行差分は報告材料として常に印字される。`cycle-status.mjs` の `gateCheckCommand` にはこのフラグが埋め込まれるので、そのままコピーすれば渡し漏れない。`cycle-status.mjs` 側の `--issue` も繰り返し指定でき、渡した分だけ `designUnsettledFor` に判定が並び、`gateCheckCommand` にも全件が並ぶ — サイクルが閉じる issue が preflight の時点で分かっているなら、そこで全て渡しておけば終端ゲートへの転記で落ちない
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

**コード変更のあるサイクルはレビューを省略しない**: `packages/` または `scripts/` に変更があるサイクルでは、終端ゲートの該当チェックリスト項目を省略しない。
#561 が 48 サイクル（目標 10）を実測し、自己レビューで気付いていなかった指摘が 85% のサイクルで出た（new/adopted 合計 142/119）。
「どういう条件なら省略してよいか」を条件式として書ける、という前提が実測に支持されなかったため、条件を置かず必須とする。
散文・PFD のみのサイクルは記録を要さない（レビューの要否は diff の規模で別に判断し、省略する回はその理由を PR 本文に書く）。
自己レビュー（差分の読み直し）は実施済みとみなし、それに**加えて**軽い設定のレビューを実施する（角度を絞る。8角度 × 検証 agent の高効度設定は使わない）。

menu は「どの手段を選ぶか」の優先順でなく「**どの観点が担保されたか**」で組む。
手段を1つに固定すると、その手段が探さない型の欠陥だけが常に無担当になる — 実測（#836）で `/simplify` 4角度が findings なしだった回に、別レビューが採用案の adoption rationale 不成立と JSDoc の事実誤認の2件を検出した。
そこで手段を固定せず、観点ごとにブリーフ要件を課す。

1. **観点1 — 品質（簡素化・保守性）。** `/simplify` を使う。常に使え、PR 作成前でも回せる。角度は4つ固定。`/simplify` は correctness を明示的には探さない — skill 本文が「Do not look for correctness bugs — that is what /code-review is for」と宣言しており、この観点の実施だけをレビュー済みの根拠にしてはならない。
2. **観点2 — correctness。** コード変更のある全サイクルで担保する。ブリーフ要件は (a) diff が導入・変更した事実主張（コメント・JSDoc・doc 散文・criteria 文言）を列挙し、各主張の**反証を試みる**こと（真偽判定でなく偽になる入力・状態を構成させる — 追認バイアスを falsification に固定するため）、(b) 変更行の外の消費者（散文を含む）を読んでよいこと（`/code-review` の bug 角度が持つ「shallow scan, avoid extra context」の逆を明示する）。軽量 subagent 1本を想定する。
3. **観点3 — 設計妥当性。** 条件付き発火 — そのサイクルが複数案から採用を選んだ場合のみ、つまり選択記録に否定案がある回に限る。ブリーフ要件は (a) 結論・採用理由を伏せて同じ設計問題を独立に解かせること（採用案を見せて攻めさせると提示解にアンカーされるため、検出機構の本体は敵対的姿勢でなく独立性に置く）、(b) 採用案の adoption rationale を名指しし、実装がそれを満たさない箇所を敵対的に探させること。観点2 の要件を含むため、発火した回は観点2 の別実行を要さない。
4. **観点4 — 体験（シナリオ実行）。** 条件付き発火 — ユーザー可視の挙動・同梱内容を変える回に限る（終端ゲートの release-status 項目と同じ判定軸を流用し、新しい判定を発明しない）。ブリーフ要件は (a) subagent に成果物（doc・CLI・skill 本文）と現実的シナリオのみ渡し変更内容・意図は渡さないこと、(b) 詰まった箇所・誤読した箇所を、原因となった記述や出力の引用付きで報告させること、(c) 合否判定を伴う場合は実物（checker・実行結果）で採点し自己申告にしないこと、(d) シナリオには変更が壊しうる既存動線を最低1本含めること（作者がシナリオを選ぶと通る道を選びがちなことへのガード）、(e) 原因の説明を求める場合は引用と別の枠に置かせ、その枠の内容を起票時に事実として転写しないこと。
要件 (a) はこの subagent に実装も変更意図も渡さない — したがって報告に現れる原因はすべて推測であり、引用と地続きに書かれると起票時に観測と区別が付かなくなる。
実際に #844 は「隣接の種別は id から推測できない」を原因として抱えたまま起票され、実測（555 エッジで同種端点 0 件）で誤りと判明したのは実装着手後だった。`distribution-review`（plugin バンドル読者の模擬）と `spec-stress-test`（spec write-probe）はこの観点のドメイン特化版であり、その領域はそちらへ委ね、観点4 は CLI UX・拡張機能挙動等の未カバー領域へ汎用のブリーフ要件を与える。

**全観点共通**: finding には具体的な failure scenario（入力・状態 → 誤出力/誤誘導）を必須とし、構成できない指摘は報告しない（敵対的指示は「何か見つけねば」圧で false positive を量産するため）。

**発火した観点は軽くしてよいが、消してはならない**: 観点の発火条件（何を担保するか）と、その観点にかける重さ（subagent へ委譲するか自分で読むか）は別軸である。
散文のみのサイクルでも条件付き観点は発火しうる — 配布同梱物の散文変更は観点4 の発火条件を満たす。
diff の規模を理由に重さを落とした回は、落とした観点の名前と落とした理由を PR 本文に書く。

`/code-review` は PR 作成後・大 diff の補完レビューへ降格し、**ゲート充足手段からは外す** — trailer はコミット前必須であり、PR 後に走る `/code-review` は構造的にゲートを満たせないためで、これは規約変更でなく役割分離である。
`code-reviewer` agent を Agent tool で起動する手段は **導入が前提** — `pr-review-toolkit` / `feature-dev` plugin のいずれかを有効化していないと選べない。

起動可否は harness と plugin の版に依存する。過去に「AI からは起動できない」と記録された手段でも、規約に従う前にその回の実体（コマンド定義の `disable-model-invocation`）を確認する。2026-07-28 時点で `/code-review` は `disable-model-invocation: false`。

記録はコミットの trailer に置き、`tool=` でどれを回したかを書く。
**1サイクルで複数回レビューしたら、その回数だけ書く** — 自己レビュー → ツール → 指摘対応、と複数パスが走るのが普通で、1本に丸めると何が何を見つけたかが失われる。

```
Review: tool=simplify
Review: tool=correctness
```

`tool` の値は `simplify` / `correctness` / `design` / `experience` / `code-review` / `code-reviewer-agent` の6つ。
6つ以外の値、または `tool=` を欠く行は malformed として FAIL する。
ゲートを充足するのはこのうち `code-review` を除く5値 — `code-review` は有効な trailer 値として記録は残せるが、ゲート充足には数えない。
コード変更のある回はさらに `correctness` または `design` の記録を最低1本要する。
`design` は観点2 の要件を包含するため、`correctness` の代替になる。
diff の規模に合わせて委譲せず自分で読んだだけの回は `Review:` 行を書かない。
**レビューはコミットの前に回す。** trailer は commit message の一部であり、後から追記できない。
終端ゲートで気付いた時点で push 済みなら、trailer の追加は履歴の作り直しになる。
記録先をファイルにも PR 本文にもしないのは、前者が並列 worktree で追記コンフリクトを起こし（ADR-0026 が同型の記録機構を廃止した理由）、後者は終端ゲート実行時点でまだ存在しないため。
記録漏れは終端ゲートと CI（`check-review-record.yml`）が判定する。
どちらも `classifyCycle` を呼び、`packages/` / `scripts/` への変更があるのに記録が無い回、またはコード変更があるのに `correctness`/`design` の記録が無い回を FAIL にする。
**判定は path だけを見る**（#789）。
以前は `sample=in` / `sample=out` の二値を手で書き、その値と path 判定の食い違いも検査していたが、`scripts/` 配下の純散文変更では必ず食い違うため撤去した。
散文だけを変えた回も記録を書く側に倒れる — その回に軽いレビューを1本回すコストは、同じ二値の分類を人と機械の双方に維持させるコストより小さい。

develop 完了時点（PR 作成前、マージを待たない）で:

- [ ] 変更が公開物の挙動・同梱内容を変える場合（CLI 出力・拡張機能の動作変化に加え、plugin 同梱物 = 配布スキル群・pfd-* コマンド・agents（`make gen-plugin` の対象）の変更を含む — パスでなく挙動と同梱内容で判定）、npm 公開・Marketplace 公開が必要か確認した（`make release-status` で behind を確認。pending をどこかへ書き写す必要はない — 次サイクルのプリフライトが `releasePending` として毎回一次情報から取り直す。#814）
- [ ] CLIコマンドを追加・変更した場合、HELP テキスト（`packages/cli/src/index.ts`）と README のコマンド一覧の両方を更新した
- [ ] 実装を subagent へ委譲した場合、戻り時に `git log origin/<branch>..HEAD` と open PR 一覧を確認し、委譲先がブリーフの留保作業（push・PR 作成・issue 操作）を実行していないか照合した
- [ ] コード変更のあるサイクルでは、観点1（品質）の記録に加えて観点2（correctness）または観点3（設計妥当性）の記録が入っていることを、コミット直前に確認した。レビュー実施とコミット作成の間に他の作業（PR 作成・push 等）を挟むと記載を失念しやすい — 実施済みで未記載のまま次の作業に進んでいないか、コミット直前に再確認する

**サイクルは worktree で回す**: ブランチをルート作業ツリー（`~/works/pfdsl` 直下）で切らない。ルートツリーの HEAD は複数のセッションが共有する資源で、他セッションの `git stash` / `git switch` が自分の未コミット編集をツリーから取り去り HEAD を別ブランチへ移す。編集ツールは成功を返すため、消失は次に同じ箇所を触るまで検出されない。消えた編集を探すときは `git stash list` を先に見る（`git stash` は内部で reset を行うため reflog では `git reset` と区別がつかない）。

**worktree 前提**: 新規 worktree では CLI/core が未ビルドのため `check` も snapshot 更新も失敗する。ゲート実行前に `pnpm install && pnpm -r build` を済ませる。`.claude/skills/pfdsl` は gitignore 済の symlink（#348・#714）のため新規 worktree に存在せず、そのままでは `make check-docs` が companion-bindings の dead path で失敗する — `make setup`（または `node scripts/link-repo-skill.mjs`）を先に実行する。ビルドは不要。

**vscode-extension を変更した場合**: `pnpm --filter @pfdsl/vscode-extension typecheck` を実行してエラーがないことを確認してからコミットする。`noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` の strict 設定により、他パッケージの型変更が vscode-extension 側でエラーを起こす場合がある。クリック・ホバー等の UI 挙動変更（DocumentLinkProvider・HoverProvider 等）、または preview/export の描画内容変更（statusStyles・tag・group 解決ロジック等）を含む場合は `/vscode-ext-debug` スキルで PR 作成前に実動作確認し、ユーザーの確認結果を受け取るまで完了とみなさない。

**`docs/spec/spec.md` / `docs/samples/` を変更した場合**: workflow.md「生成物の再生成と自動ドリフト検査」に従う（再生成手続きの一次情報はそちら。ここには複製しない）。

**PR 本文の `Closes` キーワード**: L3 reference「PR 本文規約」に従う（main 直接マージのみ使用・中間 PR では使わない）。
判定は CI の `check-closes-reference.yml` が持ち、終端ゲートには項目を置かない — 根拠は GitHub が本文から導出する issue リンクであり、PR 作成前に走る終端ゲートの時点ではリンクも本文も存在しない。
トークンの有無でなくリンクの有無を見るため、コードフェンス内の `Closes #<n>` は通らない。

**worktree での git 操作**: `git commit` など git コマンドは worktree ディレクトリ（`.claude/worktrees/<name>/`）から実行する。pre-commit hook（`.git/hooks/`）は全 worktree 共有で、他ブランチのセッションが `make setup` を実行すると当該ブランチ版の hook に置き換わる — 自ブランチに存在しないファイル・ターゲットを hook が要求して commit が拒否されたら、自 worktree で `make setup` を実行して hook を入れ直す。main repo パスから実行するとその HEAD ブランチ（main など）にコミットが積まれる。
`scripts/main-commit-guard.mjs` は `git commit` に加えてツリー・インデックスを変える git コマンドも見る（#777。deny / ask を分ける原則は CLAUDE.md「コミット粒度」節、割り当ての一次情報は `scripts/lib/main-commit-guard.mjs` の定数）。
読み取り系は素通しするので、main repo のツリーを読むだけの操作は従来どおり動く。
**worktree のパスはシェル変数に入れず literal で書く**。
guard は hook の payload だけを見る静的解析なので `git -C $W commit` の `$W` を解決できず、payload の cwd（cwd が戻っていれば main repo）で判定して deny する。
`git -C /Users/.../.claude/worktrees/<name> commit` と書けば通る。
なお deny は Bash 呼び出し全体を止めるため、`git -C $W add … && git -C $W commit …` が弾かれたときは add も実行されていない。

**hotfix PR の明示**: 緊急修正（バグ修正、誤り修正）を PR にのせる場合は description 冒頭に `hotfix:` を明記する。レビュー優先度・マージ判断の依拠になる。
`check-closes-reference.yml` がこの行を読み、issue を閉じない PR を hotfix として通す唯一の経路にしている — コロンまで含めて一致させる（L3 reference は「"hotfix" と明記」とだけ書くが、機械が読むのはこちらの厳しい形）。

**`flow:exempt` は roadmap に登録しない**（保守・基盤・修正など roadmap 非管理。判定は L3 reference の「ラベル判定基準」）。

**新 frontmatter フィールドを追加した場合**: 対応する feature sample（`docs/samples/`）を同一 PR で追加する（生成物 `.dot` / README / `references/` の再生成・ドリフト検査は pre-commit と CI が強制する）。加えて `packages/core/src/__fixtures__/pipeline-scale.pfdsl` にもそのフィールドを追記する（fixture がスナップショットの入力であり、feature sample とは別に網羅性を担う）。

**`make gen-samples` 実行後**: `.dot` / `.svg` / README はいずれも決定論的（純 JS + `@pfdsl/preview-engine` の wasm graphviz）に生成されるため、再生成された全ファイルの差分をそのままステージしてよい（#588）。

- [ ] このサイクルで起票した issue を `flow:managed` / `flow:exempt` に分類した（判定は L3 reference の「ラベル判定基準」。保守・基盤・修正は exempt）
- [ ] `flow:managed` の issue がすべて roadmap.pfdsl の artifact として登録済みか確認した（exempt は登録しない）
- [ ] `node scripts/pfdsl/audit-issues-flow.mjs` が差分なしで通過した（手動追記した `updated_at` のズレを機械的に検出する。`gate-check.mjs` 実行時はその一部として自動実行される）

**バージョン artifact を起こす契機と criteria の形**: 規定の一般形は `.claude/skills/pfd-ops/SKILL.md` の「運用プロトコル」5（成果物の門番）にある2項目「版 artifact を起こす契機」「版 artifact の criteria は版一覧への包含で書く」が一次情報（#729 で昇格）。
ここにはこのリポのインスタンス値だけを置く。

- 対象ノード: `spec_vXXX` / `cli_release_*` / `ext_vXXXX`
- 版履歴の一次情報: spec は `docs/spec/spec-history.md`（`scripts/check-spec-history.mjs` が release 前に機械検査する）、npm は npm レジストリ、extension は Marketplace
- criteria の具体形: npm は `npm view @pfdsl/cli versions に 0.0.11 が含まれる`、extension は `npx @vscode/vsce show takasek.pfdsl --json の versions に 0.0.14 が含まれる`
- 契機2 の除外: npm・Marketplace の公開版でも、roadmap 管理下の実装 artifact を含まない版（`flow:exempt` の修正のみで出た版等）は起こさない
- artifact の `criteria` が図に存在しない版番号に言及していてもよい（例: `boundary_feedback` の「spec v0.0.12 に統合済み」）。その版番号は上の一次情報を指す外部参照として読む

`npm show @pfdsl/cli version` / 「Marketplace の takasek.pfdsl version」は dist-tag `latest`（＝常に最新版）を返すため、最新版を指す1件を除いて文字どおり偽になる（#724）。
`scripts/release-status.mjs` が使う gallery API 呼び出しは `flags: 514` + `pageSize: 1` で最新1件しか返さない — 同じ Marketplace を引く呼び方でも作用域が違うので、criteria の検証手段に流用しない。

**spec バージョン artifact の issue 管理**: `spec_vXXX` 系の artifact（spec_v007 / spec_v008 / spec_v009 等）は GH issue 管理対象外。「完了した issue をクローズ」ゲートは NA とする（artifact の criteria 達成のみで完了を判断する）。

**spec 統合プロセスの前バージョン入力**: 新しい `integrate_spec_vXXX` プロセスを roadmap に追加する際は、前バージョンの spec artifact への `revises:` を新バージョン artifact に設定する（例: `spec_v0011.revises: spec_v009`）。
起こしていない版を飛ばして繋いでよい（#725 で `spec_v0010` を削除した結果が現にこの形）。`>>?` フィードバック入力は使わない — V011（strict mode の feedback 到達性検査）は `>>?` を前方到達可能な修正ループとして検査するが、版の前後関係はそれに当たらず誤検出になる（#480 で `spec_v006 >>? integrate_spec` 等を `revises:` に置き換えて解消）。

**`integrate_spec_vXXX` の入力列挙**: `integrate_spec_vXXX` の通常入力には、そのバージョンで spec に統合される全ての変更を引き起こした artifact を列挙する。「実装が完了した artifact のうち、未統合のもの」を漏らさず書く（例: blocked_by と type_field と w002_hierarchy の3つが v0.0.11 の変更点なら `[blocked_by, type_field, w002_hierarchy] >> integrate_spec_v0011`）。

**publish_cli_vXXXX の入力列挙**: そのバージョンに含まれる全実装 artifact を入力として列挙する。実装 artifact の追加と同一サイクルで publish の入力集合も更新する（後回しにすると artifact が publish チェーンから切れる）。

**1公開イベント = 1 リリース artifact**: 計画段階で複数のリリースに分けていた実装群が結果的に1回の公開にまとまった場合、publish プロセスとリリース artifact も1つに統合する。
同じ版番号を持つ artifact を複数残すと、図が実在しない公開イベントを主張することになる。
統合したノードの `description` には、計画上いくつのリリースだったかを書く（統合の事実が失われると、入力集合が肥大しただけに見える）。

**レビュー findings の残余系 artifact（`i300_spec_editorial` 等）**: `description` に個別 finding 番号（例: F1, F2）を issue 番号付きで除外列挙している場合、その finding が個別 issue として切り出される都度、切り出し先 issue の PR と同一コミットで除外列挙に追記する。一次情報（レビュー findings 表）との二重管理になるため、追記漏れは列挙ドリフトの原因になる。
