---
name: spec-stress-test
description: |
  Use when hardening a normative spec change (docs/spec/spec.md) before or
  after integration — boundary-example stress-testing per ADR-0020, plus the
  agent write-probe protocol (subagents given only the spec, graded against
  the real checker). Invoke when adding/changing constraints, when a spec
  section feels "complete but untested", or when asked to review spec
  usability. Records go to docs/adr/0020-spec-stress-testing/.
---

# 仕様 stress-test（手トレース + agent 実書きプローブ）

spec の normative な変更は、散文としては完結して見えても未定義動作と誤読誘発点を含む。
本スキルは2フェーズでそれを検出する。フェーズ1（ADR-0020）が**規則の穴**を、
フェーズ2（agent プローブ）が**読者の躓き**を検出する — 検出対象が異なるため代替にならず、
大きな変更では両方やる。小さな変更（単一制約節の追記）はフェーズ1のみでよい。

## フェーズ1: 具体例の手トレース（ADR-0020 Decision）

1. 対象の normative 制約ごとに、境界カテゴリを機械的に列挙して具体例（実 `.pfdsl`）を作る:
   粒度不一致 / 名前不一致 / N:M / 自己参照 / 多段 / diamond / 部分マップ / **feedback との交差** / 孤立 node-decl / frontmatter-only 宣言 / 空集合・空ファイル / 他フィールドとの併用（basePath・extends 等の直交確認）
2. 各例を制約に手トレースし、**pass / error / 未定義** まで詰める
3. checker が実装済みなら CLI 実測で突合する（`node packages/cli/dist/cli.js check`。
   ビルドは `pnpm install && pnpm -r build`）。**spec の字義と実測の食い違いはそれ自体が finding**
4. 未定義に落ちた例は spec の明示決定で潰す（既定動作を残さない）

## フェーズ2: agent 実書きプローブ

spec だけを読ませた subagent を被験者にし、実 CLI を正解器として採点する。

**プロトコル（固定）**:

- 被験者: sonnet subagent（general-purpose）。実験ごとに独立コンテキストで起動
- 入力制限を prompt に明記: 「読んでよいのは `docs/spec/spec.md` のみ。
  docs/adr・docs/samples・packages・skills・.pfdsl の参照禁止。CLI・テストの実行禁止」
- 出力: `.pfdsl` ファイル + notes.md（参照節番号・境界の手トレース・**曖昧と感じた点・確信度（高/中/低）の自己申告**）
- 採点: 実 CLI で check。**正誤だけでなく「どう正解したか」を読む** — 回避行動（情報を捨てて通す）や類推による正答は、pass でも spec の欠陥の証拠

**実験3型**（コスト昇順。1回のレビューは「オラクル1 + 罠入り実書き1」が最小構成）:

1. **オラクル型**: 合否既知（CLI で事前確定）の入力ペア5件程度の pass/error を予測させる。
   確信度「中/低」が付いた箇所がそのまま曖昧箇所の座標になる — 最も費用対効果が高い
2. **罠入り実書き型**: 正攻法が仕様に明示されていない分岐点（例: 子の副産物 terminal、粒度差、変更禁止の共有子フロー）を仕込んだ作文課題。誤った回避（禁止構文への迂回・対象の改変）に走るかを観る
3. **意味保存型**: フラットな図を制約対象機能で書き換えさせ（例: subflow 化）、check 通過だけでなく**元の意味が保存されたか**を照合する。「通るが情報が落ちる」を検出

コスト目安: 3体で約20万 token・各2〜4分（2026-07 実測）。

**モデル勾配プローブ**（オラクル型の拡張）: 同一のオラクル課題を能力の異なるモデル（haiku / sonnet 等）で実行し、正答率と確信度分布を「仕様がどのレベルの精読者まで耐えるか」の指標にする。
確信度全問「高」で全問正解なら、その仕様節は弱いモデルにも安全に委譲できる（ハーネスとしての品質保証）。
変数は一度に1つ — 仕様改訂の効果測定は同一モデルで改訂前後の spec を比較し、モデル勾配の測定は同一 spec でモデルだけ変える。
実測（2026-07-04）: v0.0.12 の subflow 境界オラクル5問を haiku が全問正解・全問確信度「高」（sonnet × v0.0.11 は全問正解だが2問「中」— 記録は `docs/adr/0020-spec-stress-testing/subflow-agent-probe.md` 実験D）。

## 成果物の配置と還流

- 例・トレース・実験記録は `docs/adr/0020-spec-stress-testing/` に恒久保存し、ADR-0020 本文の References に1行追記する（先例: `boundary-validation-log.md`・`spec-v0011-review.md`・`subflow-agent-probe.md` — プロンプト全文と記録形式はこれらを踏襲）
- findings の振り分け（pfd-ops 経路）: 仕様欠陥・機械化可能な検査は issue 起票（`flow:managed` / `flow:exempt` の判定は L3 reference）。レビュー観点として一般化できるものは `docs/review-prompts.md` の C 系に追記（追記後 `make gen-skill`）
- 意図的に invalid な例を fenced ```pfdsl ブロックで残す場合、`docs/spec/` 配下では直前行に `<!-- pfdsl-nocheck -->` が必要（check-doc-examples の対象。docs/adr は対象外）

## 被験者プロンプトのテンプレート

```text
あなたは PFDSL を初めて使う開発者という設定の被験者です。以下の制約を厳守してください。
【読んでよいもの】/path/to/docs/spec/spec.md のみ。
【禁止】リポジトリ内の他のファイルを読むこと。pfdsl CLI やテストの実行。

タスク: <実験3型のいずれか。罠と期待挙動は出題者だけが知る>

成果物: <出力先パス>/*.pfdsl と notes.md（従った節番号・境界の手トレース・
仕様が曖昧と感じた点・checker を通る確信度 高/中/低）
```
