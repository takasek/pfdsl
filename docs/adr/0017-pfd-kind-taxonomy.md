# ADR-0017: PFDファイル種別を3種別に定義する

- Status: Accepted
- Date: 2026-06-17

## Context

PFDを書く実践が進むにつれ「これは1ファイルに収まるか、別ファイルにすべきか」という判断が繰り返し生じた。
pfd-opsスキルは `ecosystem.pfdsl` と `roadmap.pfdsl` の2類型を前提にしていたが（このリポジトリでは後に `ecosystem.pfdsl` を `workflow.pfdsl` にリネームした — プロジェクトの性質上 workflow 種別が適切と判断）、
開発サイクルや実行時データフローを記述したいケースでその2類型に収まらない例が出てきた。

4つの仮想プロジェクト（レシピ共有アプリ・AIスキル開発・車両管理システム・カンファレンス）を
独立エージェントが自由設計し、横断審査した結果、種別を判断するための3軸（時間的構造・主語・寿命）が帰納された。
さらに「組織境界の引き継ぎ」を独立種別（stakeholder-handoff）とする案を検討したが、
フルーツスケールの3ケース（FleetOpsコンプライアンス提出・Noodle API合意・PMDA薬事申請）で
subagentが4種別への再設計を試みた結果、表現しきれなかった問いがゼロだったため廃止した。

## Decision

PFDファイルの種別を以下の3種別に定義する。種別は「このPFDが答える問い」で区別する。

| 種別 | 答える問い |
|---|---|
| **roadmap** | 何を何の前に作る必要があるか。今着手できる作業はどれか |
| **workflow** | この作業はどう繰り返されるか。誰が何をトリガーに何を行うか |
| **runtime-pipeline** | システムが動くとき、データは何に変換されるか。変換の境界はどこか |

### 種別の選び方（問診リスト）

プロジェクト開始時に以下を確認する。Yesなら対応する種別のファイルを作る。

| 問い | 種別 |
|---|---|
| 実装すべき作業に依存関係があり、着手順を管理したいか？ | roadmap |
| 定常的に繰り返す作業サイクルがあるか？ | workflow |
| システムがデータを受け取り変換して出力するパイプラインがあるか？ | runtime-pipeline |

複数YesならそのぶんファイルがあるのがYes。全部Noなら1ファイルで足りる。

**workflow か runtime-pipeline か迷ったら:**
人・チームの判断やトリガーが主役 → workflow / データの変換経路が主役 → runtime-pipeline。
同一ドメインに両方存在してよい（例: 週次再学習サイクル=workflow、ログ→モデル変換=runtime-pipeline）。

### ファイル vs group の使い分け

1種別1ファイルを原則とする。同一種別内の細分はgroupで行う。複数ファイルへの分割は「読み手が完全に別」「ファイルが実用上の限界を超える」などの明確な動機がある場合のみ例外とする。

### statusの使い方

roadmapではartifactの進捗可視化に使う（todo→wip→done）。
それ以外の種別ではstatusを通常書かない（workflowとruntime-pipelineには「完了」の概念がない）。

### 外部ステークホルダーの表現

外部ステークホルダー（外部提出先・最終消費者・外部チームなど）は
artifact / process の `externalStakeholders` フィールドに列挙する。
変換グラフの出力ノードとして組織・人を artifact 扱いする必要はない。

```yaml
artifact:
  monthly_report:
    label: 月次コンプライアンスレポート
    externalStakeholders: [規制当局]
  published_skill:
    label: 配布済みスキル
    externalStakeholders: [外部ユーザー, 他プロジェクト開発者]
```

`owner`（内部責任者）と `externalStakeholders`（外部届け先）は対称的なフィールドとして機能する。
`externalStakeholders` も `owner` も消費エッジも持たない artifact は終端監査の検出対象となる（CLIサポート予定）。

組織境界をまたぐ引き継ぎ（チーム間合意・外部提出・差し戻しループ）は
workflow か runtime-pipeline に吸収し、組織境界は `owner` フィールドで表現する。
独立した種別（stakeholder-handoff）を設ける必要はない（後述）。

### 種別分類の対象スコープ

この種別分類は `.pfdsl/` ディレクトリでプロジェクトとして永続管理するPFDを対象とする。
PFDSLの記法は一回性のドキュメント（イベント当日の手順書・ランブックなど）にも使えるが、
そうした一回性PFDはファイル管理の文脈が異なるため種別分類の対象外とする。

## Rationale

### 「問いの単位」で種別を切る

roadmap / workflow / runtime-pipeline はそれぞれ「他の種別では答えられない固有の問い」を持つ。
種別をこの基準で定義することで、ファイル分割の判断を「どちらが正しいか」という主観の議論から
「この図が答える問いはどれか」という検証可能な問いへ変換できる。

### ecosystem を廃止した理由

当初 ecosystem（「この成果物は誰が使うか」に答える消費者マップ）を4種目として検討したが、廃止した。

5つの仮想プロジェクト（Noodle・Mentori・FleetOps・Zenith・Polaris）に「1種別1ファイル厳守」の制約のもと3種で設計させた実験で、以下が判明した。

- 消費者情報は workflow のエッジ・group・`externalStakeholders` フィールドで表現できる
- workflow で消費者を書く方が、ecosystem の静的マップより情報量が多い場合がある（消費→フィードバック→改善のループが書けるため）
- 「プロセスに変換できない純粋な外部消費者」は `externalStakeholders` フィールドで代替できる

ecosystem が提供していた「他の種別では答えられない固有の問い」は `externalStakeholders` フィールドと CLI の終端監査で代替可能と判断した。

### stakeholder-handoff を廃止した理由

「組織境界をまたぐ引き継ぎ」を独立種別にする案を検討した。
しかし「誰から誰へ何が渡るか」という問いを分解すると、
何が渡るか=artifact、誰から誰へ=ownerフィールド、いつ=エッジの順序、
という既存概念の組み合わせで完全に表現できる。
独立種別が持つべき「他のどの種別でも答えられない問い」が存在しなかった。
また「境界の種類」で種別を切ることは「問いの単位」で切る他3種別の設計原則と異質だった。

### workflow の命名

当初 dev-cycle という名称を検討したが「dev」が開発工程に限定されるニュアンスを持ち、
月次コンプライアンス提出・改善ループなどのユースケースを取りこぼす。
「誰が何をトリガーに動くか」という問いへの合致と通りの良さから workflow を採用した。

## Consequences

- pfd-opsスキルの種別説明を3種別（roadmap / workflow / runtime-pipeline）に更新する
- 新規プロジェクトのPFD設計時に問診リストを参照する手順をpfd-opsスキルに追記する
- 既存のpfd-opsプロトコル（着手判断・進捗更新・終端監査）はそのまま適用できる
- `externalStakeholders` フィールドのサポートを仕様書・CLIに追加する（終端監査の走査対象）
- ecosystem を使っていたプロジェクトは workflow へ移行する（このリポジトリでは移行済み）

## References

- `docs/adr/0017-kind-taxonomy/pfd-kinds-discussion.md` — 種別分類の検討ログ（仮想プロジェクト設計・審査・議論の全経緯）
- `docs/adr/0017-kind-taxonomy/` — 仮想プロジェクトの設計成果物と横断審査レポート（ecosystem廃止実験v2レポートを含む）
- ADR-0007（.pfdslディレクトリ規約）
- ADR-0008（グループは存在様式で切る）
