# GitHub Issues バックエンド（pfd-ops プリセット）

PFD の作業項目を GitHub Issues で管理する流儀。pfdsl 固有ではなく、採用したいリポが選べる再利用可能パターン。採用リポは `roadmap.md` でこのプリセットを指す。

## 規約

- **一次情報**: GitHub Issue 本体。着手時は `gh issue view <number> --json body,comments` で本文とコメントを両方取得する。`roadmap.pfdsl` は依存構造のみ管理する
- **複数行本文の外部書込み**: issue 本文の作成・編集、issue コメント、PR 本文の作成・編集のように複数行本文を GitHub へ送るたび、セッション固有名を持つ body file にその時点の正本を書く。transport が file 入力を持つときは `--body-file` 等で正本を直接渡し、MCP 等の body 入力しか持たない transport では正本ファイルを読んだ値を手で再構成せずに渡す。実行直後に、**既存 issue / PR の編集では write request の対象番号、新規 issue / PR / comment では write response の stable identifier や URL が指す対象そのもの**を同じ transport またはその backend の参照手段で取り直し、GitHub 側の persisted `body` が改行を含めてその正本と完全一致することを確認する。新規作成に使う操作が対象の identifier を応答として返す契約を持たない場合は、一覧から推測せず、identifier を返す backend API や transport を write 前に選ぶ。本文に `Closes #...` のような必須行や参照がある場合は、その構造も同じ readback 結果で確認し、後続の本文編集でも毎回保たれていることを確認する。issue の `body,comments` 一覧を広く読み、似た本文を見つけて代用しない。write と exact readback の両方を提供する transport が無い場合は他の手段へ勝手に切り替えず、不足している前提条件を報告して停止する。コマンドの成功表示や返された URL は persisted body の証拠にならない
- **id 規約**: issue に対応する作業の process id は `iN_` prefix（N = issue 番号）。**恒久** — issue close 後も剥がさない。同一 process が複数 issue に対応する場合は `i40_i41_do_work` のように連結する。対応する出力 artifact の id は最初から plain（prefix なし）。**まだ issue が無いプロセスは plain の id で置く** — 成果物の門番（プロトコル5(b)）が要求するプレースホルダ後続プロセスは、起票より先にグラフへ入る。採番できない番号を捏造せず、起票時に `iN_` を付けてリネームする。この状態は `check` を通ってしまい機械検出されないので、逸脱として `roadmap.md` に書き残す
- **ラベル**: roadmap 登録 issue は `flow:managed`、対象外は `flow:exempt`（判定は「ラベル判定基準」節）
- **updated_at**: 同期時点の GitHub `updatedAt` スナップショット
- **close 時の挙動**: issue の `stateReason` によって異なる。判定起点は process（`iN_` から issue 番号を解決し、body の edge から出力 artifact を逆引きする）
  - **COMPLETED**（`Close as completed`）: 実装済みとして扱う。終端はチェーンごと削除（`closed_in_flow`）。下流入力が残るものは process 側の `tags`/`updated_at` を削除するのみ — `iN_` prefix は恒久のため剥がさず、`status` も強制しない（マージ時に既に `done` になっている）
  - **NOT_PLANNED**（`Close as not planned`）: 未実装のまま廃止。終端は自動削除（`closed_not_planned`）、下流入力が残るものは手動対応 finding — 下流 artifact も廃止するか代替を用意するかを人が判断する
  - **チェーンの定義**: 削除対象の「チェーン」= 当該 artifact + それを唯一生産する process + 関連 edge。process を残すと出力なき孤児 process になる（`check` が検出する。入力だけ残った process は V003、入力も出力も持たない宣言済み process は V020。エッジを一切失ったノードは `graph orphans` でも一覧できる）

## ラベル判定基準

roadmap は「製品の成果物を生み、他作業の着手をゲートする作業」を管理する。**新機能・spec 追加・リリース・他 issue の前提になる作業**は `flow:managed`。**他作業をゲートしない保守作業** — バグ修正/hotfix・CI/ビルド/git hook/ツーリング・PFD や doc の bookkeeping（図への登録漏れ補完等）— は `flow:exempt` とし roadmap に載せない。判定テスト: 「この issue の完了が別の roadmap 作業の前提になるか、新しい製品能力を生むか」。No（保守・基盤・修正のみ）なら exempt。

**判定タイミング**: 起票時に `flow:managed` / `flow:exempt` を判定してから roadmap 追加要否を決める。`flow:managed` の起票と roadmap 追加は同時に行う（後回しにすると依存グラフが stale になり気付き依存に戻る）。

**ラベル付与の許可要否**: `flow:managed`/`flow:exempt` の付与・変更は分類作業であり、issue の close・PR の merge・公開物の publish 等の確定操作ではない。ユーザーへの明示確認なしに実行してよい。

## 設計確定の証拠

対応方針の候補を2件以上列挙した issue は、実行主体が着手前（ブランチの初コミットより前）に投稿する設計選択記録（前提・否定案・却下理由。work-cycle 手順1 適用点1 が定義する）があるまで設計未確定として扱う。**投稿先は当該 issue のコメントに限る** で、前後は記録の投稿時刻（`createdAt`）と初コミットの authorDate を機械照合する。
issue 本文は記録の投稿先にならない。本文は起票時に書かれるので、その `createdAt` は当の issue を閉じるブランチのどのコミットよりも古く、上の機械照合が記録の書かれた順序と無関係に通ってしまう。本文を投稿先として認めていた間、照合は「着手前に書かれた」でなく「issue が先に立てられた」を確かめていた。
複数行の設計選択記録は上の「複数行本文の外部書込み」規約に従い、投稿に使った body file と、その write response が返した stable identifier や URL で同定した persisted `body` の完全一致確認までを初コミットより前に完了する。issue の `body,comments` 一覧から古い comment を拾う読み方、コメント作成の成功表示、返された URL だけでは、この順序証拠の入力として採用しない。
この exact-write readback は実行主体が投稿直後に完了させる着手前条件である。`cycle-status` / `gate-check` は comment 一覧から必須行頭と時刻を検査する独立した safety net で、その write の identifier を入力としないため、検査対象が直前に投稿した comment と同一であることまでは保証しない。その PASS を exact-write readback の代わりにしない。
コメントの編集時刻も取得し、着手後に書き換えられた記録を着手前の証拠として扱わない。ただし比較対象の authorDate は実行主体がコミット時のオプション・環境変数・初コミットに届く rebase で操作できる。committerDate は rebase のたびに全コミットが書き換わりサイクルの窓が消えるため代替にならない。この順序証拠の真正性は機械保証でなく人間レビューが担う。

**拡張点**: 実行主体と人間が別 GitHub identity（bot トークン等）で動く環境では、この記録の author を検査する形の捏造耐性を追加で導入しうる。実行主体と人間が同一 identity で `gh` を実行するこのリポを含む環境では author 照合が原理的に判別子にならないため、既定では持たない。

## PR 本文規約

issue に対応する PR を作る際、本文に必ず閉じるキーワードを含める:

```
Closes #<issue番号>
```

複数 issue の場合は1行ずつ列挙する。これにより PR マージ時に GitHub が issue を自動 close し、`flow-on-issue-close` ワークフローが起動する。

**中間 PR では使わない**: `Closes` を使うのはデフォルトブランチ（main 等）へ直接マージする PR のみ。feature branch への中間 PR に書くと、feature branch マージ時点で issue が閉じられ、デフォルトブランチ未到達のまま誤 close になる。issue close と flow 確定はデフォルトブランチへのマージ時に行う。

**閉じる issue が無い PR**: hotfix（次節）に該当しない、bookkeeping やドキュメントの spin-off 等では、行頭に `no-issue: <理由>` と明示する。理由は必須（コロンの後に空でない理由テキストを書く）。これは「issue なし develop は hotfix のみに限る」の例外であり、理由必須の明示宣言に限って緩めたもの — 宣言なしに閉じる issue が無いまま PR を出すことは変わらず認めない。

## hotfix 運用（issue 省略）

バグ修正で以下をすべて満たす場合、issue 起票・roadmap 更新を省略してよい:

- spec・仕様変更を伴わない（既存動作の回復のみ）
- PR 単体で完結し、依存解放を要しない
- PR description に "hotfix" と明記する

**develop 開始前に hotfix 判定を行う** — 3条件の確認前に issue 起票・roadmap 追加を開始しない。issue なし develop は hotfix、または「PR 本文規約」の `no-issue: <理由>` 宣言を伴う場合のみに限る。

## develop 中に見つけたスコープ外バグの扱い

作業中の issue とは無関係な既存問題を偶然見つけた場合は原則どおり別途起票する。ただし、**当該 PR のテストを green にするために不可避な既存バグ**（例: 新規追加したテストの実行方式が、テスト対象と無関係な既存コードの欠陥を顕在化させた場合）は、同一 PR 内で直接修正してよい — 別 issue に切り出すと当の PR が green にならず着地しない。判定テスト: 「このバグを直さずに今の PR のテストを green にできるか」。できない場合のみ同一 PR 内で直す。修正理由・原因は PR 本文に明記する（発見経緯でなく、何が壊れていて何を直したかの事実）。

## flow:exempt のバッチ管理（親トラッカー issue）

複数の `flow:exempt` issue をまとめて記録・順序管理したい場合、GitHub issue 本文にタスクリスト形式で列挙した親トラッカー issue を1つ立ててよい（roadmap.pfdsl には載せず、親issue自体も exempt）。子issueを close した際は、親issueのタスクリスト該当行を手動で `[x]` に更新する — 本文中の手書き `- [ ] #123` 形式は GitHub のネイティブ task-list 連動（相手issueを convert-to-issue した場合のみ働く自動チェック機能）の対象にならず、close しても自動チェックされない。全件完了で親issue自体を close する。

## 自動同期（flow-on-issue-close）

issue が close されると `.github/workflows/pfdsl-flow-on-issue-close.yml` が起動し、まず `scripts/pfdsl/audit-issues-flow.mjs --check-closed-registration <n>` が close event の issue だけを `gh issue view` で取得して pre-fix `roadmap.pfdsl` の登録を確認する。`flow:managed`・`CLOSED`・`COMPLETED` で未登録の場合、対象不在や OPEN など event 契約に反する場合は FAIL して `--fix` を実行しない。登録済み・`NOT_PLANNED`・`flow:exempt`・非 managed は PASS とし、その後 `scripts/pfdsl/audit-issues-flow.mjs --fix` を実行して `roadmap.pfdsl` を機械修復し PR を作成する。実体スクリプトは `scripts/pfdsl/` 配下に集約し、由来を明示する（配布物の境界設計は ADR-0032 参照）。

PR マージ時に issue が自動 close されるには、PR 本文に `Closes #<issue番号>` を含める必要がある（「PR 本文規約」参照）。

## 同期監査

`scripts/pfdsl/audit-issues-flow.mjs` が GitHub issues と `roadmap.pfdsl` の同期を機械監査する（ラベル・updatedAt・priority 突合）。`--fix` で機械的修復し、`--check-closed-registration <n>` は close event の対象 issue と pre-fix roadmap だけを検査する。

findings は3クラスに分かれ、出力の見出しがそれを名乗る。`fixable:` は `--fix` が直すもので、`--fix` なしでは監査を落とす。`manual:` は人が直すもので監査を落とし、`advisory:` だけなら監査を落とさない。
`flow:managed` なのに process を持たない issue（`missing_process`）が advisory なのは、その登録が実装ブランチに乗るためである — そのブランチが統合されるまで他の作業ツリーからは常に欠落して見える。
あるサイクルの差分が消せるのは自分が着手する issue の欠落だけで、他の issue の分は消せない。
落とす設計にすると、原因を作っていないサイクルが毎回赤くなり、赤い行そのものが読まれなくなる。
この欠落に行動できるのは、その issue を自分のものとして扱っている側だけなので、検査点はそこへ寄せる。
着手時点では、プリフライト集約スクリプトを持つリポがそのサイクルの issue について報告する（登録漏れは依存関係を変えうるので、roadmap に着手する前に知りたい）。
マージ前の時点では、roadmap を編集する PR について、その PR が閉じる issue の分だけを FAIL にする — 対象集合を PR 自身から導けるため、実行主体が渡すフラグに依存しない。
後者の時点は PR の close 契機に置かない。close 後に気付いても、その PR はもう変えられない。ただし close event では `--fix` 前の roadmap を対象限定で検査し、`flow:managed` の COMPLETED close が未登録なら flow sync を止める。

## 採用手順

1. pfdsl plugin を導入する（`/plugin marketplace add takasek/pfdsl` + `/plugin install pfdsl@pfdsl`）— pfd-ops スキル本体はリポでなく plugin から供給される
2. `install/` 以下のファイルをリポルートに実配置する（`/pfd-init` ステップ3.5、または直接 `node <pfd-ops skill root>/scripts/check-install-sync.mjs --deploy`）。
   配置ファイルと plugin 同梱 canonical の drift は pfd-ops 発火時のランタイム hash 照合が警告する（設計根拠: ADR-0028）
3. GitHub に `flow:managed` / `flow:exempt` ラベルを作成する（`scripts/pfdsl/audit-issues-flow.mjs --fix` が未作成ラベルを自動生成する）
4. `roadmap.pfdsl` を依存構造のみのグラフとして用意し、issue に対応する process に `iN_` prefix を付ける
5. リポの `roadmap.md` で本プリセットを指し、リポ URL を記載する

## 依存（pfdsl-flow-on-issue-close.yml 実行環境）

- Node.js 24 以上
- `gh` CLI（GitHub Actions ランナーにはプリインストール済み）
- npm パッケージ `yaml`（`audit-issues-flow.mjs` の唯一の外部依存。workflow が `npm install --no-save yaml` で都度導入するため事前インストール不要）

workflow は pnpm 等の特定パッケージマネージャを前提としない（`npm install --no-save yaml` のみで完結）。リポ固有の追加処理（スナップショット再生成等）が必要な場合は `scripts/flow-sync-local-hook.mjs` を置くと、存在すれば workflow が自動実行する。
