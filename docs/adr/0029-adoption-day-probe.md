# ADR-0029: 配布層の欠陥は使い捨て環境での採用初日再現で検出する

- Status: Accepted
- Date: 2026-07-10

## Context

2026-07-06 の構造レビュー（#351）で検出した配布系バグ — CLAUDE.md 混入（#339）・上流専用指示（#340）・sync 上書き破壊（#341）・日本語 CLI 出力（#345）— は、いずれも「新規採用リポが採用初日に踏む」型だった。いずれも机上レビューでなく、実際に採用者の立場で手順を辿って初めて見つかった。

ADR-0020 は DSL 仕様（spec.md の normative な制約）に対して同種の検出手法（具体例トレース・agent オラクルプローブ）を確立した。しかし pfd-ops（フレームワーク層）と plugin 配布物（配布層）には相当物がなく、配布物の欠陥を組織的に検出する手段が机上レビューしかなかった。

takasek/common への初適用（2026-07-03、`docs/pfd_payoff_log.md`）は roadmap 構築が主目的で、配布経路の検証としては部分的だった。

ADR-0028（#404）で pfd-ops の配布経路が `pfdsl skill sync` CLI コマンドから marketplace plugin 同梱 + `/pfd-init` 実配置へ移行した後、この新しい配布経路自体を検証する必要があった（#352）。

## Decision

**使い捨て環境（tmp dir + `git init`）に対して「採用初日」を実際に辿り、配布物を検証する** — 机上レビューでなく、以下4観点を実地で確認する:

1. **同梱物の妥当性**: `claude plugin validate` / `claude plugin details` で plugin manifest の構造整合を確認し、配布ツリーを `grep` で自己参照漏れ（repo-local 専用パスのハードコード等）・意図しない固有情報混入がないか検査する
2. **ガイダンスの実行可能性**: `/pfd-init` が案内する次アクションを字義通り実行し、詰まる箇所を記録する
3. **agent 到達性**: 配布物だけを読ませた fresh agent に採用手順（plugin install → `/pfd-init` → 初回 `/pfd-cycle`）を実行させ、誤読・詰まり箇所を記録する（ADR-0020 の agent オラクルプローブと同じ「読者がどこで誤読するか」の検出。ただし Limitations 参照 — 現行ツールでは完全な plugin-only 環境を模擬できない）
4. **冪等性**: 配置スクリプト（`check-install-sync.mjs --deploy` 等）を同一環境で複数回実行し、無変更時の再実行・ローカル編集の保護・孤児ファイルの検出/削除が設計通り動くか確認する

これは ADR-0020 の PFD 図に対する A/B レビュープロンプトの、**配布物自身**版に当たる。spec は「書くときのルール」と「問い詰める問い」を持ち、図も同様（`docs/review-perspectives.md`）だが、配布物（plugin として実際にインストールされた成果物）も同じ構造で問い詰める必要がある。

## Rationale

1. **散文は動作を保証しない**: `.md` の説明文がどれほど整合していても、実際にコマンドを打ち・パスを解決させるまで欠陥は現れない（#339-#345 は全てレビューでなく実採用で発覚）
2. **実採用前が安い**: 配布後に外部採用者が踏めば信頼を損なう。使い捨て環境なら何度でも安全に再現できる
3. **fresh agent は読者シミュレーション**: 作者自身のセッションには repo の文脈・記憶が残っており、真に「plugin だけを渡された第三者」の視点を再現できない。fresh agent プローブはこのギャップを埋める（ただし Limitations に記す制約あり）

## Consequences

- 2026-07-10 実施（#352）で1件の配布バグを検出: `plugin/pfdsl/skills/pfd-ops/references/scaffold/roadmap.md` が GitHub Issues backend の参照パスを repo-local 専用（`.claude/skills/...`）でハードコードしており、plugin-only 導入で解決不能（他の参照箇所が持つ `${CLAUDE_PLUGIN_ROOT}` 二重解決規則を欠く）。#417 で修正 issue 起票済み
- 検証に用いた実行記録を `0029-adoption-day-probe/` に保存した
- **Limitations（今回判明した手法自体の制約）**: `Agent` ツールで起動した fresh subagent は、cwd を明示的に `cd` しても skill 本体の解決先が呼び出し元セッションの worktree に紐づいたままだった（`Base directory` が呼び出し元の `.claude/skills/...` を指した）。このため観点3（agent 到達性）は「plugin 単体导入のみを見た読者」を完全には再現できず、`${CLAUDE_PLUGIN_ROOT}` 未置換時の挙動は文字列比較でしか確認できなかった。次回実施時は次のいずれかで代替する:
  - 別マシン・コンテナ・CI ランナー等、呼び出し元セッションの `.claude/skills/` が存在しない環境で `claude` CLI を独立起動する
  - `claude --plugin-dir <path>` で当該 plugin のみを読み込んだ隔離セッションを使う（ただし本 ADR 執筆時点で `--plugin-dir` は marketplace 経由 install と解決規則が同一か未検証）
- 観点1・4（同梱物妥当性・冪等性）は fresh agent を要さず本セッション内で完全に検証できた — 今後の再実施もこの2観点は同様に低コストで回せる

## References

- ADR-0020（DSL 仕様の stress-test 手法。本 ADR はその配布層版）
- ADR-0028（plugin 配布移行 — 本 ADR が検証した配布経路そのもの）
- `docs/adr/0029-adoption-day-probe/execution-log.md` — 実行記録（コマンド・出力・findings 全量）
- #352（本 ADR の起票元 issue）・#417（検出した配布バグの修正 issue）
- #339 / #340 / #341 / #345（本手法の動機となった過去の配布バグ）
