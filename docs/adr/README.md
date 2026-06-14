# ADR — PFD 方法論の設計決定記録

実践ラウンドと設計議論から蒸留した、PFD 方法論の重要な設計決定を記録する。

## 改訂規約

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
