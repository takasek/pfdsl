# ecosystem種別廃止実験 v2 — レポート

## 実験の目的

PFD種別に ecosystem（「この成果物は誰が使うか」に答える消費者マップ）が必要かを検証する。

**仮説:** ecosystem が担っていた消費者マップの問いは、roadmap / workflow / runtime-pipeline の3種で表現できるのではないか。

**前回実験（v1）の失敗:** Polaris エージェントが workflow を3ファイルに分割し「消費者専用ファイル」という逃げ道を作ったため検証にならなかった。

**v2 での改善:** 「同一種別は1ファイル厳守、複数サイクルは group で分ける」という制約を明示した。

---

## 実験設計

5プロジェクトに3種定義 + 1種別1ファイル制約を渡し、独立エージェントが設計。その後審査エージェントが横断評価。

| プロジェクト | 特性 |
|---|---|
| Noodle（レシピ共有アプリ） | 2チーム、スプリント、API合意 |
| Mentori（AIスキル開発） | 成果物サイクル、外部配布 |
| FleetOps（車両管理システム） | データ変換チェーン、外部提出義務 |
| Zenith（カンファレンス運営） | 1回限り、複数ステークホルダー |
| Polaris（プラットフォームSDK） | 複数チームへの成果物提供、未使用検出ニーズ |

Polaris は「誰に読まれているか管理したい（使われていない成果物の検出）」という ecosystem の典型ユースケースを持たせた新規プロジェクト。

---

## 各プロジェクトの結果

### Noodle — 完全に吸収できた

**ファイル構成:** roadmap / workflow / runtime-pipeline（3ファイル）

**消費者マップの扱い:**
スプリントサイクルと API 合意サイクルを workflow の2 group に収めた。API 仕様書の消費関係が workflow のエッジとして自然に現れる。

```
api_spec >> implement_backend -> backend_impl
api_spec >> implement_ios    -> ios_impl
```

「iOSチームが api_spec を消費する」という関係は、このエッジを書いた瞬間に表現されている。消費者マップを別途書く必要がなかった。

**エージェント自己評価:**
> 消費者マップとして独立させたくなる衝動は一時あったが、それは「誰が何をトリガーに動くか」という問いであり、workflowの定義域の中に収まった。

**審査評価:** ○ 歪みなし

---

### Mentori — ほぼ吸収できた、1点正直な限界あり

**ファイル構成:** roadmap / workflow / runtime-pipeline（3ファイル）

`SampleDialogues` という artifact が2つの group（改善サイクル / 定期レビューサイクル）をまたいで入力として使われることで、「この成果物は誰が消費しているか」が図から読み取れる設計になった。

```
[GuideDoc, ADR, SampleDialogues] >> RegenerateSkill -> SkillSource  # 改善サイクル group
SampleDialogues >> ReviewDialogQuality -> ReviewReport              # レビューサイクル group
```

**唯一の限界（エージェントが自主報告）:**
> `PublishedSkill` の「誰が使うか」（エンドユーザー、他プロジェクトの開発者）を示したかった場面があった。ecosystem 種別であれば `PublishedSkill -> EndUser` や `PublishedSkill -> OtherProject` と書けるが、workflow では PublishedSkill が出力の末端になってしまい、その先の消費が見えない。
>
> 対処としては `PublishedSkill >> ReceiveFeedback -> UserFeedback` と書けるが、それはやや無理に workflow に押し込んだ形になる。

**解説:** 「外部ユーザーがスキルを使う」という行為は変換でも繰り返しサイクルでもなく、純粋な消費。process として書こうとすると V003（出力必須）を満たすために「UserFeedback」という出力を作らなければならず、その人工的な出力を正当化する理屈が必要になる。

**審査評価:** △ 軽微（全体設計への影響なし）

---

### FleetOps — 吸収できたが意味論的な歪みが発生

**ファイル構成:** runtime-pipeline / workflow / roadmap（3ファイル）

データ変換チェーンは自然に runtime-pipeline に収まった:
```
gps_stream >> validate_stream -> position_record
position_record >> aggregate_driving_log -> driving_log
driving_log >> generate_daily_report -> daily_report
daily_report >> compile_monthly_report -> monthly_report
```

**問題が起きた箇所 — 配信層:**

```
daily_report >> deliver_to_operator -> [operator_dashboard, operator_team]
monthly_report >> submit_to_regulator -> regulatory_authority
```

`operator_team`（社内オペレーターチーム）と `regulatory_authority`（規制当局）という **組織** を、変換グラフの **出力 artifact** として扱っている。

PFDSL の成果物概念は「保管できるモノ」を想定しており、組織はモノではない。V003（プロセスは出力を持つ）を満たすために組織を artifact 扱いするのは意味論との衝突。

**エージェントの自己評価:**
> 「モノ（ダッシュボード）」と「組織（オペレーターチーム）」を同列の出力として扱う不自然さを生む。ecosystem 種別であれば「成果物と消費者の対応」を変換グラフとは独立したレイヤーで記述できた。ただしコメントや description で補うことができる範囲内とは言える。

**解説:** これは軽微な歪みだが、ecosystem の設計的な役割を鮮明に示している。ecosystem は「成果物を主語に、消費者を別レイヤーで記述する」という構造を持っており、変換グラフに消費者情報を混入させなくていい。FleetOps は混入を強いられた。

**審査評価:** △ 中程度の歪み（軽微と判断されたが構造的には問題あり）

---

### Zenith — そもそも問題が起きなかった

**ファイル構成:** roadmap / workflow（2ファイル、runtime-pipeline は不要と判断）

**runtime-pipeline を省略した判断:**
> システムによるデータ変換が主役のプロセスを持たない。登壇申込フォームの送信やメール配信など「システムが動く」場面はあるが、変換境界を記述するほどの複雑さがなく、workflow内の入出力として十分に表現できる。

1回限りのイベントかつ消費者の多様性が低いため、消費者マップの問いがそもそも重要ではないプロジェクト。ecosystem がなくても何も失われない典型例。

**審査評価:** ○ 問題なし。「全種別が必要」という思い込みを防ぐ重要な参照事例。

---

### Polaris — 最も注目すべき結果

**ファイル構成:** roadmap / workflow / runtime-pipeline（3ファイル）

v1 では3つの workflow ファイルに分割して逃げた。v2 では1ファイル制約のもと、workflow を3 group に構造化することを強いられた。

**group 設計:**
- `monthly_release`: 月次 SDK リリースサイクル
- `doc_update`: 随時ドキュメント更新サイクル
- `consumption`: 消費チーム採用サイクル（消費者マップを兼用）

**消費者マップの表現（`consumption` group の核心）:**

```
[SDK_Package, API_Ref, Tutorial, Migration_Guide,
 Runbook_障害, Runbook_Deploy, Runbook_Rollback] >> P_teamA
[SDK_Package, API_Ref, Tutorial, Migration_Guide,
 Runbook_障害, Runbook_Deploy, Runbook_Rollback] >> P_teamB
[SDK_Package, API_Ref, Tutorial, Migration_Guide,
 Runbook_Deploy, Runbook_Rollback] >> P_teamC

P_teamA -> Feedback_Issue
P_teamB -> Feedback_Issue
P_teamC -> Feedback_Issue

Feedback_Issue（を経由して）>> P_write_tutorial（doc_update group）
```

**重要な発見:** このフィードバックループが書けることで、ecosystem では表現できなかった情報が追加された。

**エージェントの自己評価:**
> 「誰に読まれているか（消費者マップ）」は workflow の `consumption` group で自然に表現できた。**むしろ ecosystem 種別のような静的な消費者マップより、workflow として書くことで「消費チームからのフィードバックIssueが doc_update サイクルに戻る」というループが記述でき、情報が豊かになった。**

**審査の評価:**
> Polarisの`consumption` groupは、静的なecosystem図にはできなかったことを達成している。ecosystemは「今この瞬間の消費関係」しか写せないが、workflowは「消費から改善までのサイクル全体」を写せる。

**ただし拡張性の問題は残る:** 消費チームが3から30に増えたとき、P_teamA〜P_teamZの記述が破綻する。Polaris が成功できたのは消費チームが3つという規模だから。

**審査評価:** ◎ むしろ豊かになった（ただし規模の拡張性には懸念）

---

## 横断審査の判定

### ecosystem廃止の可否

**→ 条件付き廃止可能**

**廃止できる条件（全てを満たす場合）:**
1. 全ての消費者が workflow のプロセス参加者として表現できる
2. 「読むだけ・使うだけ」でプロセスに変換できない外部消費者が少ない（または description で補える規模）

**廃止できない条件（いずれかに当てはまる場合）:**
1. 「読むだけ」の外部消費者が複数存在する（例: FleetOps の規制当局）
2. 成果物の種類が多く、消費者との対応を独立した図として管理したい規模

---

## 実験全体から見えてきたこと

### ecosystem の本質的な役割

今回の実験で ecosystem の存在意義が逆説的に浮かび上がった。

> **ecosystem は「成果物を主語に、消費者を変換グラフの外に置く」という構造を提供する。**

workflow / runtime-pipeline は「プロセスを経て artifact が変換される」という構造を前提とする。消費者はプロセスとして書かなければならない。だが「読む」「使う」「提出先になる」という純粋な消費行為は、変換を伴わないためプロセスとして書くと意味論が歪む（V003 を満たすための人工的な出力が必要になる）。

ecosystem はそのレイヤーを分離している。

### workflow の消費者表現は ecosystem より豊かになれる

一方で Polaris の `consumption` group が示したように、消費者をフィードバックループとして書けることは ecosystem にはない表現力。

| 視点 | ecosystem | workflow の consumption group |
|---|---|---|
| 得意なこと | 現状の消費関係の棚卸し（終端監査） | 消費から改善までの動態サイクル |
| 苦手なこと | フィードバックループの表現 | 純粋な外部消費者（プロセスに変換できない） |
| スケール耐性 | 高い（消費者を列挙するだけ） | 低い（消費者×成果物分のプロセスが増殖） |

これは補完関係であり、どちらかが正しいという話ではない。

### FleetOps が示した設計の限界線

「組織を artifact として出力に置く」という歪みは、runtime-pipeline の「配信層」と「変換層」の境界が曖昧なことに起因している。

runtime-pipeline が「システム内部のデータ変換」を対象とするなら、`submit_to_regulator` のような組織への配信プロセスはその範囲外かもしれない。このプロセスは workflow（誰が判断してどう提出するか）として書く方が自然だった可能性がある。

これは runtime-pipeline の定義に対する将来的な問いを残している。

### Zenith の runtime-pipeline 省略は重要な参照事例

「データ変換の複雑さが一定以下なら runtime-pipeline を省略する」という判断を明示した唯一の事例。PFD の種別は全てが必要なのではなく、プロジェクトの問いに応じて選ぶものであることを示している。

---

## 結論と次のアクション候補

**ecosystem 廃止の結論:** 3種で「ほぼ」表現できるが、FleetOps の歪みと Mentori の末端問題が残る。「外部消費者が複数いる場合は ecosystem が有用」という条件付き存在意義は実証された。

**議論すべき問い:**
1. FleetOps の歪み（組織を artifact 扱い）を「軽微で許容範囲」と見るか、ecosystem 保持の根拠と見るか
2. Polaris の発見（workflow の方が ecosystem より豊か）をもって、「ecosystem は積極的に不要」と言えるか
3. ecosystem を「オプション種別」として位置づける（問診リストで条件分岐させる）という中間案はどうか

---

*実験記録: tmp/pfd-stress-test/ 以下の各 .md ファイル参照*
*実験日: 2026-06-18*
