# GitHub Issues バックエンド（pfd-ops プリセット）

PFD の作業項目を GitHub Issues で管理する流儀。pfdsl 固有ではなく、採用したいリポが選べる再利用可能パターン。採用リポは `roadmap.md` でこのプリセットを指す。

## 規約

- **一次情報**: GitHub issue 本体。`roadmap.pfdsl` は依存構造のみ管理する
- **id 規約**: issue に対応する作業の process id は `iN_` prefix（N = issue 番号）。**恒久** — issue close 後も剥がさない。同一 process が複数 issue に対応する場合は `i40_i41_do_work` のように連結する。対応する出力 artifact の id は最初から plain（prefix なし）
- **ラベル**: roadmap 登録 issue は `flow:managed`、対象外は `flow:exempt`（判定は「ラベル判定基準」節）
- **updated_at**: 同期時点の GitHub `updatedAt` スナップショット
- **close 時の挙動**: issue の `stateReason` によって異なる。判定起点は process（`iN_` から issue 番号を解決し、body の edge から出力 artifact を逆引きする）
  - **COMPLETED**（`Close as completed`）: 実装済みとして扱う。終端はチェーンごと削除（`closed_in_flow`）。下流入力が残るものは process 側の `tags`/`updated_at` を削除するのみ — `iN_` prefix は恒久のため剥がさず、`status` も強制しない（マージ時に既に `done` になっている）
  - **NOT_PLANNED**（`Close as not planned`）: 未実装のまま廃止。終端は自動削除（`closed_not_planned`）、下流入力が残るものは手動対応 finding — 下流 artifact も廃止するか代替を用意するかを人が判断する
  - **チェーンの定義**: 削除対象の「チェーン」= 当該 artifact + それを唯一生産する process + 関連 edge。process を残すと出力なき孤児 process になる（`check` が検出する。入力だけ残った process は V003、入力も出力も持たない宣言済み process は V020。全 predecessor/successor を失ったノードは `graph orphans` でも一覧できる）

## ラベル判定基準

roadmap は「製品の成果物を生み、他作業の着手をゲートする作業」を管理する。**新機能・spec 追加・リリース・他 issue の前提になる作業**は `flow:managed`。**他作業をゲートしない保守作業** — バグ修正/hotfix・CI/ビルド/git hook/ツーリング・PFD や doc の bookkeeping（図への登録漏れ補完等）— は `flow:exempt` とし roadmap に載せない。判定テスト: 「この issue の完了が別の roadmap 作業の前提になるか、新しい製品能力を生むか」。No（保守・基盤・修正のみ）なら exempt。

**判定タイミング**: 起票時に `flow:managed` / `flow:exempt` を判定してから roadmap 追加要否を決める。`flow:managed` の起票と roadmap 追加は同時に行う（後回しにすると依存グラフが stale になり気付き依存に戻る）。

**ラベル付与の許可要否**: `flow:managed`/`flow:exempt` の付与・変更は分類作業であり、issue の close・PR の merge・公開物の publish 等の確定操作ではない。ユーザーへの明示確認なしに実行してよい。

## PR 本文規約

issue に対応する PR を作る際、本文に必ず閉じるキーワードを含める:

```
Closes #<issue番号>
```

複数 issue の場合は1行ずつ列挙する。これにより PR マージ時に GitHub が issue を自動 close し、`flow-on-issue-close` ワークフローが起動する。

**中間 PR では使わない**: `Closes` を使うのはデフォルトブランチ（main 等）へ直接マージする PR のみ。feature branch への中間 PR に書くと、feature branch マージ時点で issue が閉じられ、デフォルトブランチ未到達のまま誤 close になる。issue close と flow 確定はデフォルトブランチへのマージ時に行う。

## hotfix 運用（issue 省略）

バグ修正で以下をすべて満たす場合、issue 起票・roadmap 更新を省略してよい:

- spec・仕様変更を伴わない（既存動作の回復のみ）
- PR 単体で完結し、依存解放を要しない
- PR description に "hotfix" と明記する

**develop 開始前に hotfix 判定を行う** — 3条件の確認前に issue 起票・roadmap 追加を開始しない。issue なし develop は hotfix のみに限る。

## develop 中に見つけたスコープ外バグの扱い

作業中の issue とは無関係な既存問題を偶然見つけた場合は原則どおり別途起票する。ただし、**当該 PR のテストを green にするために不可避な既存バグ**（例: 新規追加したテストの実行方式が、テスト対象と無関係な既存コードの欠陥を顕在化させた場合）は、同一 PR 内で直接修正してよい — 別 issue に切り出すと当の PR が green にならず着地しない。判定テスト: 「このバグを直さずに今の PR のテストを green にできるか」。できない場合のみ同一 PR 内で直す。修正理由・原因は PR 本文に明記する（発見経緯でなく、何が壊れていて何を直したかの事実）。

## flow:exempt のバッチ管理（親トラッカー issue）

複数の `flow:exempt` issue をまとめて記録・順序管理したい場合、GitHub issue 本文にタスクリスト形式で列挙した親トラッカー issue を1つ立ててよい（roadmap.pfdsl には載せず、親issue自体も exempt）。子issueを close した際は、親issueのタスクリスト該当行を手動で `[x]` に更新する — 本文中の手書き `- [ ] #123` 形式は GitHub のネイティブ task-list 連動（相手issueを convert-to-issue した場合のみ働く自動チェック機能）の対象にならず、close しても自動チェックされない。全件完了で親issue自体を close する。

## 自動同期（flow-on-issue-close）

issue が close されると `.github/workflows/flow-on-issue-close.yml` が起動し、`audit-issues-flow.mjs --fix` で `roadmap.pfdsl` を機械修復して PR を作成する。

PR マージ時に issue が自動 close されるには、PR 本文に `Closes #<issue番号>` を含める必要がある（「PR 本文規約」参照）。

## 同期監査

`scripts/audit-issues-flow.mjs` が GitHub issues と `roadmap.pfdsl` の同期を機械監査する（ラベル・updatedAt・priority 突合）。`--fix` で機械的修復。

## 採用手順

1. pfdsl plugin を導入する（`/plugin marketplace add takasek/pfdsl` + `/plugin install pfdsl@pfdsl`）— pfd-ops スキル本体はリポでなく plugin から供給される
2. `install/` 以下のファイルをリポルートに実配置する（`/pfd-init` ステップ3.5、または直接 `node <pfd-ops skill root>/scripts/check-install-sync.mjs --deploy`）。
   配置ファイルと plugin 同梱 canonical の drift は pfd-ops 発火時のランタイム hash 照合が警告する（設計根拠: ADR-0028）
3. GitHub に `flow:managed` / `flow:exempt` ラベルを作成する（`audit-issues-flow.mjs --fix` が未作成ラベルを自動生成する）
4. `roadmap.pfdsl` を依存構造のみのグラフとして用意し、issue に対応する process に `iN_` prefix を付ける
5. リポの `roadmap.md` で本プリセットを指し、リポ URL を記載する

## 依存（flow-on-issue-close.yml 実行環境）

- Node.js 24 以上
- `gh` CLI（GitHub Actions ランナーにはプリインストール済み）
- npm パッケージ `yaml`（`audit-issues-flow.mjs` の唯一の外部依存。workflow が `npm install --no-save yaml` で都度導入するため事前インストール不要）

workflow は pnpm 等の特定パッケージマネージャを前提としない（`npm install --no-save yaml` のみで完結）。リポ固有の追加処理（スナップショット再生成等）が必要な場合は `scripts/flow-sync-local-hook.mjs` を置くと、存在すれば workflow が自動実行する。
