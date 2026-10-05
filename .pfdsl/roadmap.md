# roadmap.md — issue 管理バインディング（roadmap.pfdsl の companion）

この companion を読んだ後、pfd-ops スキルが未ロードならロードし、`references/work-cycle.md` の運用契約とサイクル手順を確認すること（ロード済みなら再ロード不要）。

`roadmap.pfdsl` は issue 依存構造のみ管理する。issue の一次情報と同期手段はここに書く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## バックエンド

GitHub Issues。規約と採用手順は `scripts/harness-template/skills/pfd-ops/references/github-issues-backend.md`（L3 プリセット）に従う。

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

## プレビュー改善の管理単位

プレビューの表示・編集・移動は `i1352_i1282_i1283_i1284_i483_improve_preview` の一工程として扱う。
関連 issue と各出力 artifact は課題・実装・確認の内訳であり、別々の作業サイクルを要求しない。
当初の要望や criteria は見直しの対象とし、利用時の観察に合わせて改善範囲・完了条件・次に扱う課題を更新する。
現在の範囲と完了条件は [PR #1394](https://github.com/takasek/pfdsl/pull/1394)、対象版と確認結果は [受入記録](../packages/standalone/ACCEPTANCE.md)を参照する。
未確認を確認済みに読み替えず、今回扱うか次へ回すかをその記録で区別する。

入力は既存の依存を保持したため、`editor_connector` が wip の間は束全体の ready 判定もその前提待ちになる。
今回の先行着手は所有者が関連課題を今回の範囲に含めた指示に基づき、完了状態や依存を変更したことにはしない。
ゲートは `preview_editing_usability` を入口にできるが、それだけで各出力の確認済みや完了を認定せず、受入記録の内訳も確認する。

## プリフライト・ゲート集約スクリプト（#354）

- **選択フェーズ（pfd-ops 手順1）**: `GH_HOST=github.com node scripts/cycle-status.mjs` — fetch 実行・base への遅れコミット数・open PR の一覧・`status ready --json` の各工程の判断材料と新規 ready 数を1回の JSON 出力に集約する。`--base <branch>` で対象ブランチを変更可能（デフォルト `main`）。加えて次の情報を出力する（#461）:
  - 対象 issue の本文・コメントを取得し、`issueTargets` に対象と解決元を出力する。`--issue <n>` で明示した全件を扱い、指定なしなら対象を選ぶ案内と ready 一覧を返す。目的・期限・工数と併せて対象を選び、候補の `location:` が必要なら `meta get .pfdsl/roadmap.pfdsl <process-id> location` で取得して `--issue <n>` を明示して再実行する。設計の確定・未確定や記録の適否は機械判定せず、`manualChecks` が案内する binding「適用点 1 で採用案と対案を比較して設計を決める」に従う。対象未解決はエラー情報とコマンド未生成として報告し、その理由だけでは終了コードを変えない。取得失敗は対象 issue を保持して終了コードを非ゼロにする。終了コード0を一次資料や承認の確認済みと読まない。実装は `scripts/lib/cycle-status-steps.mjs` の `runCycleStatus` と `cycleStatusExitCode` が一次情報
  - `behindBase > 0` のときは判定を一切出さず `staleTree`（`{base, message}`）と `behindBase` だけを返し、終了コード 1 で拒否する（#716）。`origin/<base>` を起点にサイクルのブランチを切ってから実行する（遅れたツリーで古い版が走ること・その拒否は拒否する版でしか起きないことは `.pfdsl/bindings/pfd-ops.md`「ワークサイクルの追加手順」の「手順 1 の追加で worktree と upstream を確認する」が一次情報）
  - `currentBranch` と `commitsAheadOfBase`（`origin/<base>..HEAD` の件数）を出力する（#629）。0 でなければ前サイクルのブランチに乗っている可能性を示すが、既存ブランチの意図的な継続もあるためスクリプトは拒否せず判断を残す
  - 作業ツリーに未コミットの変更（追跡外ファイルを含む）があるときは、`behindBase` と同じく判定を一切出さず `uncommittedFiles` と `dirtyTree` だけを返し、終了コード 1 で拒否する（#744）。前サイクルの変更はブランチを切り替えてもツリーに残り、次サイクルの最初のコミットに紛れ込む — `commitsAheadOfBase` が塞ぐのと同じ失敗の型で、経路がコミットでなく作業ツリーであるだけ。`commitsAheadOfBase` と違い判断を残さず拒否するのは、サイクルは clean なツリーから始める前提であり、`git worktree add` がそれを作るため、拒否への答えが「weigh する」でなく「worktree を切る」で済むから。ツリーが base に遅れかつ汚れている場合は遅れの方を返す（走っているスクリプト自身が古い版だという判定が、汚れの判定の信頼性も奪う）
  - 公開 pending を `releasePending`（`{needsAction, report}`）で出力する（#814）。`scripts/release-status.mjs` をそのまま走らせた結果で、`needsAction` はその終了コード、`report` は印字された行。判定でなく報告材料で、pending は公開直後を除いて常に nonzero になる。`needsAction` が何を畳み込むか、なぜそこで止まるかは `scripts/lib/release-status-check.mjs` の `needsAction` の JSDoc が一次情報 — ここには複製しない（#880）。運用上知っておく必要があるのは、false が「公開までにやるべきことが残っていない」であって「`make release` が成功する」ではないこと、true の理由は `report` の行にしか出ないので読むのは行のほうになること、の2点。台帳へ書き写す運用を置かないのは、値の一次情報が npm レジストリ・Marketplace・git であり、書き写した側は無視されたうえに古くなるため
  - このサイクルが着手する issue のうち、`flow:managed` なのに roadmap に process を持たないものを `unregisteredManagedIssues`、roadmap に process がなく `flow:managed` と `flow:exempt` のどちらも持たないものを `untriagedTargetIssues` で出力する（#963、#983）。`audit-issues-flow.mjs` は同じ欠落を全 open issue について報告するが advisory 止まりで、監査を落とさない — roadmap 登録は実装ブランチに乗るため、そのブランチが main へマージされるまで他セッションからは欠落して見え、未分類 issue は GitHub 上で分類されるまで一時的に全セッションから未分類に見える。あるサイクルの差分が消せるのは自分が着手する issue の欠落だけで、他の issue の分は消せない。行動できるのがその1件だけなので、ここが唯一の検査点になる。どちらかが非空で返ってきたら、着手前に roadmap へ依存チェーンを1本足して `flow:managed` を付けるか、`flow:exempt` へ分類するかのどちらかを済ませる — どちらでもないまま進めた回は、その issue の登録または分類が誰の担当でもないまま残る

  - 明示した issue の対応 process を解決し、`graph neighbors --json` の primary successor から出力 artifact キーを引き、実行すべき `gate-check.mjs --artifact <key>` の完成形コマンド行を `gateCheckCommand` で出力する（転記ミス・フォールバック判定への意図しない低下を防ぐ。対応 process の識別は既存の location 解決を使い、出力は CLI の graph 結果を正とする）
- **終端ゲートの実行（pfd-ops 手順3）**: `workflow.md`「終端ゲートの根拠」に従う。対象 issue を含むコマンド構築規則も同節に置く。
- `cycle-status.mjs` と `gate-check.mjs` は `packages/cli/dist/cli.js` の存在を前提にする箇所がある（ビルドの前提は `workflow.md`「worktree でのサイクル実行」の「worktree 前提」）。`gate-check.mjs` はビルド未完了でも最後まで走り、項目名・SKIP 条件・正本への固定案内は印字される（CLI に依存する `pfdsl check` と gen-plugin identity の2項目だけが FAIL。実測 #560）

## Open PR（ワークサイクル選択前に確認）

`node scripts/cycle-status.mjs` の `openPRs` で PR の番号とタイトルを確認し、今回の作業に競合するかを判断する。

roadmap差分の有無によらず PR には `check-roadmap-registration.yml` が付く（#963）。
`node scripts/check-roadmap-registration.mjs --pr <n>` が PR の `closingIssuesReferences` から issue を導き、`audit-issues-flow.mjs --enforce-issue <n>` でその issue の分類・登録を FAIL 対象にし、対象外issueのfindingsはadvisoryにする。
対象集合を PR 自身から導くのは、実行主体が渡すフラグに依存させないため。
`edited` を trigger に含めるのは `check-closes-reference.yml` と同じ理由で、PR 本文の編集が対象集合を変えるからである。

**`gh` CLI が使えない環境（Claude Code Remote 等）での代替**: `cycle-status.mjs` / `gate-check.mjs`（内部の `audit-issues-flow.mjs`）は `gh` を呼ぶが、`github-ops.mjs` が `GH_TOKEN` / `GITHUB_TOKEN` のある環境では HTTP backend へ落ちる（#489・#1044）。token も無い場合は GitHub MCP server のツール（`list_pull_requests` / `issue_read` / `pull_request_read` 等）で個別に代替する: PR一覧は `list_pull_requests`、設計の確認は `issue_read` で本文とコメントを取得して読む、`audit-issues-flow` 相当は対象 issue の分類と `iN_` process・入出力依存を roadmap.pfdsl の記載と手動突合する。
`github-ops.mjs` の HTTP backend は上のリポ内スクリプトが必要とする operation の互換層であり、issue コメントや PR 本文の作成・編集を代行する汎用 GitHub write adapter ではない。
fallback の transport は REST だけではない — `closingIssuesReferences` は REST の pull request payload に存在せず、GraphQL へ直接問い合わせる（#1043）。
GitHub 側にしか無い読みを本文の正規表現で再構成すると、Development sidebar で手動リンクされた PR が「closing issue 0件」に見える。

`gate-check.mjs` の `issue read (#<n>)` 行が SKIP になるのは、operation API が利用不能を明示したときだけである（#1085）。
現行 API では、`gh` バイナリ不在かつ `GH_TOKEN` / `GITHUB_TOKEN` のどちらも無い場合に対応する。
`gh` 不在でも token があれば HTTP backend を試し、認証・ネットワーク・存在しない issue・不正応答・remote 解決失敗・HTTP 未実装 operation は実エラーとして FAIL する。
consumer は backend の ENOENT から利用不能を推測しない。
audit の引数エラーは exit 1 とし、exit 2 は operation API の利用不能だけに予約する。
issue/PR view の要求フィールド欠落、closing issue の識別情報不正、GraphQL のページ情報欠落は空結果にせず FAIL する。

## 終端ゲート追加項目（issue 固有）

**タイミング規約**: issue クローズと flow 確定（下記「マージ時のみ」の2項目）は **main への PR マージ時**に行う（生態系図 merge_pr: 進捗・issue 更新はマージで正本になる）。PR 作成時点では行わない — PR がレビューで変わる/却下される可能性があるため。サイクルが PR 作成で終わる場合、この2項目は「マージ時に実施」と記録して未了のまま閉じてよい。**feature branch への中間 PR では `closes #xxx` を使わない**（理由と規約は L3 reference「PR 本文規約」が一次情報）。**出力 artifact の status done 更新はこれに含まれない** — develop 完了時点（PR 作成前）で criteria 達成が言えるなら done にしてよい（pfd-ops の `references/work-cycle.md`「進捗と完了根拠」のデフォルト通り）。

**着手時**: develop ブランチを切った時点で、実装対象の出力 artifact を `todo → wip` に更新する（規則の一次情報は workflow.md「develop 着手時の artifact status 更新」）。

**着手前の選択記録**: 実装着手前に、選んだ方針を issue コメントとして残す。利用者が選び `--issue` で明示した各 issue が対象で、候補の列挙の有無は問わない。既存の採用済み記録があればそれを確認して使い、記録不足だけを理由に再承認を求めない。
判断・理由・候補の扱い・前提を外した案の検討・決定変更と承認の追跡は binding「GitHub Issues バックエンドの設計記録を確認する」に従う。固定の書式・項目順は要求しない。
投稿・編集直後の exact-write readback は L3 reference に従う。記録の存在・正本・承認根拠への参照と対応は人間が必ず確認し、終端ゲートの成功をその代わりにしない。
記録の欠落や正本の曖昧さは同じ記録の補修・確認で解消し、決定を変える場合は必要な承認と変更履歴を残す。既存実装との整合は通常の追加コミットで直し、日時の変更やコミットの再作成を回復手順にしない。

汎用ゲート（status 更新 / check 通過 / 論理単位コミット / PR 集約）に加え、**マージ時にのみ**:

- [ ] 完了した issue をクローズし、進捗・新発見を issue に反映した
- [ ] close 時の降格規則を適用した（定義は L3 reference。専属 process も含めて削除する）

**PR 本文と issue 連携**: 参照の使い分けと、PR 作成・本文編集・base 変更後の確認は、採用済み L3 reference「PR 本文規約」が正本である。
このリポの CI `check-closes-reference.yml` はデフォルトブランチ向け PR のリンクの有無を検査するが、対象 repository・issue 番号の集合が意図と一致するかは判定しない。
終端ゲートにはこの CI の項目を置かない — PR 作成前にはリンクも本文も存在しない。
トークンの有無でなくリンクの有無を見るため、コードフェンス内の `Closes #<n>` は通らない。

**hotfix PR の明示**: 緊急修正（バグ修正、誤り修正）を PR にのせる場合は description 冒頭に `hotfix:` を明記する。レビュー優先度・マージ判断の依拠になる。
`check-closes-reference.yml` は行頭の `hotfix:`、または理由付きの `no-issue: <理由>` を、デフォルトブランチ向けで閉じる issue が無い PR の明示宣言として認める。hotfix 宣言ではコロンまで含めて一致させる（L3 reference は「"hotfix" と明記」とだけ書くが、機械が読むのはこちらの厳しい形）。

- [ ] このサイクルで起票した issue を `flow:managed` / `flow:exempt` に分類した（判定は L3 reference の「ラベル判定基準」。保守・基盤・修正は exempt）
- [ ] `flow:managed` の issue がすべて roadmap.pfdsl の artifact として登録済みか確認した（exempt は登録しない）
- [ ] `node scripts/pfdsl/audit-issues-flow.mjs` の分類・登録検査が通過した（更新日時・priority完全一致は要求しない。`gate-check.mjs` 実行時はその一部として自動実行される）

**バージョン artifact を起こす契機と criteria の形**: 規定の一般形は `scripts/harness-template/skills/pfd-ops/references/work-cycle.md` の「成果物の門番」が一次情報（#729 で昇格）。
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
