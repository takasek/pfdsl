# E0 限定試験 protocol v0

これはADR-0048契約3の試験用の運び手であり、PFDSL仕様や新しいCLI動詞ではない。
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
modelはモデル原文のJSON表現、artifactsはパスから内容ダイジェストへの対応表、criteriaはartifact IDからcriteriaまたはnullへの対応表のJSON表現をハッシュする。
キー順も含む同一バイト表現の照合であり、意味的同値を判定しない。
変更されたパスは準備側の成果物版に存在する必要がある。
今回の停止試験は変更しないため空である。
成功した実行で出力版を固定する手順は未検証であり、実行後の版を検査する完全な契約と見なさない。

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
