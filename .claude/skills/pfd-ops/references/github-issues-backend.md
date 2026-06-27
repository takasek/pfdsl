# GitHub Issues バックエンド（pfd-ops プリセット）

PFD の作業項目を GitHub Issues で管理する流儀。pfdsl 固有ではなく、採用したいリポが選べる再利用可能パターン。採用リポは `roadmap.md` でこのプリセットを指す。

## 規約

- **一次情報**: GitHub issue 本体。`roadmap.pfdsl` は依存構造のみ管理する
- **id 規約**: issue 対応 artifact の id は `iN_` prefix（N = issue 番号）。`iN_` id はオープン issue のみ参照する
- **ラベル**: roadmap 登録 issue は `flow:managed`、対象外は `flow:exempt`
  - **判定基準**: roadmap は「製品の成果物を生み、他作業の着手をゲートする作業」を管理する。**新機能・spec 追加・リリース・他 issue の前提になる作業**は `flow:managed`。**他作業をゲートしない保守作業** — バグ修正/hotfix・CI/ビルド/git hook/ツーリング・PFD や doc の bookkeeping（図への登録漏れ補完等）— は `flow:exempt` とし roadmap に載せない。判定テスト: 「この issue の完了が別の roadmap 作業の前提になるか、新しい製品能力を生むか」。No（保守・基盤・修正のみ）なら exempt
- **updated_at**: 同期時点の GitHub `updatedAt` スナップショット
- **close 時の降格**: issue close 時は flow から削除する。終端はチェーンごと削除、下流入力が残るものは `iN_` prefix を外し一般 done artifact へ降格する
  - **チェーンの定義**: 削除対象の「チェーン」= 当該 artifact + それを唯一生産する process + 関連 edge。process を残すと出力なき孤児 process になる（`check` は構文のみ検証し孤児を検出しないため手動で確認する）

## PR 本文規約

issue に対応する PR を作る際、本文に必ず閉じるキーワードを含める:

```
Closes #<issue番号>
```

複数 issue の場合は1行ずつ列挙する。これにより PR マージ時に GitHub が issue を自動 close し、`flow-on-issue-close` ワークフローが起動する。

## 自動同期（flow-on-issue-close）

issue が close されると `.github/workflows/flow-on-issue-close.yml` が起動し、`audit-issues-flow.mjs --fix` で `roadmap.pfdsl` を機械修復して PR を作成する。

PR マージ時に issue が自動 close されるには、PR 本文に `Closes #<issue番号>` を含める必要がある（「PR 本文規約」参照）。

## 同期監査

`scripts/audit-issues-flow.mjs` が GitHub issues と `roadmap.pfdsl` の同期を機械監査する（ラベル・updatedAt・priority 突合）。`--fix` で機械的修復。

## 採用手順

1. `pfd-ops` スキルをリポの `.claude/skills/pfd-ops/` に設置する
2. `pfd-ops/install/` 以下のファイルをリポルートに一括コピーする（相対パス保持）:
   ```sh
   cp -r .claude/skills/pfd-ops/install/. .
   ```
   install/ 内ファイルと deployed コピーの identity は `check-pfd-ops-sync.yml` CI が自動検証する（設計根拠: ADR-0016）。
3. GitHub に `flow:managed` / `flow:exempt` ラベルを作成する（`audit-issues-flow.mjs --fix` が未作成ラベルを自動生成する）
4. `roadmap.pfdsl` を依存構造のみのグラフとして用意し、issue artifact に `iN_` prefix を付ける
5. リポの `roadmap.md` で本プリセットを指し、リポ URL を記載する
