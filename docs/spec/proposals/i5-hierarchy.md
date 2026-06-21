# 階層 PFD：プロセスのサブフロー展開 (#5)

## 対象仕様バージョン

v0.0.7 → v0.0.8

> **統合済み**: 本提案の決定は spec v0.0.8（§2.3 subflow / §2.9 マルチファイル意味論 / §15.11）に統合された（PR #136）。normative な仕様は spec 本文が一次情報。本ファイルは設計経緯の記録。

## 概要

Shimizu PFD 法の核心は階層分解にある。親プロセスをサブフローへ展開し、外部入出力の整合が検証された状態で大規模フローを複数ファイルに分割できるようにする。現行仕様は単一ファイル前提でありリンク機構も境界整合チェックも存在しない。

本提案は `subflow:` フィールド（Process 専用メタデータ）と境界整合制約（§15.11）を追加する。ファイル間の ID スコープ・参照形式・V001 との関係は `docs/spec/proposals/multifile-policy.md`（決定 1 / 決定 2）に確定済みであり、本提案はそれを参照する。

## 仕様変更

### §2.3 IDメタデータ定義 への追加

#### subflow（Process 専用）

```yaml
process:
  order_fulfill:
    label: 受注処理
    subflow: ./order_fulfill_sub.pfdsl
```

- 型: 文字列
- 値: 子 `.pfdsl` への相対パス（基準は含む `.pfdsl` ファイルの位置、`location:` と同規則）
- 個数: 1 Process につき 0 または 1 個
- 意味論: 当該プロセスを子フローへ展開する（ビューリンク。生成の複製ではない）
- 許容値: 相対パスのみ。絶対パス・URL（`://` 形式）は不可

親プロセスの入出力エッジとの self-consistent 例：

```pfdsl
---
process:
  order_fulfill:
    label: 受注処理
    subflow: ./order_fulfill_sub.pfdsl
---
order >> order_fulfill -> fulfilled_order
```

子フロー（`order_fulfill_sub.pfdsl`）では `order` が open input artifact、`fulfilled_order` が terminal artifact となる。

### §15 制約 への追加（§15.11 として）

#### 15.11 subflow 境界整合制約

`subflow:` を持つ Process（以下、展開プロセス）に対し、checker は以下の境界整合を検証する。

* 子フローの **open input artifact**（生成元プロセスを持たない artifact）は、展開プロセスの入力エッジが指す artifact と同一 ID でなければならない
* 子フローの **terminal artifact**（消費先プロセスを持たない artifact）は、展開プロセスの出力エッジが指す artifact と同一 ID でなければならない
* 境界 ID 協定の詳細は `docs/spec/proposals/multifile-policy.md` 決定 2b を参照
* `subflow:` の値がファイルパスとして存在しない場合は error
* 循環 subflow（A が B を subflow し B が A を subflow するなど）は error
* `subflow:` を Artifact に指定した場合は error

## 設計判断

### なぜファイルローカル名前空間 + 境界 ID 協定方式か（グローバル名前空間でなく）

`docs/spec/proposals/multifile-policy.md` 決定 1 / 決定 2b を参照。ファイルローカル名前空間は衝突回避・V001 / V002 / V003 保全・依存の可視化の 3 点で優れる。境界 artifact に限り親子で同一 ID を共有する協定により、グローバルレジストリなしで機械検証可能な整合が得られる。

### 子の境界をなぜ「暗黙（open/terminal ノード）」で判定するか

明示的な `boundary:` ブロックを要求する代替案は、子フローを単独で参照する際にも宣言を強制する冗長さをもたらす。open/terminal ノードは子フロー固有の意味論（入力源なし・消費先なし）として既に解釈可能であり、明示宣言なしで境界を導出できる。checker 側のコストは同等で、書き手側の負担を減らせる。

### Shimizu PFD の階層分解との対応

Shimizu PFD では「親プロセスの外部入出力 = 子 PFD の外部入出力」が階層整合の定義である。本提案の境界整合制約（§15.11）はこれを直接実装する。subflow を持つ親プロセスは子フローの「要約ビュー」として機能する。

### V001 との関係

`subflow:` はビューリンクであり生成の複製ではない（`docs/spec/proposals/multifile-policy.md` 決定 2c 参照）。子フロー内で境界 artifact が別プロセスにより生成されていても、それは別ファイル（別名前空間）の生成元であり、親フロー側の V001 制約とは独立して成立する。

## 影響範囲

- §2.3 IDメタデータ定義（Process 専用フィールド）: `subflow:` 追加
- §15.11: 境界整合制約 追加（checker 必須実装）
- §16 エラー方針: `subflow:` を Artifact に指定 → error、subflow パス不存在 → error、循環 subflow → error を追記
- checker 実装: subflow パス解決・子フロー再帰ロード・open input / terminal artifact 抽出・境界 ID 整合検証・循環 subflow 検出
- graphviz-exporter: `subflow:` を持つプロセスをサブグラフ展開またはリンク（`URL` 属性）として描画してよい（任意実装、グラフ意味論に影響しない）
