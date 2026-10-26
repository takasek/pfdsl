# E0 限定試験 protocol v0

これはADR-0048契約3の試験用の運び手であり、PFDSL仕様や新しいCLI動詞ではない。
冒頭の対象指定と停止条件は保存済み初回試行の契約であり、変更しない。
成功したsafe-mode試行の対象・実行入口・具体的なデータ型は [個別protocol](safe-mode-20261026/protocol.md) に生成前に固定し、実行後照合には本書後半の追加契約を適用した。
モデルの選択は既存CLIの `status ready <roadmap> --json` に従い、入力statusを独自にdoneだけへ制限しない。
readyが返すのは `id`、`label`、`inputs`、`outputs`、`newlyReadyCount` であり、criteriaは返さない。

準備側がCLIの出力とモデル原文、成果物のダイジェストを `snapshot.json` に固定する。
driverはこれを変更せず、`i1525_revise_boundary_test` がreadyにある場合だけ準備側が別途承認した実行入口を呼べる。
この試験には未着手の入口をまだ渡していないので、readyであっても実行入口が無ければ停止する。
既に実行済みの作業を再実行したことにしたり、別processを選択したり、statusを戻したりしない。
対象がreadyに無ければ、空のchangedPathsとtransitions、execution-failure型の理由を記録して検査器へ渡す。
この停止記録のFAILは期待する結果であり、成功した実行の証拠ではない。

driverが書くJSONのv0形は次のとおり。

```json
{
  "schemaVersion": 0,
  "runId": "nonempty local identifier",
  "processId": "i1525_revise_boundary_test",
  "workItemIds": ["1525"],
  "versions": {"model": "snapshot.versions.model", "artifacts": "snapshot.versions.artifacts", "criteria": "snapshot.versions.criteria"},
  "changedPaths": [],
  "transitions": [],
  "deviations": [{"type": "execution-failure", "reason": "specific observed reason"}],
  "acceptanceEvidence": []
}
```

版はSHA-256で固定する。
このv0はGitHub Issuesを採用した本リポ限定で、workItemIdsに少なくとも1件を要求する。
processのlocationが本リポのissue URLなら、その番号が含まれることも照合する。
backend非採用や別backend向けの一般化は未実施である。
modelはモデル原文のJSON表現、artifactsはパスから内容ダイジェストへの対応表、criteriaはartifact IDからcriteriaまたはnullへの対応表のJSON表現をハッシュする。
キー順も含む同一バイト表現の照合であり、意味的同値を判定しない。
変更されたパスは準備側の成果物版に存在する必要がある。
今回の停止試験は変更しないため空である。
この節までの2引数の検査は過去の停止試行を再現する契約であり、実行後の版を検査しない。
成功試行には下の実行後照合を必須とする。

遷移の試験規則は出力artifactについて `todo/unspecified → wip`、`wip → done` だけである。
fromは固定モデルのstatusと一致させる。
doneにはacceptanceEvidenceの参照を要求するが、参照の実在や内容がcriteriaを満たすかは本検査器で検査しない。
readyに含まれないwip processの再開手順は定義していないため、再開を可能と主張しない。
これらは既存仕様にあった遷移規則と主張せず、実験前に定義した限定的な検査規則とする。

乖離の型は `additional-input`、`process-granularity`、`feedback`、`artifact-definition`、`criteria-observability`、`decision-boundary`、`execution-failure`、`unchanged` とし、全てに理由を要する。
最初の6型はモデル改訂候補に対応し、実行失敗と変更不要を区別する。
中身の妥当性、モデル外の権限、承認、隠れた変更、snapshot自体の改竄は検査器の保証外である。
保存先・run ID形式の標準化、claim/complete、強制的な実行管理は本試験に含めない。

検査器は `node check.mjs <evidence.json> <snapshot.json>` とし、PASS=0、FAIL=1、入力読取等のエラー=2を返す。
全体の成功とartifactの受入は別であり、この検査器のPASSだけでdoneへ更新してはならない。

## 実行後照合付きの再試行

2026-10-26に追加した実験契約であり、保存済みの停止試行へ遡及適用しない。
まだ実在processの成功往復では検証しておらず、回帰テストの合成fixtureは成功実績に数えない。

準備側は、作業を始める前に対象processとcapture planを固定する。
planは `processId`、検査scopeの `paths`、出力artifact IDからscope内path配列への `outputPaths` を持つ。
scopeには、実作業で作成・変更・削除する予定のファイルと、status変更も変更pathへ数えるならモデルpathを含める。
pathはcheckoutからの相対パスとし、準備側が参照先とscopeの妥当性を確認する。
新規ファイルの実行前版と削除ファイルの実行後版は `null` とする。
`outputPaths` は準備側が確認する対応であり、checkerが成果物の意味から推測した対応ではない。

```json
{
  "processId": "selected_ready_process",
  "paths": ["path/to/output.md", ".pfdsl/roadmap.pfdsl"],
  "outputPaths": {"selected_output_artifact": ["path/to/output.md"]}
}
```

```sh
node experiments/evidence-roundtrip/prepare.mjs <target-checkout> <new-record-directory> <capture-plan.json>
```

prepareは指定したcheckoutのCLIでreadyを取得し、対象が無ければ停止する。
既存ディレクトリへの保存を拒否し、過去のsnapshotとreadyを上書きしない。
新しいsnapshotには対象process、実行前の3版、commit、modelPath/blob、scopeの内容版、出力path対応を保存する。
`requiresResult: true` も固定し、新しい試行でresultVersionsと対象checkoutの両方を省略しても実行後照合を迂回できないようにする。
protocol、CLI、checkerと入力の対象版もdriver生成前に固定する。
準備だけでは着手せず、隔離条件と実行入口の確認を終えてからdriverを起動する。

driverの証拠には、従来の実行前 `versions` と別に、実行後の3版を `resultVersions: {model, artifacts, criteria}` として保存する。
版の計算法は実行前と同じである。
driverは固定済みscopeについて実行後の内容版を計算できるが、合否判定時はcheckerが対象checkoutを読み直す。
実行前snapshotを実行後の内容で置き換えてはならない。

```sh
node experiments/evidence-roundtrip/check.mjs <evidence.json> <snapshot.json> <result-checkout>
```

checkerはモデルとscope内ファイルを読取専用で取得し、`resultVersions` と照合する。
実行前に選んだprocessを変更した証拠、scopeの異なるmanifest、内容差分と集合一致しないchangedPaths（重複を含む）、最終statusと整合しないtransitionsをFAILにする。
遷移は申告順に `todo/unspecified → wip → done` を照合し、fromの連鎖と実行後の最終値を検査する。
中間のwipへ実際に一度到達したことや実行主体・因果関係は、前後のsnapshotだけでは証明できない。
モデルのstatus以外のmetadata・グラフ・criteria変更と、対象出力以外のstatus変更もFAILにする。
doneの受入参照には、その出力に対応付けられた実在する実行後pathを少なくとも1つ要求する。
参照内容の意味的妥当性とcriteriaの達成は別途受入する。

resultVersionsだけがあり対象checkoutが無い証拠、対象checkoutだけがありresultVersionsが無い証拠もFAILにする。
2引数の従来モードのPASSを、実行後照合の成功と扱わない。
scope外の変更、symlink等の参照先の妥当性、snapshotの改竄耐性、承認、隔離の達成は保証しない。
