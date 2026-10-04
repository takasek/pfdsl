# Group / Artifact / Process 同名制約の境界確認（#1291）

2026-10-04、origin/main `245bf669` を基準にした作業差分で、仕様 v0.0.27 の §2.8.1・§15.17・§16 を確認した。
単一制約の追加なので spec-stress-test のフェーズ1を適用し、フェーズ2の agent 実書きプローブは実施していない。

同一ファイルの group 宣言 ID が artifact/process の宣言または本文役割にも現れれば N004 error、現れなければこの制約では pass と手トレースした。
粒度・親子階層・diamond の経路自体は判定材料にならず、N:M・多段・feedback・孤立宣言でも ID と役割の一致で判定する。
`group:` フィールドへの所属参照は本文のノード役割に当たらない。
空定義、空ファイル、異なる大文字小文字、引用符を必要とする ID も含め、19入力すべて実測と一致した。

対象 worktree の build 済み CLI に各 source をファイルとして渡し、`check <file> --json --no-color` で実測した。

| 入力 | 手トレース | exit | 実測診断 |
| --- | --- | --- | --- |
| empty | pass | 0 | なし |
| group-only | pass | 0 | なし |
| different-id | pass | 0 | なし |
| artifact-declaration | error | 1 | N004 |
| process-declaration | error | 1 | N004 |
| three-declarations | error | 1 | N004, N004, N001 |
| standalone | error | 1 | N004 |
| input-artifact | error | 1 | N004 |
| output-artifact | error | 1 | N004 |
| process-role | error | 1 | N004 |
| feedback-artifact | error | 1 | N004 |
| feedback-process | error | 1 | N004 |
| many-to-many | error | 1 | N004 |
| multiple-hops | error | 1 | N004 |
| diamond | error | 1 | N004 |
| empty-metadata | error | 1 | N004 |
| quoted-id | error | 1 | N004 |
| both-body-roles | error | 1 | N004, N004, N002, N002 |
| membership-is-not-role | pass | 0 | なし |

三重宣言では N001、両本文役割では N002 も残り、既存の Artifact / Process 矛盾を失わない。
この実測は同一ファイルの制約だけを確認し、preset 由来 group とローカルノードの名前衝突を新たに禁止する証拠ではない。

## 再現用入力

各要素の source をそのままファイルへ書き出せる。

```json
[
  {
    "name": "empty",
    "source": "",
    "expected": "pass"
  },
  {
    "name": "group-only",
    "source": "---\ngroup:\n  x: {}\n---\n\n",
    "expected": "pass"
  },
  {
    "name": "different-id",
    "source": "---\ngroup:\n  x: {}\nartifact:\n  X: {}\n---\nX >> p -> b\n",
    "expected": "pass"
  },
  {
    "name": "artifact-declaration",
    "source": "---\ngroup:\n  x: {}\nartifact:\n  x: {}\n---\n\n",
    "expected": "error"
  },
  {
    "name": "process-declaration",
    "source": "---\ngroup:\n  x: {}\nprocess:\n  x: {}\n---\n\n",
    "expected": "error"
  },
  {
    "name": "three-declarations",
    "source": "---\ngroup:\n  x: {}\nartifact:\n  x: {}\nprocess:\n  x: {}\n---\n\n",
    "expected": "error"
  },
  {
    "name": "standalone",
    "source": "---\ngroup:\n  x: {}\n---\nx\n",
    "expected": "error"
  },
  {
    "name": "input-artifact",
    "source": "---\ngroup:\n  x: {}\n---\nx >> p -> b\n",
    "expected": "error"
  },
  {
    "name": "output-artifact",
    "source": "---\ngroup:\n  x: {}\n---\na >> p -> x\n",
    "expected": "error"
  },
  {
    "name": "process-role",
    "source": "---\ngroup:\n  x: {}\n---\na >> x -> b\n",
    "expected": "error"
  },
  {
    "name": "feedback-artifact",
    "source": "---\ngroup:\n  x: {}\n---\nx >>? p\n",
    "expected": "error"
  },
  {
    "name": "feedback-process",
    "source": "---\ngroup:\n  x: {}\n---\na >>? x\n",
    "expected": "error"
  },
  {
    "name": "many-to-many",
    "source": "---\ngroup:\n  x: {}\n---\n[x, a] >> p -> [b, c]\n",
    "expected": "error"
  },
  {
    "name": "multiple-hops",
    "source": "---\ngroup:\n  x: {}\n---\na >> p -> b >> x -> c\n",
    "expected": "error"
  },
  {
    "name": "diamond",
    "source": "---\ngroup:\n  x: {}\n---\nx >> p -> b\nx >> q -> c\n",
    "expected": "error"
  },
  {
    "name": "empty-metadata",
    "source": "---\ngroup:\n  x:\n---\nx\n",
    "expected": "error"
  },
  {
    "name": "quoted-id",
    "source": "---\ngroup:\n  \"with space\": {}\n---\n\"with space\" >> p -> b\n",
    "expected": "error"
  },
  {
    "name": "both-body-roles",
    "source": "---\ngroup:\n  x: {}\n---\nx >> p -> b\na >> x -> c\n",
    "expected": "error"
  },
  {
    "name": "membership-is-not-role",
    "source": "---\ngroup:\n  x: {}\nartifact:\n  a: { group: x }\n---\na >> p -> b\n",
    "expected": "pass"
  }
]
```
