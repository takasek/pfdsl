<!-- DO NOT EDIT — generated from docs/examples/ in https://github.com/takasek/pfdsl -->

# PFDSL Examples Reference

Realistic domain examples demonstrating the quality guide. Use the index to Read only the relevant line range.

## Index

- book-writing（技術書執筆・出版フロー）L20–L137 — parts による章 artifact の分割と合流（compile）、レビュー後の改版をフェーズ境界の別 artifact で表すパターン。
- conference-ops（技術カンファレンス開催フロー）L139–L282 — 時間的凝集で束ねない並列手配（会場・スポンサー・プログラム）の依存分割と、運営マニュアルへの合流点。
- contract-negotiation（業務委託契約締結フロー）L284–L385 — 往復で収束する交渉の >>? 還流（修正稿 >>? 交渉）と、双方リーガルレビューの並列分割。
- etl-pipeline（データ分析ETLパイプライン）L387–L491 — 可変リソース（本番 DB）のスナップショット化と、単一生成の mart を複数消費者が使う扇形。
- hiring-process（採用プロセス）L493–L591 — 生成者の整合 — 応募者の提出物はフロー外入力、各プロセスは自分が作る評価記録だけを出力する。
- incident-response（本番障害対応フロー）L593–L686 — 応急処置・調査の「作業」を記録 artifact に外化し、runbook 整備を >>? で次回対応へ還流する組織学習。
- ml-model-dev（機械学習モデル開発・運用フロー）L688–L788 — 版を列挙できない定常再学習サイクルを >>?（retrain_dataset >>? train_model）で表す改版パターン。
- security-advisory（OSS 脆弱性 Coordinated Disclosure フロー）L790–L911 — 暗黙依存の明示（修正開発に base_code）と、公開物・アドバイザリを終端とする外部調整フロー。
- web-feature-dev（Webアプリ機能開発フロー）L913–L1027 — 観点表をレビュー入力にし指摘を >>? で観点表整備へ還流する組織学習パターンと、QA からの修正還流。
- xddp-derived-dev（XDDP風派生開発フロー）L1029–L1129 — 派生開発の暗黙依存（base_code・理解資料）を入力として明示し、欠陥報告を >>? で実装へ還流する。

## book-writing — 技術書執筆・出版フロー

```pfdsl
---
title: 技術書執筆・出版フロー
description: parts による章 artifact の分割と合流（compile）、レビュー後の改版をフェーズ境界の別 artifact で表すパターン。
layout:
  direction: LR
  maxWidth: 130

artifact:
  proposal:
    label: 企画書
    status: done
    description: 書籍の目的・対象読者・章構成案
    owner: 著者
  outline:
    label: 章構成案
    status: done
    owner: 著者
  manuscript:
    label: 書籍原稿
    status: wip
    description: 全章を束ねた書籍原稿
    owner: 著者
    parts: [ch01, ch02, ch03, ch04, ch05]
  ch01:
    label: 第1章原稿
    status: done
    owner: 著者
  ch02:
    label: 第2章原稿
    status: done
    owner: 著者
  ch03:
    label: 第3章原稿
    status: wip
    owner: 著者
  ch04:
    label: 第4章原稿
    status: todo
    owner: 著者
  ch05:
    label: 第5章原稿
    status: todo
    owner: 著者
  review_comment:
    label: 査読コメント
    status: wip
    description: 査読者による技術的正確性・可読性への指摘
    owner: 査読者
  revised_manuscript:
    label: 修正済み原稿
    status: todo
    owner: 著者
  copyedited_manuscript:
    label: 校正済み原稿
    status: todo
    owner: 編集者
  print_ready_pdf:
    label: 印刷用PDF
    status: todo
    owner: DTP

process:
  compile:
    label: 原稿統合
    description: 各章を束ねて書籍原稿を構成する
    owner: 著者
  plan:
    label: 企画立案
    description: 出版社と合意した企画書をもとに章構成案を策定する
    owner: 著者
  write:
    label: 執筆
    description: 章構成案に沿って各章の原稿を執筆する
    owner: 著者
  peer_review:
    label: 査読
    description: 技術的正確性・サンプルコードの動作を確認する
    owner: 査読者
  revise:
    label: 著者改訂
    description: 査読コメントを反映して原稿を修正する
    owner: 著者
  copyedit:
    label: 校正・編集
    description: 文章の流れ・表記ゆれ・レイアウトを整える
    owner: 編集者
  typeset:
    label: 組版・PDF化
    description: 校正済み原稿をDTPで組んで印刷用PDFを生成する
    owner: DTP

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  waiting: { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }
---

proposal >> plan -> outline

outline >> write -> [ch01, ch02, ch03, ch04, ch05]

[ch01, ch02, ch03, ch04, ch05] >> compile -> manuscript

manuscript >> peer_review -> review_comment

[manuscript, review_comment] >> revise -> revised_manuscript

revised_manuscript >> copyedit -> copyedited_manuscript

copyedited_manuscript >> typeset -> print_ready_pdf
```

---

## conference-ops — 技術カンファレンス開催フロー

```pfdsl
---
title: 技術カンファレンス開催フロー
description: 時間的凝集で束ねない並列手配（会場・スポンサー・プログラム）の依存分割と、運営マニュアルへの合流点。
layout:
  direction: LR
  maxWidth: 130

group:
  planning:
    label: 企画・準備フェーズ
    color: "#e8f4fd"
  event_day:
    label: 当日運営
    color: "#fef9e7"
  post:
    label: 事後処理
    color: "#eafaf1"

artifact:
  event_plan:
    label: 開催企画書
    status: done
    description: 開催規模・日程・予算・コンセプトを定めた企画書
    owner: 運営リーダー
    group: planning
  cfp_announcement:
    label: CFP 告知文
    status: done
    description: 募集テーマ・応募要件・締切を記載した Call for Proposals 告知
    owner: プログラム委員会
    group: planning
  session_proposals:
    label: セッション応募一覧
    status: done
    description: 応募者から提出されたセッション提案の全件リスト
    owner: プログラム委員会
    group: planning
  program:
    label: 確定プログラム
    description: 採択セッション・タイムテーブル・登壇者情報を確定したプログラム
    owner: プログラム委員会
    group: planning
  venue_contract:
    label: 会場契約書
    description: 会場との賃貸・利用契約書
    owner: 運営事務局
    group: planning
  sponsor_agreements:
    label: スポンサー協賛合意書
    description: 各スポンサーとの協賛内容・金額・特典を定めた合意書
    owner: スポンサー担当
    group: planning
  operation_manual:
    label: 当日運営マニュアル
    description: 役割分担・タイムライン・緊急連絡先を記載した当日運営手順書
    owner: 運営リーダー
    group: planning
  event_record:
    label: 開催記録
    description: 参加者数・発生トラブル・会場状況を記録した当日ログ
    owner: 運営事務局
    group: event_day
  session_videos:
    label: セッション録画
    description: 各セッションの収録動画ファイル
    owner: 映像担当
    group: event_day
  satisfaction_survey:
    label: 参加者アンケート結果
    description: 参加者から回収した満足度・感想・改善要望のアンケートデータ
    owner: 運営事務局
    group: post
  conference_report:
    label: 開催レポート
    description: 開催概要・統計・ハイライト・改善提案をまとめた公式レポート
    owner: 運営リーダー
    group: post

process:
  recruit_cfp:
    label: CFP 募集
    description: CFP 告知を公開し応募者からセッション提案を受け付ける
    owner: プログラム委員会
    group: planning
  select_sessions:
    label: セッション採択
    description: 応募一覧をレビュースコアリングし採択セッションを決定する
    owner: プログラム委員会
    group: planning
  arrange_venue:
    label: 会場手配
    description: 企画書の規模・日程に合う会場を確保し契約する
    owner: 運営事務局
    group: planning
  recruit_sponsors:
    label: スポンサー募集
    description: 企画書と告知内容をもとに協賛企業と交渉し合意書を締結する
    owner: スポンサー担当
    group: planning
  prepare_operations:
    label: 当日準備
    description: プログラム・会場・スポンサー情報を統合して運営マニュアルを作成する
    owner: 運営リーダー
    group: planning
  run_event:
    label: 当日運営
    description: マニュアルに従い受付・進行・会場管理を行い開催記録と録画を取得する
    owner: 運営事務局
    group: event_day
  compile_report:
    label: 開催レポート作成
    description: 開催記録・アンケート・録画をもとに開催レポートを作成する
    owner: 運営リーダー
    group: post

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  waiting: { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }
---

cfp_announcement >> recruit_cfp -> session_proposals

session_proposals >> select_sessions -> program

event_plan >> arrange_venue -> venue_contract

[event_plan, cfp_announcement] >> recruit_sponsors -> sponsor_agreements

[program, venue_contract, sponsor_agreements] >> prepare_operations -> operation_manual

operation_manual >> run_event -> [event_record, session_videos]

[event_record, session_videos] >> compile_report -> conference_report

satisfaction_survey >> compile_report
```

---

## contract-negotiation — 業務委託契約締結フロー

```pfdsl
---
title: 業務委託契約締結フロー
description: 往復で収束する交渉の >>? 還流（修正稿 >>? 交渉）と、双方リーガルレビューの並列分割。
layout:
  direction: LR
  maxWidth: 130

artifact:
  sow:
    label: 業務概要（SOW）
    status: done
    description: 発注側が作成した業務範囲・成果物・スケジュールの概要
    owner: 発注側 BizDev
  contract_draft:
    label: 契約書ドラフト
    status: done
    description: 発注側が初稿として作成した業務委託契約書
    owner: 発注側 Legal
  negotiation_memo:
    label: 交渉メモ
    description: 受注側から提示された修正要求と発注側の回答を記録した往復メモ
    owner: 双方 BizDev
  revised_draft:
    label: 修正契約書ドラフト
    description: 交渉内容を反映した改訂版契約書ドラフト
    owner: 発注側 Legal
  orderer_legal_opinion:
    label: 発注側リーガルチェック意見書
    description: 発注側法務による契約書の法的問題点・修正指示
    owner: 発注側 Legal
  vendor_legal_opinion:
    label: 受注側リーガルチェック意見書
    description: 受注側法務による契約書の法的問題点・修正指示
    owner: 受注側 Legal
  final_contract:
    label: 最終契約書
    description: 双方のリーガルチェックを経て合意に至った最終版契約書
    owner: 発注側 Legal
  signed_contract:
    label: 締結済み契約書
    description: 双方が押印・署名した有効な業務委託契約書
    owner: 双方

process:
  draft_contract:
    label: 契約書起草
    description: SOW をもとに業務委託契約書の初稿を作成する
    owner: 発注側 Legal
  negotiate_terms:
    label: 条件交渉
    description: 受注側と契約条件を複数回往復して合意点を探り交渉メモを作成する
    owner: 双方 BizDev
  revise_draft:
    label: ドラフト改訂
    description: 交渉メモの合意内容を契約書本文に反映する
    owner: 発注側 Legal
  review_orderer_legal:
    label: 発注側リーガルチェック
    description: 発注側法務が契約書を審査し意見書を作成する
    owner: 発注側 Legal
  review_vendor_legal:
    label: 受注側リーガルチェック
    description: 受注側法務が契約書を審査し意見書を作成する
    owner: 受注側 Legal
  finalize_contract:
    label: 最終版確定
    description: 双方の意見書を反映し条文を最終調整して最終契約書を確定する
    owner: 発注側 Legal
  execute_contract:
    label: 契約締結（押印）
    description: 双方の代表者が最終契約書に署名・押印して契約を締結する
    owner: 双方

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  waiting: { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }
---

sow >> draft_contract -> contract_draft

contract_draft >> negotiate_terms -> negotiation_memo

[contract_draft, negotiation_memo] >> revise_draft -> revised_draft

revised_draft >> review_orderer_legal -> orderer_legal_opinion

revised_draft >> review_vendor_legal -> vendor_legal_opinion

[revised_draft, orderer_legal_opinion, vendor_legal_opinion] >> finalize_contract -> final_contract

revised_draft >>? negotiate_terms

final_contract >> execute_contract -> signed_contract
```

---

## etl-pipeline — データ分析ETLパイプライン

```pfdsl
---
title: データ分析ETLパイプライン
description: 可変リソース（本番 DB）のスナップショット化と、単一生成の mart を複数消費者が使う扇形。
layout:
  direction: LR
  maxWidth: 120

artifact:
  crm_raw:
    label: CRM生データ
    status: done
    description: CRMシステムからのエクスポートCSV
    group: ingest
  access_log:
    label: アクセスログ
    status: done
    description: Webサーバーの生ログファイル
    group: ingest
  sales_db_snapshot:
    label: 売上DBスナップショット
    status: done
    description: 売上DBの日次ダンプ
    group: ingest
  crm_clean:
    label: 顧客マスタ（クレンジング済）
    status: done
    group: transform
  access_summary:
    label: セッション集計テーブル
    status: wip
    group: transform
  sales_fact:
    label: 売上ファクトテーブル
    status: done
    group: transform
  mart:
    label: 分析データマート
    status: wip
    description: BIツール向けに結合・集計されたワイドテーブル
    group: transform
  dashboard:
    label: KPIダッシュボード
    status: todo
    group: output
  weekly_report:
    label: 週次レポート
    status: todo
    group: output

process:
  clean_crm:
    label: 顧客データクレンジング
    description: 重複排除・欠損補完・名寄せ
    group: ingest
  parse_logs:
    label: ログパース
    description: アクセスログをセッション単位に集計
    group: ingest
  load_sales:
    label: 売上データロード
    description: DBスナップショットをファクトテーブルに変換
    group: ingest
  build_mart:
    label: データマート構築
    description: 顧客・セッション・売上を結合しBIテーブルを生成
    group: transform
  publish_dashboard:
    label: ダッシュボード公開
    description: BIツールにマートを接続し可視化を更新
    group: output
  generate_report:
    label: レポート生成
    description: マートから週次集計レポートを作成
    group: output

group:
  ingest:    { label: 取込層,   color: "#dce8f5" }
  transform: { label: 変換層,   color: "#fdf3dc" }
  output:    { label: 出力層,   color: "#dcf5e4" }

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  waiting: { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }
---

crm_raw >> clean_crm -> crm_clean

access_log >> parse_logs -> access_summary

sales_db_snapshot >> load_sales -> sales_fact

[crm_clean, access_summary, sales_fact] >> build_mart -> mart

mart >> publish_dashboard -> dashboard

mart >> generate_report -> weekly_report
```

---

## hiring-process — 採用プロセス

```pfdsl
---
title: 採用プロセス
description: 生成者の整合 — 応募者の提出物はフロー外入力、各プロセスは自分が作る評価記録だけを出力する。
layout:
  direction: LR
  maxWidth: 120

artifact:
  job_description:
    label: 求人票
    status: done
    description: 職種・必須スキル・歓迎スキル・待遇を記載した求人票
    owner: HR
  resume:
    label: 応募書類
    status: done
    description: 履歴書・職務経歴書・ポートフォリオ
    owner: 応募者
  screening_result:
    label: 書類選考結果
    status: done
    description: 合否判定と所見を記録したスプレッドシート
    owner: HR
  interview_sheet:
    label: 面接評価シート
    status: wip
    description: 技術・カルチャーフィットの評価軸と記録
    owner: 面接官
  assignment:
    label: 技術課題
    status: done
    description: 応募者に出題するコーディング課題
    owner: 面接官
  technical_result:
    label: 技術課題提出物
    status: wip
    description: コーディング課題・設計課題の成果物
    owner: 応募者
  final_evaluation:
    label: 最終評価報告書
    status: todo
    description: 面接・技術課題を総合した採用判定レポート
    owner: 採用委員会
  offer_letter:
    label: 内定通知書
    status: todo
    description: 処遇条件を記載した内定オファーレター
    owner: HR

process:
  screen_resume:
    label: 書類選考
    description: 求人票の要件に照らして応募書類を評価する
    owner: HR
  prepare_assignment:
    label: 課題作成
    owner: 面接官
  conduct_interview:
    label: 面接実施
    description: 技術面接・HR面接を実施し評価シートに記録する
    owner: 面接官
  solve_assignment:
    label: 課題実施
    description: 応募者が技術課題に取り組み成果物を提出する
    owner: 応募者
  evaluate_final:
    label: 最終評価
    description: 面接シートと技術課題を総合して採用判定する
    owner: 採用委員会
  extend_offer:
    label: オファー提示
    description: 最終評価に基づき処遇を決定し内定通知書を作成する
    owner: HR

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  waiting: { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }
---

[job_description, resume] >> screen_resume -> screening_result

job_description >> prepare_assignment -> assignment

[screening_result, job_description] >> conduct_interview -> interview_sheet

assignment >> solve_assignment -> technical_result

[interview_sheet, technical_result] >> evaluate_final -> final_evaluation

final_evaluation >> extend_offer -> offer_letter
```

---

## incident-response — 本番障害対応フロー

```pfdsl
---
title: 本番障害対応フロー
description: 応急処置・調査の「作業」を記録 artifact に外化し、runbook 整備を >>? で次回対応へ還流する組織学習。
layout:
  direction: LR
  maxWidth: 130

artifact:
  alert:
    label: 監視アラート
    status: done
    description: 監視システムが検知した異常の通知
    owner: SRE
  triage_record:
    label: トリアージ記録
    status: done
    description: 影響範囲・重大度・対応優先度を記録した初動判断メモ
    owner: 当直 SRE
  mitigation_record:
    label: 暫定対応記録
    description: 実施した応急処置（ロールバック・切り替え等）の内容と結果の記録
    owner: SRE
  service_restored:
    label: サービス復旧確認
    description: サービスが正常動作に戻ったことを示す確認記録
    owner: SRE
  rca_draft:
    label: 根本原因分析（草稿）
    description: 障害の技術的原因を特定した調査記録
    owner: 担当エンジニア
  timeline:
    label: 障害タイムライン
    description: 検知から復旧までのイベントを時系列で記録した文書
    owner: 当直 SRE
  postmortem_doc:
    label: ポストモーテム文書
    description: 原因・影響・対応経緯・再発防止策を記載した公式記録
    owner: Engineering Manager
  action_items:
    label: 改善アクションリスト
    description: ポストモーテムで合意した再発防止アクションの一覧
    owner: Engineering Manager
  runbook:
    label: ランブック（更新版）
    description: 今回の知見を反映した障害対応手順書
    owner: SRE

process:
  triage:
    label: トリアージ
    description: アラートを受け影響範囲と重大度を判断し対応を開始する
    owner: 当直 SRE
  apply_mitigation:
    label: 応急対応
    description: ロールバックや迂回経路切り替えでサービスを早期復旧する
    owner: SRE
  investigate:
    label: 根本原因調査
    description: ログ・メトリクス・コードを精査し障害の根本原因を特定する
    owner: 担当エンジニア
  conduct_postmortem:
    label: ポストモーテム実施
    description: 関係者が集まりタイムラインを確認し再発防止策を合意する
    owner: Engineering Manager
  update_runbook:
    label: ランブック更新
    description: ポストモーテムの知見を反映し次回対応手順を改善する
    owner: SRE

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  waiting: { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }
---

alert >> triage -> triage_record

triage_record >> apply_mitigation -> [mitigation_record, service_restored]

[triage_record, service_restored, mitigation_record] >> investigate -> [rca_draft, timeline]

[rca_draft, timeline] >> conduct_postmortem -> [postmortem_doc, action_items]

[postmortem_doc, action_items] >> update_runbook -> runbook

runbook >>? triage
```

---

## ml-model-dev — 機械学習モデル開発・運用フロー

```pfdsl
---
title: 機械学習モデル開発・運用フロー
description: 版を列挙できない定常再学習サイクルを >>?（retrain_dataset >>? train_model）で表す改版パターン。
layout:
  direction: LR
  maxWidth: 130

artifact:
  raw_dataset:
    label: 生データセット
    status: done
    description: 収集した未加工のトレーニング用データ
    owner: Data Engineer
  feature_spec:
    label: 特徴量定義書
    status: done
    description: 使用する特徴量の定義・前処理ルールを記載した文書
    owner: ML Engineer
  prepared_dataset:
    label: 加工済みデータセット
    description: クリーニング・特徴量エンジニアリング済みのデータセット
    owner: Data Engineer
  trained_model:
    label: 学習済みモデル
    description: トレーニング完了後のモデルアーティファクト
    owner: ML Engineer
  eval_report:
    label: 評価レポート
    description: 精度指標・混同行列・スライス評価を記載した評価結果文書
    owner: ML Engineer
  serving_model:
    label: サービング中モデル
    description: 本番環境にデプロイされ推論リクエストを処理しているモデル
    owner: MLOps
  traffic_snapshot:
    label: 本番トラフィックスナップショット
    status: done
    description: 本番の入力データを時点固定で切り出した観測用データセット
    owner: MLOps
  drift_report:
    label: ドリフト検知レポート
    description: 学習時とのデータ分布差異・精度劣化を記録したレポート
    owner: MLOps
  retrain_dataset:
    label: 再学習用データセット
    description: ドリフト検知後に収集・加工した最新期間のデータセット
    owner: Data Engineer

process:
  prepare_data:
    label: データ準備
    description: 生データをクリーニングし特徴量定義書に従って特徴量を生成する
    owner: Data Engineer
  train_model:
    label: モデル学習
    description: 加工済みデータセットでモデルをトレーニングする
    owner: ML Engineer
  evaluate_model:
    label: モデル評価
    description: 保留テストセットで精度・公平性を評価し評価レポートを作成する
    owner: ML Engineer
  deploy_model:
    label: モデルデプロイ
    description: 評価を通過したモデルを本番環境にデプロイする
    owner: MLOps
  monitor_drift:
    label: ドリフト監視
    description: 本番データ分布を定期観測し学習時との乖離を検知する
    owner: MLOps
  collect_retrain_data:
    label: 再学習データ収集
    description: ドリフト期間以降のデータを収集・加工して再学習用データセットを作成する
    owner: Data Engineer

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  waiting: { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }
---

[raw_dataset, feature_spec] >> prepare_data -> prepared_dataset

prepared_dataset >> train_model -> trained_model

[trained_model, prepared_dataset] >> evaluate_model -> eval_report

[trained_model, eval_report] >> deploy_model -> serving_model

[serving_model, traffic_snapshot, prepared_dataset] >> monitor_drift -> drift_report

[drift_report, traffic_snapshot] >> collect_retrain_data -> retrain_dataset

retrain_dataset >>? train_model
```

---

## security-advisory — OSS 脆弱性 Coordinated Disclosure フロー

```pfdsl
---
title: OSS 脆弱性 Coordinated Disclosure フロー
description: 暗黙依存の明示（修正開発に base_code）と、公開物・アドバイザリを終端とする外部調整フロー。
layout:
  direction: LR
  maxWidth: 130

group:
  private:
    label: 非公開フェーズ（Embargo）
    color: "#fdf2f8"
  public:
    label: 公開フェーズ
    color: "#eafaf1"

artifact:
  base_code:
    label: ベースコード
    status: done
    description: 脆弱性が存在する公開リポジトリのソースコード
    owner: 開発チーム
    group: private
  vulnerability_report:
    label: 脆弱性報告（非公開）
    status: done
    description: 外部研究者から受け取った脆弱性の詳細・再現手順・PoC
    owner: セキュリティ担当
    group: private
  triage_result:
    label: トリアージ結果
    status: done
    description: 影響範囲・深刻度（CVSS）・影響バージョンを評価した記録
    owner: セキュリティ担当
    group: private
  cveid:
    label: 予約済み CVE ID
    description: MITRE/NVD から払い出した CVE 識別子
    owner: セキュリティ担当
    group: private
  fix_patch:
    label: 修正パッチ（非公開）
    description: 非公開ブランチで開発・テスト済みの脆弱性修正コード
    owner: 開発チーム
    group: private
  patch_review_record:
    label: パッチレビュー記録
    description: セキュリティ観点のコードレビューと承認記録
    owner: セキュリティ担当
    group: private
  disclosure_plan:
    label: 公開調整計画
    description: 公開日・連携先（ディストリビュータ・下流パッケージ）・通知スケジュールを記載した計画書
    owner: セキュリティ担当
    group: private
  fixed_release:
    label: 修正済みリリース
    description: パッチを含む正式リリース版（タグ・配布物）
    owner: リリースマネージャー
    group: public
  security_advisory:
    label: セキュリティアドバイザリ
    description: CVE・影響バージョン・修正方法・回避策を記載した公開勧告文書
    owner: セキュリティ担当
    group: public

process:
  triage_vuln:
    label: 脆弱性トリアージ
    description: 報告を検証し影響範囲と深刻度を評価してトリアージ結果を作成する
    owner: セキュリティ担当
    group: private
  reserve_cve:
    label: CVE 予約
    description: MITRE に連絡し CVE ID を非公開状態で予約する
    owner: セキュリティ担当
    group: private
  develop_fix:
    label: 修正開発
    description: 非公開ブランチで脆弱性を修正するコードを開発しテストする
    owner: 開発チーム
    group: private
  review_patch:
    label: パッチレビュー
    description: 修正パッチをセキュリティ観点でレビューし承認する
    owner: セキュリティ担当
    group: private
  coordinate_disclosure:
    label: 公開調整
    description: 公開日を設定しディストリビュータ・下流パッケージ管理者と事前共有して公開調整計画を作成する
    owner: セキュリティ担当
    group: private
  publish_fix:
    label: 修正版・アドバイザリ公開
    description: 調整した公開日に修正済みリリースとセキュリティアドバイザリを同時公開する
    owner: リリースマネージャー
    group: public

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  waiting: { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }
---

vulnerability_report >> triage_vuln -> triage_result

triage_result >> reserve_cve -> cveid

[triage_result, vulnerability_report, base_code] >> develop_fix -> fix_patch

fix_patch >> review_patch -> patch_review_record

[patch_review_record, cveid] >> coordinate_disclosure -> disclosure_plan

[patch_review_record, disclosure_plan] >> publish_fix -> [fixed_release, security_advisory]
```

---

## web-feature-dev — Webアプリ機能開発フロー

```pfdsl
---
title: Webアプリ機能開発フロー
description: 観点表をレビュー入力にし指摘を >>? で観点表整備へ還流する組織学習パターンと、QA からの修正還流。
layout:
  direction: LR
  maxWidth: 120

artifact:
  requirement:
    label: 要求仕様書
    status: done
    description: 機能要求・受け入れ条件を記述した仕様書
    owner: PO
  design_doc:
    label: 設計書
    status: done
    description: API設計・画面設計・DB設計を含む技術設計書
    owner: Tech Lead
  implementation:
    label: 実装コード
    status: wip
    description: プルリクエスト単位の実装差分
    owner: Dev
  review_comment:
    label: レビュー指摘票
    status: wip
    description: コードレビューで挙げられた指摘事項
    owner: Reviewer
  test_report:
    label: テスト報告書
    status: todo
    description: QAによる動作確認結果・不具合一覧
    owner: QA
  bug_ticket:
    label: バグチケット
    status: todo
    description: QA検出バグを起票したチケット
    owner: QA
  deployed_release:
    label: リリース版
    status: todo
    description: 本番環境にデプロイされた成果物
    owner: Tech Lead
  release_note:
    label: リリースノート
    status: todo
    description: 本番リリース内容の変更点まとめ
    owner: Tech Lead
  coding_standard:
    label: コーディング規約
    status: done
    description: 組織共通のコーディング規約・設計原則
  checklist:
    label: レビュー観点表
    status: done
    description: 過去の指摘を反映して整備されるレビュー観点のチェックリスト
    owner: Reviewer

process:
  design:
    label: 設計
    description: 要求仕様を読み込み技術設計書を作成する
    owner: Tech Lead
  implement:
    label: 実装
    description: 設計書に基づきコードを書きPRを作成する
    owner: Dev
  review_code:
    label: コードレビュー
    description: PRを読み指摘票を作成する
    owner: Reviewer
  qa_test:
    label: QAテスト
    description: ステージング環境で動作確認しテスト報告書を作成する
    owner: QA
  release:
    label: リリース
    description: 本番デプロイとリリースノート作成
    owner: Tech Lead
  curate_checklist:
    label: 観点表整備
    description: 規約と過去のレビュー指摘をもとに観点表を更新する
    owner: Reviewer

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  waiting: { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }
---

requirement >> design -> design_doc

design_doc >> implement -> implementation

coding_standard >> curate_checklist -> checklist

[implementation, checklist] >> review_code -> review_comment

review_comment >>? curate_checklist

review_comment >>? implement

[implementation, design_doc] >> qa_test -> [test_report, bug_ticket]

bug_ticket >>? implement

[test_report, implementation] >> release -> [deployed_release, release_note]
```

---

## xddp-derived-dev — XDDP風派生開発フロー

```pfdsl
---
title: XDDP風派生開発フロー
description: 派生開発の暗黙依存（base_code・理解資料）を入力として明示し、欠陥報告を >>? で実装へ還流する。
layout:
  direction: LR
  maxWidth: 130

artifact:
  change_request:
    label: 変更要求書
    status: done
    description: 顧客からの変更要求（問題・目的・制約）
    owner: PL
  usdm:
    label: 変更要求仕様書（USDM）
    status: done
    description: 要求・理由・仕様をUSDM形式で構造化した文書
    owner: PL
  base_code:
    label: ベースコード
    status: done
    description: 変更対象の既存ソースコード
    owner: リポジトリ
  understanding_doc:
    label: 既存コード理解資料
    status: done
    description: 変更箇所の構造・依存関係・影響範囲を記述した調査メモ
    owner: Dev
  change_design:
    label: 変更設計書
    status: wip
    description: どこをどう変えるかを記述した変更三点セットの設計部分
    owner: Dev
  change_impl:
    label: 変更実装（差分コード）
    status: wip
    description: 変更箇所のみを切り出した差分コード。変更三点セットの実装部分
    owner: Dev
  change_test_spec:
    label: 変更テスト仕様書
    status: todo
    description: 変更仕様を確認するためのテストケース一覧
    owner: Test
  test_result:
    label: テスト結果報告書
    status: todo
    description: 変更テスト仕様書に沿った実行結果と合否
    owner: Test
  defect_report:
    label: 不具合票
    status: todo
    description: テストで発見した不具合の原因・再現手順・修正方針
    owner: Test

process:
  write_usdm:
    label: USDM作成
    description: 変更要求書をUSDM形式の仕様書に変換する
    owner: PL
  investigate_base:
    label: ベースコード調査
    description: 変更箇所の現状コードを読み理解資料にまとめる
    owner: Dev
  design_change:
    label: 変更設計
    description: USDMと既存コード理解資料をもとに変更設計書を作成する
    owner: Dev
  implement_change:
    label: 変更実装
    description: 変更設計書に基づき差分コードを実装する
    owner: Dev
  test_change:
    label: 変更テスト
    description: 変更テスト仕様書を実行し結果を記録する
    owner: Test

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  waiting: { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }
---

change_request >> write_usdm -> usdm

base_code >> investigate_base -> understanding_doc

[usdm, understanding_doc] >> design_change -> [change_design, change_test_spec]

[change_design, understanding_doc, base_code] >> implement_change -> change_impl

defect_report >>? implement_change

[change_test_spec, change_impl] >> test_change -> [test_result, defect_report]
```

---

