# roadmap.md — issue 管理バインディング（roadmap.pfdsl の companion）

この companion を読んだ後、pfd-ops スキルが未ロードならロードし、`references/work-cycle.md` の運用契約とサイクル手順を確認すること（ロード済みなら再ロード不要）。

`roadmap.pfdsl` は issue 依存構造のみ管理する。issue の一次情報と同期手段はここに書く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## バックエンド

GitHub Issues。規約と採用手順は `.claude/skills/pfd-ops/references/github-issues-backend.md`（L3 プリセット）に従う。

## このリポのインスタンス値

- 一次情報: github.com/takasek/pfdsl/issues
- 同期監査スクリプト: `scripts/pfdsl/audit-issues-flow.mjs`（読取専用）
- 完了チェーン回収スクリプト: `scripts/pfdsl/sweep-completed-chains.mjs`（`--write` なしは列挙のみ。デフォルトブランチへの push で `.github/workflows/pfdsl-sweep-completed-chains.yml` が実行し PR を起票する）
- 監査対象: `.pfdsl/roadmap.pfdsl`

## 運用対象の計画 PFD

ワークサイクルの選択ステップが列挙する対象:

- `.pfdsl/roadmap.pfdsl` — オープン issue の依存グラフ

**保持範囲**: 規則は L3 reference「完了チェーン回収」が一次情報。
このリポで完了履歴を持つ一次情報は closed issue・git 履歴・`docs/adr/`・`docs/spec/spec-history.md`・npm レジストリ・VS Code Marketplace で、#1052 の一括回収でこれらへの写しを roadmap から落とした。

## プリフライト・ゲート集約スクリプト（#354）

- **選択フェーズ（pfd-ops 手順1）**: `GH_HOST=github.com node scripts/cycle-status.mjs` — fetch 実行・base への遅れコミット数・open PR の一覧・`status ready --best` の結果を1回の JSON 出力に集約する。`--base <branch>` で対象ブランチを変更可能（デフォルト `main`）。加えて次の情報を出力する（#461）:
  - 対象 issue の本文・コメントを fetch し、設計確定状態を出力する（#669）。実行前に知る必要があるのは対象 issue の決まり方だけで、`--issue <n>` が最優先、無ければ best プロセスの `location:` から解決する。どちらからも対象 issue 番号が得られない場合は設計確定判定を出さないが、この理由だけでは拒否せず終了コードは0になる。対象 issue の取得失敗は issue identity を保持した blocking 結果となり、終了コードも非ゼロになる。フィールドの構造と各値の意味はここに列挙しない（#913）— 設計確定判定は `scripts/lib/cycle-status.mjs` の `classifyDesignSettlement`、取得失敗時の停止は `scripts/lib/cycle-status-steps.mjs` の `runCycleStatus` と `cycleStatusExitCode` が一次情報
  - `designUnsettledFor` の `unsettled: true` は終了コードを変えない報告である。`reason` を読み、`.claude/skills/pfd-ops/references/work-cycle.md`「選択後の設計確認」に従って着手前に対応する。
  - `behindBase > 0` のときは判定を一切出さず `staleTree`（`{base, message}`）と `behindBase` だけを返し、終了コード 1 で拒否する（#716）。`origin/<base>` を起点にサイクルのブランチを切ってから実行する（遅れたツリーで古い版が走ること・その拒否は拒否する版でしか起きないことは work-cycle.md 手順1 が一次情報）
  - `currentBranch` と `commitsAheadOfBase`（`origin/<base>..HEAD` の件数）を出力する（#629）。0 でなければ前サイクルのブランチに乗っている可能性を示すが、既存ブランチの意図的な継続もあるためスクリプトは拒否せず判断を残す
  - 作業ツリーに未コミットの変更（追跡外ファイルを含む）があるときは、`behindBase` と同じく判定を一切出さず `uncommittedFiles` と `dirtyTree` だけを返し、終了コード 1 で拒否する（#744）。前サイクルの変更はブランチを切り替えてもツリーに残り、次サイクルの最初のコミットに紛れ込む — `commitsAheadOfBase` が塞ぐのと同じ失敗の型で、経路がコミットでなく作業ツリーであるだけ。`commitsAheadOfBase` と違い判断を残さず拒否するのは、サイクルは clean なツリーから始める前提であり、`git worktree add` がそれを作るため、拒否への答えが「weigh する」でなく「worktree を切る」で済むから。ツリーが base に遅れかつ汚れている場合は遅れの方を返す（走っているスクリプト自身が古い版だという判定が、汚れの判定の信頼性も奪う）
  - **草案は投稿前に `node scripts/check-design-record.mjs --file <草案のパス>` へ通す（#1114）。** 旧時刻ゲートが補修を妨げた経緯は `.pfdsl/bindings/pfd-retro-patterns/record-timing-anchor-vs-work-unit.md` が一次情報。
  - 設計選択記録の雛形を `designRecordTemplate`（`{note, lines}`）で毎回出力する（#720）。行頭の語は `gate-check.mjs` の `DESIGN_RECORD_REQUIRED_PREFIXES` / `DISPOSITION_TOKENS` から引いており、散文に転記していない。対象 issue が候補を列挙している場合はその件数を添えた処分の行が加わる
  - 公開 pending を `releasePending`（`{needsAction, report}`）で出力する（#814）。`scripts/release-status.mjs` をそのまま走らせた結果で、`needsAction` はその終了コード、`report` は印字された行。判定でなく報告材料で、pending は公開直後を除いて常に nonzero になる。`needsAction` が何を畳み込むか、なぜそこで止まるかは `scripts/lib/release-status-check.mjs` の `needsAction` の JSDoc が一次情報 — ここには複製しない（#880）。運用上知っておく必要があるのは、false が「公開までにやるべきことが残っていない」であって「`make release` が成功する」ではないこと、true の理由は `report` の行にしか出ないので読むのは行のほうになること、の2点。台帳へ書き写す運用を置かないのは、値の一次情報が npm レジストリ・Marketplace・git であり、書き写した側は無視されたうえに古くなるため
  - このサイクルが着手する issue のうち、`flow:managed` なのに roadmap に process を持たないものを `unregisteredManagedIssues`、roadmap に process がなく `flow:managed` と `flow:exempt` のどちらも持たないものを `untriagedTargetIssues` で出力する（#963、#983）。`audit-issues-flow.mjs` は同じ欠落を全 open issue について報告するが advisory 止まりで、監査を落とさない — roadmap 登録は実装ブランチに乗るため、そのブランチが main へマージされるまで他セッションからは欠落して見え、未分類 issue は GitHub 上で分類されるまで一時的に全セッションから未分類に見える。あるサイクルの差分が消せるのは自分が着手する issue の欠落だけで、他の issue の分は消せない。行動できるのがその1件だけなので、ここが唯一の検査点になる。どちらかが非空で返ってきたら、着手前に roadmap へ依存チェーンを1本足して `flow:managed` を付けるか、`flow:exempt` へ分類するかのどちらかを済ませる — どちらでもないまま進めた回は、その issue の登録または分類が誰の担当でもないまま残る

  - best 候補プロセスの出力 artifact キーを `status ready --json` の `outputs` フィールドから引き、実行すべき `gate-check.mjs --artifact <key>` の完成形コマンド行を `gateCheckCommand` で出力する（転記ミス・フォールバック判定への意図しない低下を防ぐ。roadmap.pfdsl 自前 regex パースは二重パースで構文変更に弱いため CLI 側の `outputs` フィールドを正とする）
- **終端ゲートの実行（pfd-ops 手順3）**: `workflow.md`「終端ゲートの根拠」に従う。対象 issue を含むコマンド構築規則も同節に置く。
- `cycle-status.mjs` と `gate-check.mjs` は `packages/cli/dist/cli.js` の存在を前提にする箇所がある（ビルドの前提は `workflow.md`「worktree でのサイクル実行」の「worktree 前提」）。`gate-check.mjs` はビルド未完了でも最後まで走り、項目名・SKIP 条件・正本への固定案内は印字される（CLI に依存する `pfdsl check` と gen-plugin identity の2項目だけが FAIL。実測 #560）

## Open PR（ワークサイクル選択前に確認）

`node scripts/cycle-status.mjs` の `openPRs` で PR の番号とタイトルを確認し、今回の作業に競合するかを判断する。

`.pfdsl/roadmap.pfdsl` を編集する PR には `check-roadmap-registration.yml` が付く（#963）。
`node scripts/check-roadmap-registration.mjs --pr <n>` が PR の `closingIssuesReferences` から issue を導き、`audit-issues-flow.mjs --enforce-issue <n>` でその issue の `missing_process` だけを FAIL へ昇格させる。
対象集合を PR 自身から導くのは、実行主体が渡すフラグに依存させないため。
`edited` を trigger に含めるのは `check-closes-reference.yml` と同じ理由で、PR 本文の編集が対象集合を変えるからである。

**`gh` CLI が使えない環境（Claude Code Remote 等）での代替**: `cycle-status.mjs` / `gate-check.mjs`（内部の `audit-issues-flow.mjs`）は `gh` を呼ぶが、`github-ops.mjs` が `GH_TOKEN` / `GITHUB_TOKEN` のある環境では HTTP backend へ落ちる（#489・#1044）。`designRecordEditInfo` を含む HTTP backend 対応 operation は token だけの環境でも実行でき、これは選択済みコメントの GraphQL node ID を指定した単体取得である。token も無い場合は GitHub MCP server のツール（`list_pull_requests` / `issue_read` / `pull_request_read` 等）で個別に代替する: PR一覧は `list_pull_requests`、issue 本文の design-unsettled 判定は `issue_read`（`get`）で本文を読んで手動判定、`audit-issues-flow` 相当は対象 issue の `location:`・`updated_at:` を roadmap.pfdsl の記載と手動突合する。
`github-ops.mjs` の HTTP backend は上のリポ内スクリプトが必要とする operation の互換層であり、issue コメントや PR 本文の作成・編集を代行する汎用 GitHub write adapter ではない。
fallback の transport は REST だけではない — `closingIssuesReferences` は REST の pull request payload に存在せず、GraphQL へ直接問い合わせる（#1043）。
GitHub 側にしか無い読みを本文の正規表現で再構成すると、Development sidebar で手動リンクされた PR が「closing issue 0件」に見える。

`gate-check.mjs` の per-issue 行が SKIP になるのは `gh` バイナリ不在のときだけで、それ以外の lookup 失敗（存在しない issue 番号・認証・ネットワーク・fallback の戻り形不一致）は実エラーを detail に出して FAIL する（#745）。「gh CLI unavailable」と出ていない SKIP は無い — 検査が走らなかった行を環境のせいと読み違える余地を残さないため。

## 終端ゲート追加項目（issue 固有）

**タイミング規約**: issue クローズと flow 確定（下記「マージ時のみ」の2項目）は **main への PR マージ時**に行う（生態系図 merge_pr: 進捗・issue 更新はマージで正本になる）。PR 作成時点では行わない — PR がレビューで変わる/却下される可能性があるため。サイクルが PR 作成で終わる場合、この2項目は「マージ時に実施」と記録して未了のまま閉じてよい。**feature branch への中間 PR では `closes #xxx` を使わない**（理由と規約は L3 reference「PR 本文規約」が一次情報）。**出力 artifact の status done 更新はこれに含まれない** — develop 完了時点（PR 作成前）で criteria 達成が言えるなら done にしてよい（pfd-ops の `references/work-cycle.md`「進捗と完了根拠」のデフォルト通り）。

**着手時**: develop ブランチを切った時点で、実装対象の出力 artifact を `todo → wip` に更新する（規則の一次情報は workflow.md「develop 着手時の artifact status 更新」）。

**着手前の選択記録**: 実装着手前に、選んだ方針を issue コメントとして残す。`--issue` を渡す全サイクルが対象で、issue が複数案を列挙しているかどうかは問わない（候補列挙のある回は各案の処分も要る）。選択を記録せず着手すると、issue 本文だけを読んだ第三者が「なぜその方針になったか」を実装差分からしか追えなくなる。
書式は覚えなくてよい — `cycle-status.mjs` が `designRecordTemplate` として毎回出すので、それを埋めて投稿する。
投稿した直後に `gate-check.mjs --issue <n>` を回して design-selection record の書式・再承認の判定を通す。
記録の欠落、形式不備、曖昧な正本、不正な再承認は FAIL にする。記録の投稿・編集と初コミットの時刻比較は行わない。
記録漏れや書式不備は同じ記録を補修する。決定を変更する場合は必要な再承認と改訂履歴を残し、既存実装との整合を確認して通常の追加コミットで直す。コミットの再作成や日時の変更を回復手順にしない。

汎用ゲート（status 更新 / check 通過 / 論理単位コミット / PR 集約）に加え、**マージ時にのみ**:

- [ ] 完了した issue をクローズし、進捗・新発見を issue に反映した
- [ ] close 時の降格規則を適用した（定義は L3 reference。専属 process も含めて削除する）

**PR 本文の `Closes` キーワード**: L3 reference「PR 本文規約」に従う（main 直接マージのみ使用・中間 PR では使わない）。
判定は CI の `check-closes-reference.yml` が持ち、終端ゲートには項目を置かない — 根拠は GitHub が本文から導出する issue リンクであり、PR 作成前に走る終端ゲートの時点ではリンクも本文も存在しない。
トークンの有無でなくリンクの有無を見るため、コードフェンス内の `Closes #<n>` は通らない。

**hotfix PR の明示**: 緊急修正（バグ修正、誤り修正）を PR にのせる場合は description 冒頭に `hotfix:` を明記する。レビュー優先度・マージ判断の依拠になる。
`check-closes-reference.yml` がこの行を読み、issue を閉じない PR を hotfix として通す唯一の経路にしている — コロンまで含めて一致させる（L3 reference は「"hotfix" と明記」とだけ書くが、機械が読むのはこちらの厳しい形）。

- [ ] このサイクルで起票した issue を `flow:managed` / `flow:exempt` に分類した（判定は L3 reference の「ラベル判定基準」。保守・基盤・修正は exempt）
- [ ] `flow:managed` の issue がすべて roadmap.pfdsl の artifact として登録済みか確認した（exempt は登録しない）
- [ ] `node scripts/pfdsl/audit-issues-flow.mjs` が差分なしで通過した（手動追記した `updated_at` のズレを機械的に検出する。`gate-check.mjs` 実行時はその一部として自動実行される）

**バージョン artifact を起こす契機と criteria の形**: 規定の一般形は `.claude/skills/pfd-ops/references/work-cycle.md` の「成果物の門番」が一次情報（#729 で昇格）。
ここにはこのリポのインスタンス値だけを置く。

- 対象ノード: `spec_vXXX` / `cli_release_*` / `ext_vXXXX`
- 版履歴の一次情報: spec は `docs/spec/spec-history.md`（`scripts/check-spec-history.mjs` が release 前に機械検査する）、npm は npm レジストリ、extension は Marketplace
- criteria の具体形: npm は `npm view @pfdsl/cli versions に 0.0.11 が含まれる`、extension は `npx @vscode/vsce show takasek.pfdsl --json の versions に 0.0.14 が含まれる`
- 契機2 の除外: npm・Marketplace の公開版でも、roadmap 管理下の実装 artifact を含まない版（`flow:exempt` の修正のみで出た版等）は起こさない
- artifact の `criteria` が図に存在しない版番号に言及していてもよい。その版番号は上の一次情報を指す外部参照として読む

このリポで最新1件しか返さない手段に当たるのは `npm show @pfdsl/cli version` と「Marketplace の takasek.pfdsl version」で、どちらも dist-tag `latest` を返す（#724）。それを criteria の判定手段に据えると何が起きるかは品質ガイド「criteria は判定できる形で書く」が一次情報。
`scripts/release-status.mjs` が使う gallery API 呼び出しは `flags: 514` + `pageSize: 1` で最新1件しか返さない — 同じ Marketplace を引く呼び方でも作用域が違うので、criteria の検証手段に流用しない。

**spec バージョン artifact の issue 管理**: `spec_vXXX` 系の artifact は GH issue 管理対象外。「完了した issue をクローズ」ゲートは NA とする（artifact の criteria 達成のみで完了を判断する）。

**spec 統合プロセスの前バージョン入力**: 新しい `integrate_spec_vXXX` プロセスを roadmap に追加する際、前バージョンの spec artifact が上の保持範囲でグラフに残っていれば、新バージョン artifact に `revises:` を設定する。
残っていなければ設定しない — 版の前後関係の一次情報は `docs/spec/spec-history.md` で、参照先のないフィールドを書いても `check` が dangling として落とすだけである。
起こしていない版を飛ばして繋いでよい（#725 で `spec_v0010` を削除した結果が現にこの形）。`>>?` フィードバック入力は使わない — V011（strict mode の feedback 到達性検査）は `>>?` を前方到達可能な修正ループとして検査するが、版の前後関係はそれに当たらず誤検出になる（#480 で `>>?` を `revises:` に置き換えて解消）。

**`integrate_spec_vXXX` の入力列挙**: `integrate_spec_vXXX` の通常入力には、そのバージョンで spec に統合される全ての変更を引き起こした artifact を列挙する。「実装が完了した artifact のうち、未統合のもの」を漏らさず書く。

**publish_cli_vXXXX の入力列挙**: そのバージョンに含まれる全実装 artifact を入力として列挙する。実装 artifact の追加と同一サイクルで publish の入力集合も更新する（後回しにすると artifact が publish チェーンから切れる）。

**1公開イベント = 1 リリース artifact**: 計画段階で複数のリリースに分けていた実装群が結果的に1回の公開にまとまった場合、publish プロセスとリリース artifact も1つに統合する。
同じ版番号を持つ artifact を複数残すと、図が実在しない公開イベントを主張することになる。
統合したノードの `description` には、計画上いくつのリリースだったかを書く（統合の事実が失われると、入力集合が肥大しただけに見える）。

**レビュー findings の残余系 artifact（`i300_spec_editorial` 等）**: `description` に個別 finding 番号（例: F1, F2）を issue 番号付きで除外列挙している場合、その finding が個別 issue として切り出される都度、切り出し先 issue の PR と同一コミットで除外列挙に追記する。一次情報（レビュー findings 表）との二重管理になるため、追記漏れは列挙ドリフトの原因になる。
