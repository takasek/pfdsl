# ADR — PFD 方法論の設計決定記録

実践ラウンドと設計議論から蒸留した、PFD 方法論の重要な設計決定を記録する。

## 改訂規約

- **番号の取得**: 新 ADR を書く前に main の `docs/adr/README.md` を確認し、末尾番号の次を取る。並行ブランチでの衝突を防ぐため、ブランチ作成後・ファイル作成前に確認する
- **誤記・ID 等の事実修正**: その場で編集する（履歴は git が保持）
- **同日の設計続行による改訂**: 本文を書き直し、Status 行に改訂注記を付ける（例: ADR-0009）
- **後日の翻意**: 旧 ADR は編集せず新 ADR で上書きし、旧 Status を `Superseded by ADR-NNNN` に変更する。過去の判断の記録を消さないことが ADR の存在意義
- **受理時の蒸留判定**: 適用可能なルールを含む ADR は、受理時に品質ガイド（pfdsl スキル）への1行蒸留の要否を判定する。ADR は根拠の恒久記録、ガイドは執筆時の参照物 — 執筆・レビュー時に ADR 全読は要求しない

## 一覧

- **ADR-0001** [成果物の有形性](0001-tangible-outputs-intangible-inputs.md) — 出力は保管・検証可能なモノのみ、入力はフロー外リソースなら不定形を許可する非対称規則
- **ADR-0002** [改版の表現](0002-revision-modeling.md) — 単一生成元制約下での改版・ループ・定常サイクルを3形態で使い分ける
- **ADR-0003** [update 意味論の不採用](0003-no-update-semantics.md) — 可変リソースはスナップショット artifact として表現し、DAG 性と静的解析性を保つ
- **ADR-0004** [プロセス粒度の決定基準](0004-process-granularity.md) — 時間的凝集禁止・新依存なし分割禁止・相互依存の1プロセス化・所有権境界優先の4基準
- **ADR-0005** [条件分岐の不採用](0005-no-conditional-branching.md) — PFD は成果物の依存グラフであり、分岐は成果物定義の誤りのシグナルとして設計で解消する
- **ADR-0006** [品質担保の二層構造](0006-rules-plus-tooling.md) — 設計判断系はルール（ガイド）、機械検査可能な性質は lint（ツール）に分業する
- **ADR-0007** [既約 `.pfdsl/` ディレクトリ規約](0007-pfdsl-directory-convention.md) — 計画・生態系 PFD の置き場を規約化しツールデフォルトとスキルのプロジェクト非依存化を実現する
- **ADR-0008** [グループは存在様式で切る](0008-grouping-by-mode-of-existence.md) — グループの軸を存在様式（住処・寿命・消費局面）とし、生成元プロセスではなく「どこに住むか」でクラスタを決定する
- **ADR-0009** [対話の出力設計](0009-dialogue-output-design.md) — 対話はプロセス（discuss）、出力は3種のシグナルと永続記録への外化、記録までが対話という一体の活動
- **ADR-0010** [変更ガバナンスの経路設計](0010-change-governance-routing.md) — 仕様改訂は issues ゲート必須、スキル・品質ガイドは対話の判断から直結、ガバナンスをエッジ形状で恒久化する
- **ADR-0011** [能力成果物の世代還流](0011-capability-feedback-edges.md) — 能力成果物が自身の生産チェーン上流に入力されるときは前世代スナップショットとして `>>?` で表し、Primary graph の循環を防ぐ
- **ADR-0012** [spec proposals のフォーマットと役割](0012-spec-proposals-format.md) — 4セクション構造・マージ後保持・型対称フィールドと自己完結例の検査点を規約化する
- **ADR-0013** [v0.0.8 依存順序](0013-v008-dependency-order.md) — integrate_multifile は i52 フィーチャードツールチェーン必須、draft_multifile_specs は並行着手可
- **ADR-0014** [ゲート項目の反実仮想テスト](0014-gate-item-counterfactual-test.md) — 条件付きゲート項目は充足を反証可能テストで先判定しデフォルトを「書かない」に倒す、payoff は「PFD なしで判断が違ったか」を引用できる時のみ記録する
- **ADR-0015** [samples は TSV 管理、examples は frontmatter 管理](0015-samples-tsv-examples-frontmatter.md) — 最小構文サンプルは TSV でメタデータ外部管理、realistic domain examples は frontmatter で管理する意図的非対称方針
- **ADR-0016** [pfd-ops install/ 集約](0016-install-paradigm.md) — 配布可能ファイルを install/ に集約し CI で canonical と deployed の identity を強制する
- **ADR-0017** [PFDファイル種別の3分類](0017-pfd-kind-taxonomy.md) — roadmap / workflow / runtime-pipeline を「答える問い」で区別し ecosystem 種別を廃止する
- **ADR-0018** [成果物の門番は双方向](0018-successor-gatekeeper.md) — 手段成果物（仕様・設計・計画・提案）は終端たりえず、出力時点で消費する後続をプレースホルダ登録する
- **ADR-0019** [tags はノード横断ラベル + `tag:` 定義ブロック](0019-process-tags.md) — subroutine 却下の代替。tags を Artifact / Process 両種別の横断ラベルとし、`label` / `description` / `style` を持つ `tag:` 定義ブロックを新設（`tagStyles` 廃止・統合、status は Artifact 専用据え置き）
- **ADR-0020** [仕様制約は具体例トレースで実装前に検証する](0020-spec-constraint-stress-testing.md) — 散文は未定義動作を隠す。境界カテゴリ（粒度・名前・N:M・循環・diamond・部分マップ）の具体例を normative 制約にトレースして判定まで詰め、未定義を spec 決定で潰す。worked example は [サブディレクトリ](0020-spec-stress-testing/boundary-validation-log.md)に保存
- **ADR-0021** [外部ツール専用フィールドは spec に入れない](0021-no-external-only-spec-fields.md) — 値の意味づけが完全に外部ツール依存で pfdsl 単体（グラフ意味論 / 可視化 / `check`）に寄与しないフィールドは不採用。`schedule:`（#220）を not planned とし `index:`（#221）は単体価値ありとして維持
- **ADR-0022** [ファイル書き換え CLI は gofmt 出力モデル](0022-cli-mutation-output-model.md) — ファイルを変える CLI は既定で本体を stdout、`--write` でインプレース＋レポートを stdout、`--check` で CI ドリフト検出、stderr は診断専用。副作用と stdout の中身を分離する
- **ADR-0023** [L4 companion から配布層への昇格経路](0023-l4-promotion-route.md) — companion は配布されないため汎用知見が滞留する。固有名詞を含まないルールを昇格候補として検出する「L4 滞留監査」を retro D 層に追加する
- **ADR-0024** [retro 実行記録と差分計測可能な起動条件](0024-retro-execution-record.md)（Superseded by ADR-0026） — 「たまったら」は基準点なしで判定不能。retro 実行記録を workflow companion に残し、起動条件を前回以降の差分計測形に書き換える
- **ADR-0025** [レビューカタログは抽象レンズを配布、具体例は repo-local instance](0025-review-catalog-lens-example-split.md) — 「各問いは実際に検出された誤りに由来する」具体例は本質的に repo-local。配布層は A/B/C の観点の枠組みのみ、pfdsl 固有の例示・機構は専用 instance ファイルへ降格する ADR-0023 の鏡像
- **ADR-0026** [retro トリガーを done イベント駆動に一本化し実行記録を廃止](0026-retro-trigger-done-event.md) — 実行記録は並列 worktree でコンフリクトする上、閾値条件は導入以来一度も単独発火していない。基準点は既存の done イベント（プロトコル4）に一本化し、記録機構ごと廃止する
- **ADR-0027** [仕様相互参照を安定 ID アンカーに移行する](0027-spec-id-cross-references.md) — 節番号直書きは挿入・並べ替えで崩れる。`[[SPEC_xxx]]` / `[[SPEC_xxx?]]` / `(SPEC_xxx)` の bracket 構文を正式採用し、不透明・永続・欠番許容の ID として renumber 機能なしで運用する
- **ADR-0028** [pfd-ops の plugin 配布移行と skill sync の廃止](0028-plugin-first-pfd-ops-distribution.md) — pfd-ops を plugin に同梱し `install/` 実配置を `/pfd-init` に統合、`pfdsl skill sync` を削除。採用リポの drift 検知は CI 強制からランタイム hash 照合（pfd-ops 発火時）へ移行、ADR-0016 はリポ内運用として存続
