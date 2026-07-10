# 採用初日プローブ 実行記録（2026-07-10、#352）

ADR-0029 の手法を初回実施した記録。手順は「再実行可能なプローブ手順」節に一般化して残す。

## 環境

- worktree: `.claude/worktrees/probe-adoption-day`（branch `i352/adoption-probe`）
- テスト対象リポ: `/tmp/pfdsl-adoption-test-<timestamp>`（`git init` のみの空リポ、README + スタブファイル1本を追加）
- 対象バージョン: plugin `pfdsl@pfdsl` v0.0.19（`claude plugin marketplace add takasek/pfdsl` + `claude plugin install pfdsl@pfdsl` で user scope に実導入）

## 観点1: 同梱物の妥当性

```
claude plugin validate plugin/pfdsl
→ ✔ Validation passed

claude --plugin-dir plugin/pfdsl plugin details pfdsl
→ Skills (7) pfd-cycle, pfd-ecosystem, pfd-init, pfd-ops, pfd-retro, pfd-retro, pfdsl
```

`pfd-retro` が Skills 一覧に2回出現（skill `pfd-retro/` とコマンド `commands/pfd-retro.md` が同名のため、`claude plugin details` が両者を区別せず "Skills" ラベル下に列挙する）。これは pfdsl 側の意図的設計（コマンドが同名スキルを起動するラッパー）に対する `claude` CLI 側の表示上の癖であり、pfdsl の配布内容自体の欠陥ではないと判断。pfdsl 側の対応は不要と結論。

`grep -rn "takasek/pfdsl" plugin/pfdsl` で upstream 参照を全件確認 — 全て「上流リポを指す」旨の自己申告付きで、意図した attribution。CLAUDE.md 混入なし（`find plugin -iname CLAUDE.md` 空）。

**Finding A（確定バグ、#417 起票済み）**: `plugin/pfdsl/skills/pfd-ops/references/scaffold/roadmap.md:7` が GitHub Issues backend の参照先を `.claude/skills/pfd-ops/references/github-issues-backend.md` に固定。他の参照箇所が持つ `${CLAUDE_PLUGIN_ROOT}` 二重解決規則を欠き、plugin-only 導入で死んだパスになる。

## 観点2・3: ガイダンス実行可能性・agent 到達性

`general-purpose` subagent を1体起動し、「plugin 導入済みの前提で widget-tracker という架空プロジェクトに `/pfd-init` を実行する」ペルソナで実施させた。

結果: 最終的に `.pfdsl/roadmap.pfdsl` `.pfdsl/runtime-pipeline.pfdsl` と companion 2本を生成し、`npx @pfdsl/cli check` を通過させるところまで到達した（詰まりを克服して完遂）。

途中で判明した制約（ADR-0029 Limitations 節に記載）: `Skill` ツールで `pfd-ecosystem` / `pfdsl` を invoke した際、報告された `Base directory` が呼び出し元セッションの `.claude/skills/...`（このリポの dev checkout）を指しており、plugin cache 配下でも対象リポ配下でもなかった。`cd` によるカレントディレクトリ変更はこの解決に影響しなかった。このため「plugin だけを見た読者」を完全には再現できておらず、`${CLAUDE_PLUGIN_ROOT}` 未置換時の実際の動作は本セッション内では確認できなかった（文字列としては常に未置換のまま出力された）。

subagent が報告したその他の観察（環境制約に起因しない、内容面の所見）:

- kind-taxonomy.md の問診は「roadmap/workflow/pipeline のどれを採用するか」の判定基準を持つが、「(全種別についてまだ時期尚早」なプロジェクト規模への言及がない
- 生成される `.pfdsl/` 一式（roadmap + runtime-pipeline + bindings 2本）は、1ファイルのスタブしかない prototype には各種セクションの大半が「該当なし」になり、比重として重い

## 観点4: 冪等性

テストリポで `check-install-sync.mjs --deploy` を実行:

1. 初回 `--deploy`: 5ファイルを配置（`.github/workflows/flow-on-issue-close.yml` 等）、正常
2. 無変更のまま2回目 `--deploy`: 同じ5ファイルが再度 "Copied:" と表示される。実害はないが「差分なし」を示す出力ではなく、UX 上やや紛らわしい（severity 低、issue 化は見送り — hotfix 運用の閾値未満と判断）
3. 1ファイルをローカル編集後 `--deploy`: 該当ファイルのみ `Skipped (locally modified; re-run with --force to overwrite)` — 設計通り
4. 孤児検出: canonical 側の一時コピーから1ファイルを除去し `--target` で向けて実行 → `orphaned: scripts/normalize-pfdsl.mjs` を正しく検出、`--deploy` で `Removed (no longer part of canonical install/)` と削除された。マニフェスト方式（`.claude/pfd-ops-install-manifest.json`、このツールが過去に配置したファイルのみを追跡）は「ユーザーが手動で置いた無関係ファイル」を孤児と誤認しない設計であることも確認した（最初の孤児テストの試行錯誤で判明）

## findings 一覧（振り分け先）

| finding | 種別 | 振り分け先 |
|---|---|---|
| scaffold roadmap.md の repo-local 専用パス | 確定バグ | #417（flow:exempt、roadmap 非登録） |
| `--deploy` 差分なし時の "Copied:" 表示 | UX 軽微・severity 低 | 本記録に留め issue 化見送り |
| `claude plugin details` の Skills 重複表示 | claude CLI 側の表示癖、pfdsl 非該当 | 対応不要と結論、本記録のみ |
| fresh agent 検証の環境制約（skill 解決が呼び出し元 worktree に紐づく） | プローブ手法自体の限界 | ADR-0029 Limitations 節 |

## 後片付け

- `/tmp/pfdsl-adoption-test-*` テストリポ: 削除済み
- `claude plugin marketplace remove pfdsl` / `claude plugin uninstall pfdsl@pfdsl`: 本プローブ検証目的で追加した user scope 導入のため削除済み
