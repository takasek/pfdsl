# ADR-0028: pfd-ops の plugin 配布移行と skill sync の廃止

- Status: Accepted
- Date: 2026-07-10

## Context

#366（PR #399）で pfdsl / pfd-ecosystem / pfd-retro スキルと pfd-* コマンド・pfd-lens agent を Claude Code plugin として marketplace 配布に移行した。
pfd-ops は意図的に除外した — repo 側自動化（`install/` 配下の GitHub Actions workflow・監査スクリプト）を plugin 機構では対象プロジェクトのリポジトリに書き込めないため。
その結果、pfd-ops の配布だけが `pfdsl skill sync`（CLI コマンド）に残り、配布経路が plugin と CLI の二重になった。
issue #404 が統合と skill sync 廃止の設計論点5件を整理した。

## Decision

論点ごとの決定:

1. **`${CLAUDE_PLUGIN_ROOT}` の置換可否**: slash command markdown 本文でも置換されることを実地検証で確認した（2026-07-10、probe plugin を `claude --plugin-dir` で起動し、command 本文に埋めたリテラルが解決済みパス `ROOT=/tmp/probe-plugin` で返った）。
   SKILL.md 本文での置換は公式ドキュメントで確認済み。
   これにより plugin 内リソース（scaffold・install/・スクリプト）への参照は SKILL.md 本文の `${CLAUDE_PLUGIN_ROOT}` 経由で解決できる。
   repo-local 読み込み（pfdsl リポ自身等、plugin 外で SKILL.md を読む場合）では置換されずリテラルのまま残るため、SKILL.md 側は「リテラルのままなら `.claude/skills/pfd-ops/` を使う」というフォールバックを明記する。
2. **採用リポの canonical コピーと drift 検知**: 採用リポは canonical `install/` コピー（`.claude/skills/pfd-ops/install/`）を持たない。
   採用リポ向けの CI 強制 identity（`check-pfd-ops-sync.yml` の配布）を、plugin 同梱 canonical との hash 照合ランタイムセルフチェック（`scripts/check-install-sync.mjs`、pfd-ops 発火時に実行）へ置き換える。
   issue #404 の当初案は「hash 値を reference ファイルに記録し CI で同期強制する」だったが、canonical ファイル本体が plugin に同梱される（`/pfd-init` の実配置コピー元として必要）ため記録 hash は冗長 — 同梱 canonical と deployed の直接 hash 比較に簡素化する。
   canonical（`.claude/skills/pfd-ops/`）と plugin 同梱物の同期は既存の `check-gen-plugin.yml` identity ゲートが担う。
   pfdsl リポ自体は canonical-in-repo + `check-pfd-ops-sync.yml` を維持する（ADR-0016 はこのリポ内の運用として存続し、採用リポへの配布経路のみ本 ADR が改訂する）。
3. **adopt/refresh コマンド設計**: `/pfd-init` に統合する（新コマンドは作らない）。
   既導入検出で adopt / refresh を自動分岐する。
   ローカル編集保護: deployed ファイルの hash が同梱 canonical と不一致の場合、`--force` なしでは上書きしない（skill sync の `detectLocalEdits` 相当）。
4. **バージョン skew の trade-off**: plugin はユーザー単位インストールのため、チームメンバー・headless agent 間でスキルバージョンがずれ得る（skill sync はリポ内コミットで全員同一版だった）。
   これを許容する。
   緩和策として、ランタイムチェックが deployed と同梱 canonical の乖離を警告し、`--upstream` で上流（GitHub main の plugin.json version）との差もベストエフォートで警告する（warning レベル、ネットワーク失敗時は沈黙）。
   リポ内配布オプションは残さない。
5. **既導入リポの移行**: 外部の既導入ユーザーは存在しないため、移行手順・移行ツールは作らない。

段階構成: A（plugin の参照パス修正等 — PR #399 で完了）/ B（pfd-ops の plugin 同梱 + `/pfd-init` の install/ 実配置）/ C（`pfdsl skill sync` の削除）。
B・C は同一変更束で実施する。

## Consequences

- `pfdsl skill sync` CLI コマンドは削除される（破壊的変更）。
  npm パッケージへの skills / commands / agents 同梱（tsup onSuccess でのコピー）も不要になり削除する。
- 採用フローは「`/plugin install pfdsl` → `/pfd-init`（scaffold コピー + install/ 実配置）」に一本化される。
- `check-pfd-ops-sync.yml` は `install/` から外れ、採用リポへ配布されない。
  pfdsl リポ自身の CI としては存続する。
- drift 検知は CI 強制（push/PR 時に必ず走る）からランタイムチェック（pfd-ops 発火時のみ）に弱まる — pfd-ops を使わないセッションでは検知されない。
  採用リポが canonical を持たない前提では CI 強制すべき対象自体が縮小するため許容する（issue #404 論点2の合意）。
  警告止まりでブロックしない点は、pfd-ops SKILL.md に「警告が出たら対応する」旨を明記して緩和する。

## References

- issue #404（設計論点の整理と独立レビュー結論）
- ADR-0016（install/ 集約 — 配布経路を本 ADR が改訂、リポ内運用は存続）
- PR #399（段階 A: marketplace plugin 配布）
- `scripts/gen-plugin.mjs` — plugin 組み立て
- `.claude/skills/pfd-ops/scripts/check-install-sync.mjs` — ランタイムセルフチェック
