# GitHub Issues バックエンド（pfd-ops プリセット）

PFD の作業項目を GitHub Issues で管理する流儀。pfdsl 固有ではなく、採用したいリポが選べる再利用可能パターン。採用リポは `roadmap.md` でこのプリセットを指す。

## 規約

- **一次情報**: GitHub Issue 本体。着手時は本文とコメントを両方取得する。`gh` があれば `gh issue view <number> --json body,comments`、`gh` の無い環境（Claude Code Remote 等）では GitHub MCP server の issue 読取ツールや REST API など、同じ本文とコメントを返す手段を使う。ページ分割される手段ではコメントを全ページ取得する。`roadmap.pfdsl` は依存構造のみ管理する
- **アダプタ自身の書込み**: アダプタが外部へ書く場合は、自ら書いた内容を読み戻して照合する。
- **作業項目の参照**: 対応は [`work-cycle.md`「作業項目と process の対応」](work-cycle.md#作業項目と-process-の対応) に従う。process の `location:` には issue の URL（`https://<host>/<owner>/<repo>/issues/<number>`）を置く。host・repository・issue 番号を合わせて項目を識別し、別 repository の同番号や pull request の URL を同じ issue とみなさない。監査・GitHub 取得・着手時の照合は、`GH_REPO=[HOST/]OWNER/REPO`、`gh repo set-default` の保存設定、`origin` の順で同じ対象を選ぶ。fork の親 repository は自動推測しない。`GH_REPO` の host 省略時は `GH_HOST`、未設定なら `github.com` を使う。SSH remote は `ssh -G` の hostname を Web host とし、`ssh.github.com` は `github.com` に変換し、SSH 接続 port は引き継がない。SSH を解決できない場合は `GH_REPO` で明示する。別 repository の issue URL は照合から除外して advisory を表示し、その参照先の存在や分類は検査しない。HTTP fallback は引き続き public GitHub のみを対象とする。
- **ラベル**: roadmap 登録 issue は `flow:managed`、対象外は `flow:exempt`（判定は「ラベル判定基準」節）
- **登録 metadata**: issue 対応と依存構造を検査する。GitHub の可変 `updatedAt` は保存・同期しない。`priority:` tags は任意の表示値であり、issue labels との完全一致を登録条件にしない。旧 `updated_at` が残る図でも監査はその値を読まない
- **issue close と進捗**: close は status を動かす契機にしない。成果物の完了判断と status 更新は `work-cycle.md` の完了根拠に従う。未実装のまま廃止する場合も、未完了作業が必要とする入力を保存し、代替や廃止の判断を依存構造へ反映する。デフォルトブランチへの push が起動するのは下の完了チェーン回収（`.pfdsl/config.json` で有効にした場合）だけで、それも PR を提案するところまでであり、マージは人が行う
- **完了チェーン回収**: 保持規則と検証は [`work-cycle.md`「完了チェーンの回収」](work-cycle.md#完了チェーンの回収) の `pfdsl prune` を使う。完了履歴は closed issue・git 履歴・決定記録・公開レジストリが持つ。
  `scripts/pfdsl/sweep-completed-chains.mjs <file>` は CLI を解決して `prune --json` を呼ぶアダプタで、保持判定や検証を再実装しない。`--write` を付けた場合は CLI に適用も要求する。`.pfdsl/config.json` で有効にした採用リポでは、デフォルトブランチへ push があると `.github/workflows/pfdsl-sweep-completed-chains.yml` がこれを実行し、差分があれば PR を起票する。マージは人が行うので、グラフはレビューを経ない書換えを受けない。
  回収可否の判定はデフォルトブランチだけを読む。まだマージされていないブランチが done artifact を入力に取る process を足していた場合、その組合せはどちらの側からも見えない。統合の時点で「宣言のない id を edge が指す」形になり、roadmap の不変条件がそこで弾く

## ラベル判定基準

roadmap の PFD は、未解決の依存がある（前提が未完了、または他の作業が待っている）作業を管理する。判定テスト: 「この issue は前提が未完了か、または他の作業が待っているか」。どちらかに当たれば `flow:managed` とし、入力 artifact・process・出力 artifact とその依存関係を roadmap の PFD に追加する。どちらにも当たらなければ `flow:exempt` とし、roadmap に載せない。作業の種別名だけでは分類しない。

**判定タイミング**: 起票時に `flow:managed` / `flow:exempt` を判定してから roadmap 追加要否を決める。`flow:managed` の起票と roadmap 追加は同時に行う（後回しにすると依存グラフが stale になり気付き依存に戻る）。


## push 駆動の回収（pfdsl-sweep-completed-chains）

有効にした採用リポでは、デフォルトブランチへ push されると `.github/workflows/pfdsl-sweep-completed-chains.yml` が `scripts/pfdsl/sweep-completed-chains.mjs .pfdsl/roadmap.pfdsl --write` を実行し、差分があれば `flow-sync/pending` ブランチへ PR を起票する。回収が読むのはデフォルトブランチの roadmap だけで、それが変わるのは push のときだからである。issue close は status を動かさないので、close 契機は push 契機に包含される。bot はデフォルトブランチへ直接書かず、マージは人が行う。
回収は採用リポの `.pfdsl/config.json` が `{"sweepCompletedChains": {"enabled": true}}` を宣言したときだけ行う。
宣言が無い、または `enabled` が真偽値の `true` でなければ、workflow は checkout の直後に無効である旨を通知して何もせず成功で終わる。`.pfdsl/config.json` が JSON として読めない、または値の形が違う場合は失敗する。
workflow ファイル自体は他の配置ファイルとともに commit してよい。有効にするかどうかは所有者が判断し、その判断をこのキーに残す。

`GITHUB_TOKEN` で PR を作る経路には、リポジトリ設定の前提がある。
リポジトリが GitHub Actions による PR の作成を許可していること（組織が制限している場合は組織も許可していること）である。
有効にする場所は、リポジトリの Settings → Actions → General → Workflow permissions の「Allow GitHub Actions to create and approve pull requests」で、組織側は組織の Settings → Actions → General にある同名の設定である。
workflow の `permissions: pull-requests: write` だけでは足りない。
回収を有効にする前に、リポジトリの管理者権限を持つ人が次のコマンドで現在の値を確認できる（`true` なら許可されている）。

```bash
gh api repos/<owner>/<repo>/actions/permissions/workflow --jq .can_approve_pull_request_reviews
```

下の GitHub App の installation token で PR を作る経路は、この設定を必要としない。
設定を有効にできない場合（組織ポリシー等）、回収と `flow-sync/pending` への push は成功するが PR は作られず、run は失敗で終わる。
この場合は下の GitHub App の installation token で PR を作る経路へ切り替える。
失敗した run には、多くの場合 PR だけが作られていないこと・確認する設定・手で PR を開く compare URL を示す `::error::` annotation が付く（`Explain a failed pull request step` step）。
この annotation は、PR 作成の拒否と push の失敗を判別しない（原因は PR 作成 step 自身のエラーに出る）。`flow-sync/pending` の作成を禁じるルール等で push 自体が失敗した場合は、PR 作成 step のログに push のエラーが出ており、ブランチは作られていない。
この結果は全面成功ではない。差分は `flow-sync/pending` に置かれたままなので、compare URL から手で PR を開くか、設定を有効にして run を再実行する。
workflow は設定値を事前に読まない。取得する REST endpoint が Administration の読取権限を要し、`GITHUB_TOKEN` に付与できないため、案内は失敗した後に出る。
同一ブランチへ起票するため、連続する push は既存 PR を更新する。`concurrency` グループで直列化してあり、再計算は冪等である。
trigger は `flow-sync/pending` への push を除外する。App token で作成した PR ブランチへの push が workflow を起動すると、`concurrency` グループで保留中の run を押し出して回収を取りこぼすためである。
同梱 workflow が生成する本文は、閉じる issue を持たない回収提案として `no-issue:` と理由を含む固定説明と実行条件である。
正しさの根拠は diff にあり人が審査するため、この既存経路は本文の読み戻しを追加していない。
削除対象の ID や証拠データを本文へ載せ始める場合は、そのデータの読み戻しを加える。
この bot PR は既定では `GITHUB_TOKEN` で作成される。
GitHub は `GITHUB_TOKEN` で作成された PR の `pull_request` トリガーの workflow を、書き込み権限を持つ人が承認するまで承認待ち（`action_required`）で保留する（[Triggering a workflow](https://docs.github.com/en/actions/using-workflows/triggering-a-workflow)）。
保留中は採用リポ自身の CI ゲート（ビルド・テスト・`fmt` 検査等）がこの PR に対して実行されておらず、回収時の検証を担うのはアダプタが呼ぶ `pfdsl prune` である。
その検証は `pfdsl prune` 内で行い、入力・出力の検証、入力の正準書式、変換後の孤立ノード不在、出力の整形、ready・blocked の比較を含む。
レビュアーは、CI チェックが付いていない PR や承認待ちのままの PR を「チェックが通った」ではなく「チェックがまだ動いていない」と読むこと。

承認なしで CI を走らせるには、GitHub App の installation token で PR を作成する。
リポジトリ変数 `REPO_AUTOMATION_APP_CLIENT_ID` と secret `REPO_AUTOMATION_APP_PRIVATE_KEY` を設定すると、workflow が `actions/create-github-app-token` で短命 token を発行し、その token で PR を作成する。
この workflow が token に要求する権限は contents と pull-requests の write だけである。
同じ App を他のリポジトリ自動化にも利用できる。
旧設定 `PFDSL_SWEEP_APP_CLIENT_ID` と `PFDSL_SWEEP_APP_PRIVATE_KEY` も共通 Client ID が空の場合に限り利用できる。
共通 Client ID が設定されている場合は共通秘密鍵だけを使い、旧秘密鍵に戻らない。
切り替えのスイッチは変数である。
変数が空なら secret の有無によらず `GITHUB_TOKEN` に戻り、変数があって secret が使えなければ step が失敗する（黙って戻らない）。
PR 本文は、どちらの token で作成されたかに応じて CI の扱いを書き分ける。

## 同期監査

`scripts/pfdsl/audit-issues-flow.mjs` は GitHub issues と `roadmap.pfdsl` の分類・登録を読取専用で監査する。更新日時とpriorityの完全一致は検査しない。閉じた issue がグラフに残ること自体は finding にしない。実体スクリプトは `scripts/pfdsl/` 配下に集約する（配布物の境界設計は ADR-0032 参照）。

issue findings の `blocking:` は監査を失敗させ、`advisory:` だけなら失敗させない。
`flow:managed` なのに process を持たない issue（`missing_process`）が advisory なのは、その登録が実装ブランチに乗るためである — そのブランチが統合されるまで他の作業ツリーからは常に欠落して見える。
あるサイクルの差分が消せるのは自分が着手する issue の欠落だけで、他の issue の分は消せない。
落とす設計にすると、原因を作っていないサイクルが毎回赤くなり、赤い行そのものが読まれなくなる。
この欠落に行動できるのは、その issue を自分のものとして扱っている側だけなので、検査点はそこへ寄せる。
着手時点では、プリフライト集約スクリプトを持つリポがそのサイクルの issue について報告する（登録漏れは依存関係を変えうるので、roadmap に着手する前に知りたい）。
マージ前の時点では、roadmap差分の有無によらず、その PR が閉じる issue の分だけを FAIL にする — 対象集合を PR 自身から導けるため、実行主体が渡すフラグに依存しない。対象外issueのfindingsはadvisoryにする。全体で必要なflowラベルの欠落は引き続きFAILにする。
後者の時点は PR の close 契機に置かない。close 後に気付いても、その PR はもう変えられない。

ラベルの所見は issue ごとの照合を止めない。
監査はラベルの所見を出力したうえで issue ごとの照合へ進み、終了コードは最後に決める。
`label_missing`（`flow:managed` / `flow:exempt` のどちらかが存在しない）は blocking で、監査を失敗させる。ラベルが無いと issue に付けられず、`flow:managed` の判定自体が成り立たないためである。
`label_description_mismatch`（ラベルはあるが説明文が期待値と違う）は advisory で、それだけでは監査を失敗させない。説明文を読んで動く判定は無く、人がラベル一覧で用途を判別する表示だからである。
ずれは `label advisory (does not fail this audit):` の見出しで報せ、照合で見つかるはずの所見を説明文の修正まで隠さない。

## 採用手順

1. pfdsl plugin を導入する（`/plugin marketplace add takasek/pfdsl` + `/plugin install pfdsl@pfdsl`）— pfd-ops スキル本体はリポでなく plugin から供給される
2. `install/` 以下のファイルをリポルートに実配置する（`/pfd-init` ステップ3.5、または直接 `node <pfd-ops skill root>/scripts/check-install-sync.mjs --deploy`）。
   配置ファイルと plugin 同梱 canonical の drift は pfd-ops 発火時のランタイム hash 照合が警告する（設計根拠: ADR-0028）
3. GitHub の `flow:managed` / `flow:exempt` ラベルを、監査が要求する説明文つきで作成または更新する。
   説明文は監査が照合する値で、異なると advisory の所見になる（それだけでは監査は失敗しない。下の「同期監査」）。
   ラベルが無ければ作成する。

   ```bash
   gh label create flow:managed --description "tracked in .pfdsl/roadmap.pfdsl"
   gh label create flow:exempt --description "intentionally out of .pfdsl/roadmap.pfdsl scope"
   ```

   既にあれば、色を保ったまま説明文だけを更新する。
   `gh label create --force` は使わない。`--color` を省くと既存ラベルの色まで無作為な色で上書きする。

   ```bash
   gh label edit flow:managed --description "tracked in .pfdsl/roadmap.pfdsl"
   gh label edit flow:exempt --description "intentionally out of .pfdsl/roadmap.pfdsl scope"
   ```

   `gh` が無い環境では、リポジトリの Labels 画面（Issues → Labels）で同じ名前と説明文を入力する。
4. `roadmap.pfdsl` を依存構造のみのグラフとして用意し、上の「作業項目の参照」に従って issue を対応付ける
5. リポの `roadmap.md` で本プリセットを指し、リポ URL を記載する
6. 下の「依存の準備と初回監査」を実行する。配置だけで終了しない

## 依存の準備と初回監査

採用リポのルートを作業ディレクトリにして、配置した監査モジュールから依存を読めるか確認する。

```bash
node --input-type=module -e "await import('./scripts/pfdsl/lib/yaml-require.mjs')"
```

成功すれば yaml の追加インストールは不要。
`yaml` が見つからない場合は、依存準備までを導入作業として続ける。

インストールする前に `git check-ignore -q -- node_modules/x` を実行し、Git が依存ディレクトリを除外するか確認する。
終了コード 0 なら既存の有効な規則を利用し、同じ意味の行を追加しない。
終了コード 1 ならリポ直下の `.gitignore` に次の規則を追加する（ファイルがなければ作成し、既存の規則は残す）。
それ以外の終了コードでは確認の失敗理由を解消してから続ける。

```gitignore
/node_modules/
```

新規作成・変更した `.gitignore` は導入変更と一緒にコミットし、ほかの checkout にも除外規則を共有する。

`package.json` のないリポでは次を実行する。
package.json や lockfile は作らず、リポ直下の `node_modules` に配置する。

```bash
npm install --prefix . --no-save --package-lock=false --ignore-scripts yaml@2.8.3
```

`--prefix .` で採用リポへ配置先を固定する（親フォルダの package.json に依存の配置先を引き寄せられないようにする）。
同じリポで CLI も未保存依存として用意する場合は、上のコマンドの代わりに `npm install --prefix . --no-save --package-lock=false --ignore-scripts yaml@2.8.3 @pfdsl/cli` を使う。
別々の `npm install --no-save` は先に置いた未保存依存を除去しうるため、保持する未保存依存を同じ install に列挙する。
採用先は `prune` 対応 CLI・plugin・配置アダプタを即座に一括更新する。
旧版との混在や旧アダプタの維持はサポートせず、アダプタは `prune` を直接実行して出力と終了コードを転送する。
`package.json` があるリポでは、そのリポの package manager で yaml を開発依存へ追加する（npm なら `npm install --save-dev yaml@2.8.3`）。
既存の依存宣言・lockfile を尊重し、別の package manager へ切り替えない。
未保存依存は clean checkout や依存の掃除後には再準備が必要で、CI でも監査の前に用意する。
`node_modules` はコミットしない。
インストール後に `git check-ignore -v -- node_modules/yaml/package.json` で除外されることを確認し、`git status --short` で依存ファイルが追加対象になっていないことを確認する。
既に追跡されている依存ファイルは `.gitignore` だけでは除外できないため、その場合はリポの方針に従って追跡状態を整理してから先へ進む。

準備後は上の import 確認を再実行し、roadmap と認証の準備ができたら初回監査を実行する。
ラベルは監査の前に、上の「採用手順」の手順3のコマンドで作成または更新しておく。
ラベルが無いと監査は `label_missing` で失敗する。

```bash
node scripts/pfdsl/audit-issues-flow.mjs
```

import 成功だけを監査成功としない。
監査の終了コードと findings を確認し、認証・通信・依存取得の失敗はその理由を報告する。
既に認証された gh または token を使用し、権限の追加が必要なら利用中の環境の承認境界に従う。

## 監査スクリプトの実行環境

- Node.js 24 以上
- `gh` CLI、または `GH_TOKEN` / `GITHUB_TOKEN`
- npm パッケージ `yaml`（上の「依存の準備と初回監査」で採用リポへ用意する）
- `prune` サブコマンドを持つ版の `@pfdsl/cli`（回収の判定・削除・検証をこの CLI が担う）。CLI と配布アダプタを一括更新し、旧版のための能力確認や代替実装は持たない
  - pfdsl リポ自身の workflow は、checkout したツリーが pfdsl workspace（`pnpm-workspace.yaml` と `packages/cli/package.json` を持つ）なら `pnpm -r build` してそのビルドを使う。採用リポのように workspace でなければ `npm install --no-save @pfdsl/cli` で `prune` を含む公開版を導入する。運用プロトコルの着手判断が既に `status ready` を要求しているので、`@pfdsl/cli` の導入自体は採用リポにとって新しい前提ではない
  - 回収スクリプトは `PFDSL_CLI`、リポの `packages/cli/dist/cli.js`、`node_modules/@pfdsl/cli/dist/cli.js` の順に CLI を探す

`audit-issues-flow.mjs` が使う named operation はすべて HTTP backend を持つ。`gh` が存在しない（ENOENT）場合も、`GH_TOKEN` または `GITHUB_TOKEN` があれば HTTP backend へ切り替わるため、token のみの環境で監査を実行できる。`gh` が実行されて認証・通信・引数エラーになった場合は HTTP へ切り替えず、そのエラーを報告する。
