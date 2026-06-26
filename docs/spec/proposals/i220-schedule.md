# schedule: フィールド仕様案 (#220)

## 対象仕様バージョン

v0.0.8 → v0.0.9

## 概要

Artifact / Process に見積もりパラメータを格納する `schedule:`
ブロックを追加する。[pfd-tools](https://github.com/Kuniwak/pfd-tools)
は PFD からスケジュール計画・クリティカルパスを生成するツール群であり、
pfdsl をその入力フォーマットとして連携させるための仕様整備である。

`schedule:` ブロックの**存在**が pfd-tools 連携可能の条件となる。
ブロックを持たないノードは連携対象外とする。グラフ意味論には影響しない
（`owner` / `command` と同じく可視化・解析のためのメタデータ）。

## 仕様変更

### §2.3 IDメタデータ定義 への追加

Process / Artifact それぞれに `schedule:` マッピングを追加できる。
キー集合はノード種別ごとに異なる。

#### process.schedule

```yaml
process:
  impl:
    label: 実装
    owner: dev-team          # pfd-tools の Group にマップ（既存フィールド）
    schedule:
      workVolume: 3.0          # Est. Work Volume（抽象作業量、非負数）
      reworkRatio: 0.3         # Est. Rework Volume Ratio（0.0–1.0）
      resources: "Dev:1;QA:0.5"  # Needed Resources（pfd-tools と同形式の文字列）
      startCondition: "\\complete(spec)"  # Start Condition（pfd-tools と同 DSL の文字列）
      milestone: M1            # Milestone ID（文字列）
```

#### artifact.schedule

```yaml
artifact:
  req:
    label: 要求仕様書
    schedule:
      availableTime: 0.0   # 外部入力成果物の利用可能開始時刻（非負数）
      maxRevision: 3        # feedback ループの終了条件（非負整数）
```

フィールド定義:

- 型: マッピング（YAML オブジェクト）
- 個数: 1 ノードにつき 0 または 1 個
- 対象: Artifact / Process の両方（ただしキー集合は種別ごとに異なる）
- `owner` は既存のトップレベルフィールド。pfd-tools の `Group` 列にマップする

### §2.2 front matter キー一覧

変更なし（`artifact` / `process` キー配下の属性追加のみ）。

### §15 制約 への追加（§15.13 として）

#### 15.13 schedule 制約

- `schedule:` の値がマッピングでない（スカラー・配列）場合は error（V029）
- `schedule:` 配下のキーがノード種別の許可集合外の場合は error（V030）。process は `workVolume` / `reworkRatio` / `resources` / `startCondition` / `milestone`、artifact は `availableTime` / `maxRevision` を許可する。種別をまたいだ誤用（artifact に `workVolume` 等）もこの規則で検出する
- 既知の `schedule:` フィールドの値が型・範囲に違反する場合は error（V031）。`workVolume` / `availableTime` は非負数、`reworkRatio` は 0.0–1.0 の数、`maxRevision` は非負整数、`resources` / `startCondition` / `milestone` は文字列

### §16 エラー方針 への追加

| 状況 | 標準 |
|------|------|
| `schedule:` がマッピングでない（V029） | error |
| `schedule:` 配下のノード種別外キー（V030） | error |
| 既知 `schedule:` フィールドの型・範囲違反（V031） | error |

## 設計判断

### なぜ存在ベースの連携条件か

pfd-tools 連携は全ノードに必須ではない。見積もり対象としたいノードにのみ
`schedule:` を付ける運用を許すため、ブロックの**存在**を連携可否の判定軸と
する。これにより既存 `.pfdsl` との後方互換が保たれる（`schedule:` 無し =
従来どおり）。

### なぜキー集合をノード種別で分けるか

process は変換工程の見積もり（作業量・手戻り・資源・開始条件・マイルストン）を、
artifact は成果物の時刻属性（利用可能時刻・改版上限）を扱い、意味が異なる。
種別ごとに許可キーを分けることで、誤って process フィールドを artifact に
書くといった構造的ミスを checker（V030）で機械的に検出できる。

### なぜ formatter は schedule を再整形しないか

PFDSL の formatter は front matter を逐語的に保持し（YAML を再シリアライズ
しない）、本文 edge のみを正準化する。`schedule:` も他の front matter
フィールドと同様、`fmt` を通しても変更されない。これは既存挙動であり、
本提案で新たな整形規則は導入しない。

## 影響範囲

- §2.3 IDメタデータ定義: `schedule:` フィールド追加（process / artifact）
- §15 制約: §15.13 追加
- §16 エラー方針: V029 / V030 / V031 行追加
- §17 例: 例示追加推奨（docs/samples/15-schedule.pfdsl と対応）
- checker 実装: V029 / V030 / V031 を @pfdsl/core validator に追加（実装済み）
- formatter 実装: 変更なし（front matter 逐語保持で自動的に対応）
- graphviz-exporter: 変更なし（schedule はグラフ意味論に影響しない）
