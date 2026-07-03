# type フィールド仕様案 (#268)

## 対象仕様バージョン

v0.0.10 → v0.0.11

## 概要

フロントマターに `type:` フィールドを追加し、PFD ファイルの種別を自己記述できるようにする。
ADR-0017 の種別定義（roadmap / workflow / runtime-pipeline）がツール挙動の判断根拠になった時点で、
ファイル名規約だけでなく明示的な自己宣言が必要。

## 仕様変更

### §2.1 document-level フィールド への追加

**type** — ファイルが表す PFD の種別（省略可能な文字列列挙）。

```yaml
type: roadmap   # または workflow / runtime-pipeline
```

* 列挙値: `roadmap` | `workflow` | `runtime-pipeline`
* 省略時: ツールは種別を問わない操作（check / fmt / graph 等）を実行する
* 列挙外の値は error (V031)

### §15.x 制約追加: V031 invalid type value

* `type:` に列挙外の値を指定した場合は error

### ready コマンドへの影響

`pfdsl ready` は `type: roadmap` のファイルのみ実行を許可する。
`type` が省略されているファイルに対しては warning を出しつつ続行する（後方互換）。
`type: workflow` または `type: runtime-pipeline` に対しては error を出して終了する。

## 理由

* workflow に将来着手予定の `todo` ノードを置きたいという要求と、
  `ready` が workflow 型で誤動作することは独立した問いである
* 種別をツールが自己判断するより、ファイルが自己宣言するほうが明確

## 関連

* ADR-0017（種別定義の意思決定記録）
* #269（audit-sync コマンド — type フィールドが前提）
