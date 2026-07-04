# location on Process (#310)

## 対象仕様バージョン

v0.0.12 → v0.0.13

## 概要

`location:` を Process にも許可する。i13 (#13) の「Artifact = 状態、Process = 動作」という区分自体は変えないが、Process 側にも実体に相当する参照先がある — 追跡・議論の場所（issue/PR URL 等） — ことを認め、それを `location:` で表現できるようにする。

`.pfdsl/roadmap.pfdsl` 運用では、issue/PR 追跡URLを Artifact に押し込む以外に選択肢がなく、成果物の実体と作業追跡先が混同されてきた。本提案はこの混同を解消する。

## 仕様変更

### §2.3 artifact 専用フィールド への変更

`location` を artifact 専用フィールドの見出し・箇条書きから外し、`owner` / `externalStakeholders` / `index` と同じ「artifact と process の共有フィールド」節に移す。意味論は Artifact/Process で共通（実体または追跡先へのポインタ）。

### §15.8 location / command 制約 への変更

「`location:` を Process に指定した場合は error」の箇条書きを削除する（`command:` を Artifact に指定した場合の error は維持する）。

### §16 エラー方針 への変更

「`location:` / `revises:` / `criteria:` を Process に指定: error」から `location:` を削除する（`revises:` / `criteria:` は維持）。

### §17.5 の例への追加

process 側の `location:` 使用例（tracking URL）を追加する。

### graphviz-exporter / vscode-extension への変更

- graphviz-exporter: Artifact 限定になっている href/tooltip 出力を Process にも適用する
- vscode-extension: hover tooltip の `location` 行が Process では未実装のため追加する（file/URL の open 機能自体は既に Process の `location` を読む実装になっている）

## 設計判断

### なぜ Process にも location を許すか

roadmap.pfdsl 運用で issue/PR 追跡URLを Artifact に押し込む必要が生じている。追跡URLは「この作業がどこで追跡されているか」であり、Process（動作）の付帯情報であって Artifact（状態＝成果物の実体）の実体ではない。i13 の区分自体（Artifact=状態、Process=動作）は変えず、「動作にも参照ポインタが要る」ことを追認する。

### なぜ command を Artifact に許可しないままにするか（対称性の非対称）

Artifact に実行手順という概念はない。location（ポインタ）は両者に意味があるが command（手順）は Process にしか意味がない。この非対称は意図的である。

### なぜ破壊的変更でないか

既存の valid なファイルは全て valid のまま。従来 error だった構文（Process への location）が legal になるだけで、valid → invalid になるケースはない。

## 影響範囲

- §2.3 / §15.8 / §16 / §17.5
- checker 実装: `packages/core/src/validator.ts` V013 分岐削除、`packages/core/src/types/frontmatter.ts` `ProcessMeta`
- graphviz-exporter: `packages/graphviz-exporter/src/node-attrs.ts` の artifact 限定ゲートを解除
- vscode-extension: `packages/vscode-extension/src/location-utils.ts` の hover tooltip 行追加（open/jump 機能は変更不要 — 既に Process の location を読む実装済み）
- samples: `docs/samples/16-basepath.pfdsl` + `samples.tsv` 該当行
- roadmap.pfdsl: 41件の issue/PR 追跡URLの Artifact→Process 移設（別コミットで対応）
