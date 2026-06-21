# プロジェクトレベル共有プリセット (#6)

## 対象仕様バージョン

v0.0.7 → v0.0.8

> **統合済み**: 本提案の決定は spec v0.0.8（§2.2 extends / §2.9.4 継承解決 / §2.9.5 プリセットファイル形式 / §15.12）に統合された（PR #136）。normative な仕様は spec 本文が一次情報。本ファイルは設計経緯の記録。なお統合後の stress-test（ADR-0020）で一部が精緻化された（プリセット汚染禁止 → 許容トップレベルキーのホワイトリスト化）。本ファイルは精緻化前の原案を保存する。

## 概要

複数の `.pfdsl` ファイルを持つプロジェクトでは、`statusStyles` / `tag` / `group` の定義がファイルごとに重複し、変更時の一貫性維持が困難になる。トップレベル frontmatter キー `extends:` を導入し、共有プリセットファイルから presentation 系スタイル定義を継承できるようにする。継承解決規則は `docs/spec/proposals/multifile-policy.md` 決定 3 に確定済みであり、本提案はそれを参照する。

## 仕様変更

### §2.2 front matter キー への追加

`extends:` をトップレベル frontmatter キーとして追加する。

| キー | 型 | 意味 |
|------|----|------|
| extends | 文字列 または 文字列の配列 | 継承するプリセットファイルへの相対パス |

```yaml
# 単一プリセット
extends: ./presets.yaml

# 複数プリセット（後勝ち）
extends:
  - ./base.yaml
  - ./team.yaml
```

- 値: プリセットファイルへの相対パス（基準は含む `.pfdsl` ファイルの位置、`location:` / `subflow:` と同規則）
- 相対パスのみ許可。絶対パス・URL（`://` 形式）は不可（`docs/spec/proposals/multifile-policy.md` 決定 2a 参照）
- 複数指定: 配列で複数可。同一キーが複数プリセットに存在する場合は配列の後側が勝つ（後勝ち）。ローカル定義は常に全プリセットに勝る

### §2.x プリセットファイル形式

プリセットファイル（`.yaml` 拡張子を推奨）は以下の構造を持つ YAML ファイルである。

```yaml
# presets.yaml の例
extends: ./base.yaml   # プリセットが別プリセットを extends してよい（多段）

statusStyles:
  done:
    style: filled
    fillcolor: "#4CAF50"
    fontcolor: white
  wip:
    style: filled
    fillcolor: "#FFC107"

tag:
  urgent:
    style: { color: red }

group:
  frontend:
    label: フロントエンド
    style: dashed
```

- 許容トップレベルキー: `extends` / `statusStyles` / `tag` / `group`
- `artifact` / `process` キーを含む場合は **error**（生成物定義の共有は禁止、決定 1 参照）
- エッジ本文（`>>` 構文）はプリセットファイルには記述できない。記述されている場合は error
- プリセットファイル自身も `extends:` を持てる（多段継承、決定 3 参照）

### §15 制約 への追加（§15.12 として）

#### 15.12 extends 制約

1. **パス存在**: `extends:` に指定されたファイルが存在しない場合は error
2. **循環参照禁止**: `A extends B, B extends A` のような循環 extends は error。checker が深さ優先で検出する
3. **プリセット汚染禁止**: プリセットファイルに `artifact:` / `process:` キーが含まれる場合は error
4. **相対パスのみ**: `extends:` の値が絶対パスまたは URL（`://` を含む）の場合は error
5. **継承解決順**: `docs/spec/proposals/multifile-policy.md` 決定 3 に従う（キー単位マージ・nearest-wins・ローカル prevail）

#### 継承解決の具体例

プリセット `presets.yaml` で `done` を緑に定義し、ローカルファイルで `done` を青に上書きする場合：

```yaml
# presets.yaml
statusStyles:
  done:
    fillcolor: "#4CAF50"   # 緑
  wip:
    fillcolor: "#FFC107"   # 黄
```

```yaml
# main.pfdsl
---
extends: ./presets.yaml
statusStyles:
  done:
    fillcolor: "#2196F3"   # 青（ローカル定義がプリセットに勝つ）
---
spec >> implement -> test
```

解決結果: `done` は青（`#2196F3`）、`wip` はプリセットの黄（`#FFC107`）。キー単位マージのため `wip` はローカルに未定義でもプリセット値が有効。

## 設計判断

### なぜ `extends:` frontmatter 方式か（auto-discovery config でなく）

`pfdsl.config.yaml` をリポジトリルートに自動探索する代替案を検討したが不採用とした。理由: どのファイルがどのプリセットを継承しているかが各ファイルを開かなければわからない（暗黙的）。`extends:` を frontmatter に明示することで、ファイル単体を読んだだけで継承関係が可視になる。`docs/spec/proposals/multifile-policy.md` 決定 2a「ファイル間参照は常に相対パスで記述する」の精神とも一致する。

### なぜ共有対象を presentation 系（statusStyles / tag / group）に限るか

`artifact` / `process` 定義の共有は `docs/spec/proposals/multifile-policy.md` 決定 1（ID スコープ = ファイルローカル）および決定 3 対象スコープの規定により禁止される。生成物定義をファイルをまたいで共有すると、単一生成元制約（V001）のファイル単位保全が崩れる。statusStyles / tag / group は純粋な presentation（および見た目に紐づくタグ定義）であり、生成論理に影響しない。

### なぜキー単位マージを採用するか（ブロック置換でなく）

`docs/spec/proposals/multifile-policy.md` 決定 3 を参照。ブロック丸ごと置換にするとプリセットの一部キーだけ上書きしたい場合に全量再定義が必要になる。キー単位マージはローカル変更を最小にし、プリセット変更がローカルの意図を意図せず消さない。

### 複数 extends を配列で許可した理由

チームプリセット（色規則）とプロジェクトプリセット（group 定義）を分離管理したいユースケースに対応する。後勝ち（配列末尾が優先）とすることで、順序が意図を表現する。単一プリセットと構文を共通化（文字列または配列）することで、段階的移行が容易。

## 影響範囲

- §2.2 front matter キー一覧: `extends:` 追加（トップレベルキー）
- §2.x プリセットファイル形式（新規節）: 許容キー・禁止キー・多段 extends の定義
- §15.12: extends 制約 追加（checker 必須実装）
- §16 エラー方針: 以下を追記
  - `extends:` パス不存在 → error
  - 循環 extends → error
  - プリセットファイルに `artifact:` / `process:` 混入 → error
  - `extends:` の値が絶対パスまたは URL → error
- parser/loader: `extends:` 解決・プリセットファイルロード・多段継承展開・キー単位マージ処理
- checker: プリセットファイル妥当性検証（`artifact:` / `process:` 混入検出）・循環 extends 検出・パス存在確認
- renderer: マージ後の統合 frontmatter を入力として受け取る（実装は merge 後の frontmatter を見るだけであり、プリセット由来か否かを区別しない）
