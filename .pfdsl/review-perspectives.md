# review-perspectives.md — pfdsl instance

配布レンズ `docs/review-perspectives.md` の観点を pfdsl の PFD・仕様に適用した実例。repo-local に蓄積する。

## A. 図 vs 現実

- **エッジ実在性**: README はサンプル描画物から書かれず、リンクのみ
- **駆動源**: issue 起票の駆動源は対話で、レビュー知見は `>>?`
- **名前の一般化水準**: `cli_tool` → 実際は `packages/` 全体 = toolchain
- **偽の不変性**: 仕様書は実装知見の issue 経由で改訂される → maintain プロセスが要る
- **入力充足**: 修正開発に `base_code`・PoC が欠落、ADR 起草に参照図が欠落 → ID 捏造が発生
- **status 単調性**: `check` の W003 が機械検出する
- **同種対称性**: `published_cli` が持つ全消費エッジを `published_libraries` も持つか。`quality_guide` 新設時に `findings.criteria` の反映先列挙への追随が漏れた（読み直しで検出、2026-07-08）

## B. 粒度・型

- **万能成果物**: `dialogue` → お題・提案・判断の3型に分割
- **プロセス実在性（双方向）**: `payoff_log` 追記は対話の終端動作。逆に、ADR 起草は突合検証を固有入力に持つと委譲失敗で判明
- **自動化は description**: 自動 publish は `publish_cli` の description、close 時 flow 同期は `map_deps` の description に記す
- **並列主張への挑戦**: ADR-0004 基準3

## C. 仕様・制約（対象 `docs/spec/spec.md`）

- **対称性の欠け**: terminal は feedback 消費を除外、open input は除外なし → 階層跨ぎ feedback 表現不能。extends の絶対パス禁止は §16 にあり subflow 側に無い
- **字義 vs 実装**: 孤立 node-decl は字義では境界不一致 error、実装は無視
- **能力の否定記述**: 「`check` は循環を検出しない」が V010 実装後も skill 本文と runtime-pipeline companion の2箇所に残存（2026-07-08 検出・修正）
- **同名異義**: 「terminal artifact」が §3.3 / subflow 境界 / --audit で三様
- **三点登記〔機構〕**: §15.X・§16・実装コードの3点対称登記。二重割当（V025 が group 循環と subflow 境界の両方に発行）を検出
- **stale 前方参照〔機構〕**: `[[SPEC_xxx?]]` と `(SPEC_xxx)` の id 一致を `check-forward-ref-markers.mjs` が検出（#326）
- **由来**: ADR-0020・`docs/adr/0020-spec-stress-testing/`。実行手順は `/spec-stress-test`
