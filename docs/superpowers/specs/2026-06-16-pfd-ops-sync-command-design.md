# pfd-ops sync コマンド 設計

## 背景・問題

pfd-ops スキルは複数リポへ配布される（ADR-0015/0016, PR #56/#62）。配布可能ファイルは `.claude/skills/pfd-ops/install/` に集約され、採用リポは `cp -r install/. .` で展開する。

だが現状、外部採用リポが pfd-ops を**最新状態に保つ手段がない**。スキル本体（`SKILL.md` / `references/`）の取得元は「pfdsl リポを手動 clone して cp」が暗黙の前提で、手順書にも書かれていない。`check-pfd-ops-sync.yml` は pfdsl 開発リポ内の drift を検出するのみで、外部リポの最新化には寄与しない。

ユーザー要望: **外部プロジェクトで難しいことを考えず一発で pfd-ops を最新状態にできる仕組み**。

`@pfdsl/cli`（`@pfdsl/cli@0.0.4`）は既に npm 公開済み。これに相乗りして配布・更新を CLI コマンド化する。

## カスタマイズ次元の整理（設計の核心）

採用リポは pfd-ops の各層を異なる度合いでカスタムする。無条件の最新上書きはこの分岐を壊す。

- **次元A — L3 採用可否**: GitHub Issues バックエンド（`install/` 配下の workflows・audit スクリプト）を採用するか。非採用リポに workflow を無条件展開すると、無関係な CI が走り出す
- **次元B — L3 カスタム度**: 採用リポがラベル名・ブランチ名・通知先などを自リポ事情で改変している場合、最新上書きでそのカスタムが消える
- **次元C — L2 companion 整合**: `SKILL.md`（配布物）が L2 ディスパッチ規約を変えると、採用リポの `.md` companion（リポ固有）の前提とズレうる

ADR-0016 の identity 強制（canonical = deployed を CI で強制）は **pfdsl 開発リポ内の dogfooding 規律**であり、その目的は「配布物を書く側が drift を起こさないこと」。外部採用リポの目的は逆 — canonical を受け取って自リポ事情に合わせること。よって**外部リポに identity 強制は持ち込まず、カスタム余地を残す**。

## アーキテクチャ

### 配布: npm 同梱

`@pfdsl/cli` のビルド時、リポルートの `.claude/skills/pfd-ops/` ツリーを `packages/cli/dist/skills/pfd-ops/` へコピーする（postbuild）。`package.json` の `files: ["dist"]` のまま npm publish に自動同梱される。CLI バージョン = 同梱スキルバージョンと単純化し、バージョン比較ロジックは持たず npm registry に委ねる。

### 更新: `pfdsl skill sync pfd-ops`

外部プロジェクトのルートで実行する1コマンド:

```sh
npx @pfdsl/cli@latest skill sync pfd-ops
```

`@latest` により常に最新 CLI 同梱版を取得・展開。冪等（何度叩いても同じ結果）。install/update を分けず1コマンドに統合。

コマンド構造は `skill sync <name>` で将来の別スキルにも拡張可能だが、**今回は pfd-ops のみ実装**（YAGNI）。

## sync の責務境界（3分類）

| 対象 | sync の扱い |
|---|---|
| `.claude/skills/pfd-ops/SKILL.md` + `references/*`（汎用層 L1+L2+L3規約） | **無条件上書き**。事前確認なし。安全網は Git（差分は `git diff` で事後確認） |
| `install/` 配下（L3 機構: workflows, scripts） | **採用済みなら無条件上書き、未採用なら不触**（下記「採用済み判定」） |
| `.pfdsl/*.md` companion + `.pfdsl/*.pfdsl` グラフ本体（L4 リポ固有: roadmap.pfdsl/md, ecosystem.pfdsl/md） | **既存なら不触、欠落なら雛形生成（scaffold）**。中身は書き換えない（下記「scaffold」） |

「汎用層は上書き / リポ固有層は不触」の二分法では install/ を捌けない（機構は汎用 L3 だが採用可否・カスタム可否はリポ固有）。この中間的性質を、ファイルの**出自**ではなく**実行時状態（採用済みか）**で吸収する。

### 採用済み判定（install/ の扱い）

- **判定基準**: `install/` 由来の deployed ファイルがリポルートに一つでも存在すれば「L3 採用済み」とみなす。採用は `cp -r install/. .` の all-or-nothing 前提なので、ディレクトリ単位で判定する
- **採用済み**: `install/` 配下を相対パス保持で全ファイル上書き展開。新規追加された L3 ファイル（将来の workflow 等）も展開され最新化される。カスタム差分は上書きされるが Git が安全網（事後 `git diff`）。これは「外部リポに identity 強制を敷かず、カスタムは Git 履歴で追える」方針の帰結
- **未採用**: install/ 配下を一切展開しない。「GitHub Issues バックエンドを採用する場合は `cp -r .claude/skills/pfd-ops/install/. .` を実行」と案内メッセージのみ表示。初回採用は sync の責務外（別操作 / 手動）

### gh ラベル確認

- `gh` 未検出 → 「`flow:managed` / `flow:exempt` ラベルは手動作成」と案内し継続（エラーにしない）
- `gh` 検出 → 不足ラベルを提示し `[y/N]` で一括作成確認。`--yes` で非対話・自動 yes（CI/自動化向け）
- ラベル作成は L3 採用済みリポでのみ意味を持つため、採用済み判定に従属させる

### scaffold（テンプレート配置 + PFD セットアップ案内）

sync は雛形ファイルを `.pfdsl/` に自動コピーしない。テンプレートは
`.claude/skills/pfd-ops/references/scaffold/` に配置されており、ユーザーが
必要な種別のみを `/pfd-ecosystem` スキル経由でオンデマンドにコピーする。

- **テンプレート対象**: `roadmap.pfdsl` / `roadmap.md` / `workflow.pfdsl` / `workflow.md` / `runtime-pipeline.pfdsl` / `runtime-pipeline.md`（ADR-0017 の3種別すべて）
- **自動コピーなし**: 3種別全てがどのプロジェクトでも必要とは限らないため、sync は自動コピーを行わない
- **オンデマンド採用**: `/pfd-ecosystem` スキルが問診で必要な種別を特定し、該当テンプレートのみをコピーする

sync は `.pfdsl/` に `.pfdsl` ファイルが1つもない場合、**`/pfd-ecosystem` スキルの起動を促すメッセージを stdout に表示**する。

- **メッセージのソース**: `pfdslDirGuidance()` がハードコード文字列を返す（ファイル読み込みなし）
- **表示タイミング**: `.pfdsl/` に `.pfdsl` ファイルが存在しない場合のみ表示。1つでも存在すれば表示しない（ノイズ回避）

## スコープ外（YAGNI）

- **初回採用フロー**: 未採用リポへの install/ 初回展開は sync の責務外。`cp -r` 案内のみ
- **他バックエンドプリセット**（Jira 等）: 作らない
- **diff 提示 / dry-run / 3-way merge**: 持たない。Git が安全網（ユーザー決定: 汎用層・install/ 双方で事前確認不要）
- **L4 ファイル中身の整合検証・自動修正**: scaffold は欠落の雛形生成のみ。既存ファイルの中身検証・育成は sync の責務外（retro / ecosystem 構築プロンプト経由の人間+Claude 作業へ）
- **PFD セット自動生成**: sync はテンプレートを配置し `/pfd-ecosystem` 起動を案内するだけ。必要な種別の選択・グラフ構築は `/pfd-ecosystem` スキル経由で人間+Claude が担う（sync は CLI であり LLM を持たない）
- **バージョン比較ロジック**: npm registry に委ねる

## 検証

- 思考実験 — L3 非採用リポ（install/ deployed ファイルなし）で sync を実行し、install/ が展開されず汎用層のみ最新化されること
- 思考実験 — L3 採用済みリポで sync を実行し、install/ 全体が上書きされ、新規 L3 ファイルも展開されること
- 思考実験 — `.pfdsl/` に `.pfdsl` ファイルが存在しないリポで sync が `/pfd-ecosystem` 起動案内を stdout 表示すること
- 思考実験 — `.pfdsl/` に `.pfdsl` ファイルが存在するリポで sync が案内を表示しないこと（ノイズ回避）
- npm 同梱 — `npm pack` でビルド成果物に `dist/skills/pfd-ops/` が含まれること
- `npx @pfdsl/cli@latest skill sync pfd-ops` を実 CLI で叩き、別ディレクトリで展開・scaffold 結果を確認
- TDD: sync のコピー対象解決・採用済み判定・L4 欠落検出/scaffold・プロンプト表示条件を単体テストで駆動

## implementation_flow への反映（dogfood）

sync 機構は CLI の新サブコマンド = ツールチェーン実装物。`docs/pfdsl_implementation_flow.pfdsl` に新規 artifact/process として登録する（consumer = 外部プロジェクトでの pfd-ops 運用）。`cli_tool` を入力とする process として追加。実装計画でグラフ追記内容を確定する。

## 未解決の論点（実装計画で詰める）

- postbuild のコピー手段（tsup hook / 別 npm script / シェル）。`packages/cli` のビルド構成を見て決める
- sync のコピー対象解決を「dist 同梱ツリーの walk」で動的に行うか、明示マニフェストを持つか。install/ の drift 検出（ADR-0016）と整合する形を選ぶ
- 採用済み判定で参照する「install/ 由来ファイルのリスト」の取得元（同梱ツリーから導出 vs ハードコード）
- scaffold 雛形（4種の最小 `.pfdsl`/`.md`）と ecosystem 構築プロンプトの配置場所。`references/` 配下に置き dist 同梱経路に乗せる想定。雛形と既存の本番 `.pfdsl`（このリポの roadmap/ecosystem）の drift をどう防ぐか（雛形は意図的に最小なので identity 強制はしない方向）
