# GitHub Issues バックエンド（pfd-ops プリセット）

PFD の作業項目を GitHub Issues で管理する流儀。pfdsl 固有ではなく、採用したいリポが選べる再利用可能パターン。採用リポは `roadmap.md` でこのプリセットを指す。

## 規約

- **一次情報**: GitHub Issue 本体。着手時は `gh issue view <number> --json body,comments` で本文とコメントを両方取得する。`roadmap.pfdsl` は依存構造のみ管理する
- **複数行本文の外部書込み**: issue 本文の作成・編集、issue コメント、PR 本文の作成・編集のように複数行本文を GitHub へ送るたび、セッション固有名を持つ body file にその時点の正本を書く。transport が file 入力を持つときは `--body-file` 等で正本を直接渡し、MCP 等の body 入力しか持たない transport では正本ファイルを読んだ値を手で再構成せずに渡す。実行直後に、**既存 issue / PR の編集では write request の対象番号、新規 issue / PR / comment では write response の stable identifier や URL が指す対象そのもの**を同じ transport またはその backend の参照手段で取り直し、GitHub 側の persisted `body` が改行を含めてその正本と完全一致することを確認する。新規作成に使う操作が対象の identifier を応答として返す契約を持たない場合は、一覧から推測せず、identifier を返す backend API や transport を write 前に選ぶ。本文に `Closes #...` のような必須行や参照がある場合は、その構造も同じ readback 結果で確認し、後続の本文編集でも毎回保たれていることを確認する。issue の `body,comments` 一覧を広く読み、似た本文を見つけて代用しない。write と exact readback の両方を提供する transport が無い場合は他の手段へ勝手に切り替えず、不足している前提条件を報告して停止する。コマンドの成功表示や返された URL は persisted body の証拠にならない
- **id 規約**: issue に対応する作業の process id は `iN_` prefix（N = issue 番号）。**恒久** — issue close 後も剥がさない。同一 process が複数 issue に対応する場合は `i40_i41_do_work` のように連結する。対応する出力 artifact の id は最初から plain（prefix なし）。**まだ issue が無いプロセスは plain の id で置く** — `work-cycle.md` の成果物の門番が要求するプレースホルダ後続プロセスは、起票より先にグラフへ入る。採番できない番号を捏造せず、起票時に `iN_` を付けてリネームする。この状態は `check` を通ってしまい機械検出されないので、逸脱として `roadmap.md` に書き残す
- **ラベル**: roadmap 登録 issue は `flow:managed`、対象外は `flow:exempt`（判定は「ラベル判定基準」節）
- **updated_at**: 同期時点の GitHub `updatedAt` スナップショット
- **issue close と進捗**: close は status を動かす契機にしない。成果物の完了判断と status 更新は `work-cycle.md` の完了根拠に従う。未実装のまま廃止する場合も、未完了作業が必要とする入力を保存し、代替や廃止の判断を依存構造へ反映する。デフォルトブランチへの push が起動するのは下の完了チェーン回収だけで、それも PR を提案するところまでであり、マージは人が行う
- **完了チェーン回収**: roadmap に残すのは、(a) done でない artifact を出力する process と、(b) その入出力として edge に現れる artifact である。(b) に入る done artifact は ready/blocked 判定の入力として残す。完了履歴は closed issue・git 履歴・決定記録・公開レジストリが持つ。`status list <file> --status todo,wip,waiting,suspended` で done でない artifact を列挙し、各 artifact の `graph neighbors <file> <artifact-id>` の `predecessors` から (a) を求める。続けて各 process の `graph neighbors` の `predecessors` と `successors` から (b) を求め、その外側のノード・edge と残存 `revises:` 参照を整理する。削除前後で `status ready <file> --json` と `status blocked <file> --json` の**出力全体**を比較し、`check` と `graph orphans` を確認する。id 集合だけの比較では、ready のまま入力が減る破損を検出できない。
  この導出・削除・検証の全体を `scripts/pfdsl/sweep-completed-chains.mjs <file>` が行う。`--write` なしでは削除対象を列挙するだけで、`--write` を付けても上の検証が全て通るまでファイルを書き換えない。デフォルトブランチへ push があると `.github/workflows/pfdsl-sweep-completed-chains.yml` がこれを実行し、差分があれば PR を起票する。マージは人が行うので、グラフはレビューを経ない書換えを受けない。
  回収可否の判定はデフォルトブランチだけを読む。まだマージされていないブランチが done artifact を入力に取る process を足していた場合、その組合せはどちらの側からも見えない。統合の時点で「宣言のない id を edge が指す」形になり、roadmap の不変条件がそこで弾く

## ラベル判定基準

roadmap は「製品の成果物を生み、他作業の着手をゲートする作業」を管理する。**新機能・spec 追加・リリース・他 issue の前提になる作業**は `flow:managed`。**他作業をゲートしない保守作業** — バグ修正/hotfix・CI/ビルド/git hook/ツーリング・PFD や doc の bookkeeping（図への登録漏れ補完等）— は `flow:exempt` とし roadmap に載せない。判定テスト: 「この issue の完了が別の roadmap 作業の前提になるか、新しい製品能力を生むか」。No（保守・基盤・修正のみ）なら exempt。

**判定タイミング**: 起票時に `flow:managed` / `flow:exempt` を判定してから roadmap 追加要否を決める。`flow:managed` の起票と roadmap 追加は同時に行う（後回しにすると依存グラフが stale になり気付き依存に戻る）。

**ラベル付与の許可要否**: `flow:managed`/`flow:exempt` の付与・変更は分類作業であり、issue の close・PR の merge・公開物の publish 等の確定操作ではない。ユーザーへの明示確認なしに実行してよい。

## 設計確定の証拠

issue 本文は依頼内容、コメントは設計選択記録の置き場として分ける。起票時刻を設計決定の時刻とみなさず、終端ゲートはコメントから正本を同定する。設計選択記録を要求するかどうかと、その書式と再承認参照の検査は採用リポの binding が定める。**binding がそれを定めていなければ、このプリセットは記録を要求せず、正本の同定も求めない** — 書式を持たないリポに記録の作成を命じると、行き止まりになるか、実行主体が書式を発明することになる。投稿・編集直後の exact-write readback は本 reference「規約」節の「複数行本文の外部書込み」が引き続き定め、設計選択記録の投稿・編集にも適用する。`cycle-status` / `gate-check` の PASS はその代わりにならない。

## PR 本文規約

issue に対応する PR を作る際、本文に必ず閉じるキーワードを含める:

```
Closes #<issue番号>
```

複数 issue の場合は1行ずつ列挙する。これによりデフォルトブランチへの PR マージ時に GitHub が issue を自動 close する。

**中間 PR では使わない**: `Closes` を使うのはデフォルトブランチ（main 等）へ直接マージする PR のみ。feature branch への中間 PR に書くと、feature branch マージ時点で issue が閉じられ、デフォルトブランチ未到達のまま誤 close になる。issue close と flow 確定はデフォルトブランチへのマージ時に行う。

**閉じる issue が無い PR**: hotfix（次節）に該当しない、bookkeeping やドキュメントの spin-off 等では、行頭に `no-issue: <理由>` と明示する。理由は必須（コロンの後に空でない理由テキストを書く）。これは「issue なし develop は hotfix のみに限る」の例外であり、理由必須の明示宣言に限って緩めたもの — 宣言なしに閉じる issue が無いまま PR を出すことは変わらず認めない。

## hotfix 運用（issue 省略）

バグ修正で以下をすべて満たす場合、issue 起票・roadmap 更新を省略してよい:

- spec・仕様変更を伴わない（既存動作の回復のみ）
- PR 単体で完結し、依存解放を要しない
- PR description に "hotfix" と明記する

**develop 開始前に hotfix 判定を行う** — 3条件の確認前に issue 起票・roadmap 追加を開始しない。issue なし develop は hotfix、または「PR 本文規約」の `no-issue: <理由>` 宣言を伴う場合のみに限る。

## flow:exempt のバッチ管理（親トラッカー issue）

複数の `flow:exempt` issue をまとめて記録・順序管理したい場合、GitHub issue 本文にタスクリスト形式で列挙した親トラッカー issue を1つ立ててよい（roadmap.pfdsl には載せず、親issue自体も exempt）。子issueを close した際は、親issueのタスクリスト該当行を手動で `[x]` に更新する — 本文中の手書き `- [ ] #123` 形式は GitHub のネイティブ task-list 連動（相手issueを convert-to-issue した場合のみ働く自動チェック機能）の対象にならず、close しても自動チェックされない。全件完了で親issue自体を close する。

## push 駆動の回収（pfdsl-sweep-completed-chains）

デフォルトブランチへ push されると `.github/workflows/pfdsl-sweep-completed-chains.yml` が `scripts/pfdsl/sweep-completed-chains.mjs .pfdsl/roadmap.pfdsl --write` を実行し、差分があれば `flow-sync/pending` ブランチへ PR を起票する。回収が読むのはデフォルトブランチの roadmap だけで、それが変わるのは push のときだからである。issue close は status を動かさないので、close 契機は push 契機に包含される。bot はデフォルトブランチへ直接書かず、マージは人が行う。
同一ブランチへ起票するため、連続する push は既存 PR を更新する。`concurrency` グループで直列化してあり、再計算は冪等である。
PR 本文には閉じる issue が無いので `no-issue:` を理由つきで宣言する（「PR 本文規約」参照）。
この bot PR は `GITHUB_TOKEN` で作成されるため、GitHub の既定動作により `pull_request` トリガーの workflow を起動しない。そのため採用リポ自身の CI ゲート（ビルド・テスト・`fmt` 検査等）はこの PR に対して一切実行されない。回収の正しさを担保するのは `sweep-completed-chains.mjs` 自身の検証だけであり、その内訳は `check`・`graph orphans`・`fmt --check`・readiness 比較（`status ready`/`status blocked`）である。レビュアーは、この PR に CI チェックが一つも付かないことを「チェックが通った」ではなく「チェックがそもそも動いていない」と読むこと。

## 同期監査

`scripts/pfdsl/audit-issues-flow.mjs` は GitHub issues と `roadmap.pfdsl` を読取専用で監査する（ラベル・OPEN issue の updatedAt・priority 突合）。閉じた issue がグラフに残ること自体は finding にしない。実体スクリプトは `scripts/pfdsl/` 配下に集約する（配布物の境界設計は ADR-0032 参照）。

issue findings の `blocking:` は監査を失敗させ、`advisory:` だけなら失敗させない。
`flow:managed` なのに process を持たない issue（`missing_process`）が advisory なのは、その登録が実装ブランチに乗るためである — そのブランチが統合されるまで他の作業ツリーからは常に欠落して見える。
あるサイクルの差分が消せるのは自分が着手する issue の欠落だけで、他の issue の分は消せない。
落とす設計にすると、原因を作っていないサイクルが毎回赤くなり、赤い行そのものが読まれなくなる。
この欠落に行動できるのは、その issue を自分のものとして扱っている側だけなので、検査点はそこへ寄せる。
着手時点では、プリフライト集約スクリプトを持つリポがそのサイクルの issue について報告する（登録漏れは依存関係を変えうるので、roadmap に着手する前に知りたい）。
マージ前の時点では、roadmap を編集する PR について、その PR が閉じる issue の分だけを FAIL にする — 対象集合を PR 自身から導けるため、実行主体が渡すフラグに依存しない。
後者の時点は PR の close 契機に置かない。close 後に気付いても、その PR はもう変えられない。

## 採用手順

1. pfdsl plugin を導入する（`/plugin marketplace add takasek/pfdsl` + `/plugin install pfdsl@pfdsl`）— pfd-ops スキル本体はリポでなく plugin から供給される
2. `install/` 以下のファイルをリポルートに実配置する（`/pfd-init` ステップ3.5、または直接 `node <pfd-ops skill root>/scripts/check-install-sync.mjs --deploy`）。
   配置ファイルと plugin 同梱 canonical の drift は pfd-ops 発火時のランタイム hash 照合が警告する（設計根拠: ADR-0028）
3. GitHub の `flow:managed` / `flow:exempt` ラベルを確認し、不足分は導入時に明示的に作成する
4. `roadmap.pfdsl` を依存構造のみのグラフとして用意し、issue に対応する process に `iN_` prefix を付ける
5. リポの `roadmap.md` で本プリセットを指し、リポ URL を記載する

## 監査スクリプトの実行環境

- Node.js 24 以上
- `gh` CLI、または `GH_TOKEN` / `GITHUB_TOKEN`
- npm パッケージ `yaml`（採用リポの実行環境に用意する）
- `delete` サブコマンドを持つ版の `@pfdsl/cli`（回収スクリプトが判定・削除・検証のすべてをこの CLI 経由で行う）。最低版を数字では断定しない: pfdsl リポ自身の `packages/cli/package.json` は `delete` 追加後もまだ version を上げていないため、その値をそのまま「次の公開版」として読むと誤った版数を書くことになる。回収スクリプトは起動時に解決した CLI が `delete` を持つか確かめ、持たなければ対象の有無にかかわらずその場で停止し、直し方を示す
  - pfdsl リポ自身の workflow は、checkout したツリーが pfdsl workspace（`pnpm-workspace.yaml` と `packages/cli/package.json` を持つ）なら `pnpm -r build` してそのビルドを使う。採用リポのように workspace でなければ `npm install --no-save @pfdsl/cli` で公開版を導入する（フォールバック時は `delete` を含む公開版以降でないと上の起動時チェックで止まる）。運用プロトコルの着手判断が既に `status ready` を要求しているので、`@pfdsl/cli` の導入自体は採用リポにとって新しい前提ではない
  - 回収スクリプトは `PFDSL_CLI`、リポの `packages/cli/dist/cli.js`、`node_modules/@pfdsl/cli/dist/cli.js` の順に CLI を探す

`audit-issues-flow.mjs` が使う named operation はすべて HTTP backend を持つ。`gh` が存在しない（ENOENT）場合も、`GH_TOKEN` または `GITHUB_TOKEN` があれば HTTP backend へ切り替わるため、token のみの環境で監査を実行できる。`gh` が実行されて認証・通信・引数エラーになった場合は HTTP へ切り替えず、そのエラーを報告する。

`designRecordEditInfo` も HTTP backend を持つ。選択済みコメントの GraphQL node ID を指定して対象コメントだけを取得し、`gh` が無い環境では token を使った GraphQL POST へ fallback する。HTTP または GraphQL で取得不能な場合は取得不能として扱い、改訂行のある記録を不受理にする一方、改訂行のない記録を編集時刻だけを理由に不受理にはしない。
