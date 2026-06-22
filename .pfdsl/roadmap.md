# roadmap.md — issue 管理バインディング（roadmap.pfdsl の companion）

この companion を読んだ後、pfd-ops スキルをロードして運用プロトコル（サイクル手順・終端ゲート・知見振り分け手続き等）を確認すること。

`roadmap.pfdsl` は issue 依存構造のみ管理する。issue の一次情報と同期手段はここに書く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## バックエンド

GitHub Issues。規約と採用手順は `.claude/skills/pfd-ops/references/github-issues-backend.md`（L3 プリセット）に従う。

## このリポのインスタンス値

- 一次情報: github.com/takasek/pfdsl/issues
- 同期監査スクリプト: `scripts/audit-issues-flow.mjs`（`--fix` で機械的修復）
- 監査対象: `.pfdsl/roadmap.pfdsl`

## 運用対象の計画 PFD

ワークサイクルの選択ステップが列挙する対象:

- `.pfdsl/roadmap.pfdsl` — オープン issue の依存グラフ

## 自動生成 PR（ワークサイクル選択前に確認）

このリポでは issue close 時に `flow-on-issue-close.yml` が `flow-sync/*` ブランチで flow-sync PR を自動起票する。サイクル開始時に `flow-sync/*` ブランチの PR が open のものがあればマージ先行。それ以外の open PR（機能追加・バグ修正等）は「今回の着手作業に競合するか」を判断軸としてケースバイケースで確認する。

## 終端ゲート追加項目（issue 固有）

**タイミング規約**: issue クローズと flow 確定は **main への PR マージ時**に行う（生態系図 merge_pr: 成果物・進捗・issue 更新はマージで正本になる）。PR 作成時点では行わない — PR がレビューで変わる/却下される可能性があるため。サイクルが PR 作成で終わる場合、下記2項目は「マージ時に実施」と記録して未了のまま閉じてよい。**feature branch への中間 PR では `closes #xxx` を使わない** — feature branch マージ時に issue が閉じられるが、main 未到達のため誤 close になる（2026-06-22 発見: PR #145 が multifile-v008 へマージされ #148 が早期 close された）。

汎用ゲート（status 更新 / check 通過 / 論理単位コミット / PR 集約）に加え、**マージ時に**:

- [ ] 完了した issue をクローズし、進捗・新発見を issue に反映した
- [ ] close 時の降格規則を適用した（定義は L3 reference。専属 process も含めて削除する）
- [ ] `packages/cli` / `packages/vscode-extension` **または CLI が束ねる依存パッケージ**（`@pfdsl/core` / `@pfdsl/graphviz-exporter` / `@pfdsl/metadata-exporter` 等 — `packages/cli/tsup.config.ts` の `noExternal: [/^@pfdsl\//]` が全 `@pfdsl/*` を dist へ同梱する）を変更した場合、npm 公開・Marketplace 公開が必要か確認した（`make release-status` で behind を確認。pending なら次サイクルの先頭タスクとして明記する — 忘れると `published_cli` / `published_extension` が無期限に stale になる）。**判定はパッケージのパスでなく「公開物の挙動が変わるか」で行う**: lib 変更が CLI の出力（`check`/`graph` 等）を変える場合は cli 直接変更と同じ扱い

**worktree 前提**: 新規 worktree では CLI/core が未ビルドのため `check` も snapshot 更新も失敗する。ゲート実行前に `pnpm install && pnpm -r build` を済ませる（2026-06-20 の /pfd-retro で発見: worktree サイクルで未ビルドのまま check が `Missing script` / `MODULE_NOT_FOUND` で失敗）。

**Cycle 計画のパッケージ層明記**: PR body に対象パッケージ層を明記する（→ workflow.pfdsl の develop 参照）。

**worktree での git 操作**: `git commit` など git コマンドは worktree ディレクトリ（`.claude/worktrees/<name>/`）から実行する。main repo パスから実行するとその HEAD ブランチ（main など）にコミットが積まれる（2026-06-21 の #135 サイクルで発見: `cd /Users/m5/works/pfdsl && git commit` が main を汚染し、ブランチ付け替えと reset --hard が必要になった）。

**hotfix PR の明示**: 緊急修正（バグ修正、誤り修正）を PR にのせる場合は description 冒頭に `hotfix:` を明記する。レビュー優先度・マージ判断の依拠になる（2026-06-21 の #135 サイクルで発見: PR に性質が明示されておらず、通常機能追加との区別が見えなかった）。

**issue 起票と roadmap 追加は同時に行う**（→ workflow.pfdsl の file_issues 参照）。

**Cycle 完了後 pfd-retro 実施**: 各 Cycle の PR 作成後、次 Cycle に移行する前に pfd-retro を完了させる。「続けて」で次 Cycle に即移行する場合も、前 Cycle の retro を先に実施してから進む。未実施の場合は延期理由を明示して記録する。（2026-06-21 の Cycle 2/3 で発見: retro なしで2 Cycle 連続進行し、ユーザー指摘まで気付かなかった。retro が終端に無ければ委譲結果の差分検証も省略される）

**worktree での拡張デバッグ**: VSCode 拡張は `make vscode-dev` を **worktree ルートから**実行して開く（拡張フォルダを workspace root として開く窓が立ち、コミット済み `.vscode/launch.json` で F5 が確定動作。`preLaunchTask` が deps+ext を再ビルドして fresh dist を保証）。main repo を開くと worktree の変更でなく stale code をデバッグする。検証は `.pfdsl` を開き **PFDSL: Open Preview to the Side**（Markdown preview と別物）、webview console は `takasek.pfdsl` で絞る（2026-06-22 の /pfd-retro で発見: launch 設定がリポに無く F5 無反応、main repo の拡張/カタログをロードして "cannot open" 混乱、Markdown preview を開いて確認にならず、console 全文ペースト往復が多発。`pnpm install && pnpm -r build` 前提・worktree git cwd 前提と同じ「worktree 前提が暗黙」族）。

「roadmap.pfdsl 変更 → snapshot 陳腐化」は 2026-06-19 の /pfd-retro で発見: PR #110 の flow-sync が roadmap.pfdsl を変更した際にスナップショットが更新されず、#108 として顕在化した。正しい更新コマンドは `-u` フラグ（`--update-snapshots` は vitest 1.x で無効）。

2026-06-20 の /pfd-retro（#127 サイクル）: 公開ゲートの**トリガー条件が狭すぎる**構造欠落を発見。`@pfdsl/core` / `@pfdsl/graphviz-exporter` は CLI に `noExternal` で同梱されるため、これら lib のみを変更した PR（#131）でも CLI の `graph` 出力（process tags 描画）が変わるが、旧ゲートは `packages/cli` パス直変更のみを契機としていた。判定軸を「パッケージのパス」から「公開物の挙動が変わるか」へ修正（#72/#15/#17 の impl_flow 取りこぼしと同型の死角）。

2026-06-20 の /pfd-retro: 上記ゲートは**人間ゲートのため bot PR では発火し得ない**という構造欠落（#120）を発見。`flow-on-issue-close.yml` の bot PR は人間を経由せず、#89 クローズ同期（#116）で snapshot を stale 化させた。恒久解消として A: flow-sync に snapshot 自動再生成（`add-paths` に snapshot 追加）、B: PR test gate `test.yml`（`pnpm -r build && test`）を追加。本ゲート項目は人手編集のローカル事前チェックに退き、bot 経路と取りこぼしは CI が backstop する。

2026-06-20 の /pfd-retro（#130 サイクル）: `skill_gen`（roadmap.pfdsl, done, criteria「make gen-skill 差分なし」）の invariant が #83(06-15) 以降 main で**偽**だった構造欠落を発見。`make gen-skill` の identity check はローカルのみで CI 強制が無く、#83 が gen-skill 未実行で `.claude/skills/pfdsl/CLAUDE.md` を追加したため素通りした（skill dirs 非対称で `diff -rq` が恒久失敗）。snapshot 陳腐化サーガ（#108/#116→`test.yml`）と同型の死角。#130 で `diff -rq -x CLAUDE.md`（非対称は意図的: ローカル稼働コピー vs `gh skill install` 配布コピー）に修正、#134 で `check-gen-skill.yml`（全 PR・path filter なし — #131 の狭すぎトリガーの轍を踏まない）を追加し恒久 backstop 化。

これら（npm 公開・snapshot 更新の各項目）は2026-06-16 の /pfd-retro で発見: #72/#74・#15/#77・#17/#81 の3PRが連続して impl_flow を更新せず、`@pfdsl/cli` の npm 公開も #74 以降止まっていた（main の package.json も npm 上も 0.0.4 のまま）。ルール（CLAUDE.md）はあったがゲートに写っていなかった。

2026-06-22 の /pfd-retro（PR #153）: `install/` 同期漏れを発見。`issues-flow-audit.mjs` / `flow-on-issue-close.yml` 変更・`normalize-pfdsl.mjs` 新規追加後、`check-pfd-ops-install-sync.yml` が弾くまで `install/` へのコピーを忘れた（2コミット追加でリカバリ）。`snapshot 更新` と同型の「CI が backstop → PR 後発覚」パターン。ただし `install/` sync は CI workflow（`check-pfd-ops-install-sync.yml`）が対象ファイルを動的スキャンして全 PR で強制しており、companion にファイル列挙ゲートを追加するとドリフトする。companion gate 不要 — workflow が gate。
