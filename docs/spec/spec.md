PFDSL仕様書 v0.0.2

1. 目的

本仕様は、清水吉男氏による PFD（Process Flow Diagram）の思想を基礎とし、成果物中心・純粋関数的なプロセス記述を行う DSL（Domain Specific Language）の形式仕様を定める。

PFDSL は以下を目的とする。

* 成果物（Artifact）とプロセス（Process）の依存関係を明示する
* 成果物の内部構造（parts）を明示する
* 人間に読みやすい逐次フロー記述を提供する
* 機械処理しやすい正規形へ変換可能とする
* ドキュメント・分析・可視化・実行支援の中間に位置する記述形式を提供する
* 手編集しやすく、差分比較しやすいテキスト形式を提供する

⸻

2. ファイル形式

拡張子：

.pfdsl

ファイルは以下の2部構成を取ってよい。

1. YAML front matter（任意）
2. PFDSL本文

front matter が存在しないファイルも有効とする。
front matter はファイル先頭にのみ記述できる。

⸻

2.1 YAML front matter

---

title: 開発フロー
version: 1.2
dsl_version: 0.0.2
tags: [web, review]

layout:
direction: LR

artifact:
req:
title: 要求仕様書

process:
design:
title: 設計
---------

⸻

2.2 front matter キー

すべて任意とする。

| key         | 内容           |
| ----------- | ------------ |
| title       | 文書名          |
| version     | 文書バージョン      |
| dsl_version | PFDSL仕様バージョン |
| description | 文書説明         |
| tags        | 任意タグ         |
| layout      | レイアウト補助情報    |
| artifact    | 成果物定義        |
| process     | プロセス定義       |

未定義キーを含んでもよい。処理系は無視してよい。

⸻

2.3 IDメタデータ定義

front matter では、本文中で使用する Artifact / Process ID に対し追加情報を定義してよい。

artifact:
spec:
title: 仕様書
owner: po

process:
impl:
title: 実装
owner: dev-team
estimate: 5d

title は表示名として利用してよい。

⸻

2.4 IDと表示名の分離

DSL本文では短く安定したIDを使用し、図示・UI・レポートでは front matter 上の title を利用してよい。

req >> design -> spec

表示例：

要求仕様書 → 設計 → 設計書

⸻

2.5 Artifact 構造定義

Artifact は内部構造（parts）を持ってよい。

artifact:
C:
title: 統合成果物
parts: [Ca, Cb]

意味：

* C は成果物ID
* Ca, Cb は C を構成する部分成果物ID
* parts は順序を持たない集合として扱う

parts は graph の生成関係とは独立である。
parts 宣言と生成graph入力との整合性は、標準意味論では検査対象外とする。処理系拡張として検査してよい。

⸻

2.6 レイアウトヒント

layout は可視化時の補助情報であり意味論には影響しない。

layout:
direction: LR

推奨値：

* LR
* RL
* TB
* BT

layout 以下の未定義キーは実装依存とする。

⸻

3. モデル構成要素

3.1 成果物（Artifact）

* IDで識別される
* プロセスの入力または出力となる
* Primary Graph において高々1つのプロセスから生成される
* 任意に parts を持ってよい

生成元を持たない成果物は外部入力成果物とみなす。

⸻

3.2 プロセス（Process）

* IDで識別される
* 入力成果物集合から出力成果物集合を生成する純粋関数である
* 副作用・暗黙依存を持たない

⸻

3.3 終端成果物

どのプロセスにも入力されない成果物は終端成果物とみなす。

⸻

4. 識別子

ID は bare-id または quoted-id とする。

4.1 bare-id

Unicode Letter / Number および _ - を許可する。

禁止文字：

[ ] ; # "

また演算子トークン：

* > >
* > > ?
* ->

を内部に含んではならない。

字句解析では演算子トークン `>>?` `>>` `->` を最長一致で優先認識する。

日本語識別子を許可する。

⸻

4.2 quoted-id

ダブルクォートで囲まれた識別子。

"要求仕様書 v2"
"設計書-新"

エスケープ：

" ダブルクォート
\ バックスラッシュ
\n 改行
\t タブ

⸻

5. ID種別推論

ID は明示的型を持たない。

5.1 推論規則

1. 演算子位置により推論する

* > > , >>? 左辺 = Artifact
* > > , >>? 右辺 = Process
* -> 左辺 = Process
* -> 右辺 = Artifact

2. front matter に明示定義がある場合はそれを優先する

3. 未確定IDは Artifact とみなす

4. 同一IDに対し Artifact / Process の矛盾が発生した場合は error とする

⸻

6. コメント

# comment

* # 以降、行末までコメントとして無視される
* quoted-id 内の # はコメントではない

⸻

7. 文区切り

statement は以下で区切られる。

* 改行
* ;

空行（連続する改行2個以上）は強制終端として扱われる。

7.1 行継続

末尾トークン (`<id>` または `]`) と継続オペレータ (`>>`, `>>?`, `->`) の間に
改行が入っても、同一 statement として扱う。

* 改行は最大1個まで（途中に空行があれば終端）
* 改行と継続オペレータの間にコメント行を挟んでもよい（コメントは改行カウントをリセット）
* 継続オペレータを行末に置くこと（例: `A >>\n P -> B`）は禁止 — 行頭オペレータのみ継続合図

例:

```pfdsl
[a, b, c]
  >> proc -> result      # OK: 末尾 ] の後改行→行頭 >>

A >> P
  -> B                   # OK: 末尾 ID(P) の後改行→行頭 ->

[a, b]
# 注釈
  >> proc -> result      # OK: コメント挟みは継続

[a, b]

  >> proc -> result      # NG: 空行で強制終端

A >>
  P -> B                 # NG: 行末オペレータ
```

⸻

8. 構文

<graph> ::= <statement> (<separator> <statement>)* <separator> ::= newline{2,} | ';' <statement> ::= <chain> | <edge>

(注) 末尾トークンと継続オペレータの間の単一改行は statement separator
ではなく行継続として扱う (§7.1)。

<chain> ::= <artifact-expr> <input-op> <process-id> '->' <artifact-expr>
( <input-op> <process-id> '->' <artifact-expr> )*

<edge> ::= <artifact-expr> <input-op> <process-id>
| <process-id> '->' <artifact-expr>

<input-op> ::= '>>' | '>>?'

<artifact-expr> ::= <id>
| '[' <id-list> ']'

<id-list> ::= <id> (',' <id>)*

<process-id> ::= <id> <id> ::= <bare-id> | <quoted-id>

⸻

9. 演算子意味論

9.1 通常入力

A >> P

成果物 A をプロセス P の通常入力とする。

9.2 フィードバック入力

A >>? P

成果物 A をプロセス P の補助入力とする。

9.3 出力

P -> B

プロセス P が成果物 B を生成する。

⸻

10. チェーン記法

X >> R -> Y >> S -> Z

は次と同値：

X >> R
R -> Y
Y >> S
S -> Z

チェーン構文は左から線形走査で解釈される。結合性の概念は持たない。

⸻

11. 集合記法

[a, b] >> P -> [x, y]

は次と同値：

a >> P
b >> P
P -> x
P -> y

集合は順序を持たない。zip対応は持たない。

⸻

12. グラフモデル

PFDSL は2層グラフを持つ。

12.1 Primary Graph

対象 edge：

* > >
* ->

用途：

* 到達性判定
* 制約判定
* 正規形生成
* 正準順序計算

12.2 Feedback Graph

対象 edge：

* > > ?

用途：

* 補助依存表現

Feedback Graph は Primary Graph の構造に影響しない。

⸻

13. 正規形

すべての記述は以下の edge 集合へ変換される。

* Artifact >> Process
* Artifact >>? Process
* Process -> Artifact

edge集合は順序を持たない。

⸻

14. 正準順序（推奨）

フォーマッタ・diff用途のため、正規形 edge は以下キー順で安定ソートする。

14.1 第1キー：連結成分順

Primary Graph の各連結成分について、その成分に属する node ID の辞書順最小値が小さい成分を先に出力する。

14.2 第2キー：ランク順

ランク計算は Primary Graph のみを対象とする。

各 node の rank を以下で定義する。

* source Artifact = 0
* Process = 入力 Artifact rank の最大値 + 1
* 出力 Artifact = 生成 Process rank + 1

edge は接続 node の rank に基づき昇順に整列する。

14.3 第3キー：edge種別順

同ランク内では以下順とする。

1. > >
2. > > ?
3. ->

14.4 第4キー：辞書順

同順位では node ID の辞書順とする。

14.5 Feedback edge

> > ? は rank 計算に含めず、接続先 Process の rank に従って配置する。

⸻

15. 制約

15.1 単一生成元制約

Primary Graph において、同一 Artifact を複数 Process が生成してはならない。

15.2 プロセス完全性制約

各 Process は少なくとも1入力・1出力を持つ。

15.3 フィードバック妥当性制約

A >>? P

は P に対する再入力・改善入力・補助入力として意味的に解釈可能であることが望ましい。

strict mode では、A が Primary Graph 上で P に関連する到達可能成果物であることを追加制約として検査してよい。

15.4 重複 edge

同一 edge の重複記述は冗長であり無視してよい。

15.5 parts 制約

artifact.C.parts = [Ca, Cb]

において：

* C と Ca/Cb はすべて Artifact でなければならない
* Process ID を parts に含めてはならない
* 自己参照は error
* parts 循環参照は error としてよい

⸻

16. エラー方針

strict mode を標準とする。

* 構文不正: error
* 型矛盾: error
* 単一生成元違反: error
* 不正YAML: error
* 不正parts参照: error
* 重複edge: warning可

⸻

17. 例

17.1 基本例

req >> design -> spec
spec >> impl -> code
code >> test -> release

17.2 フィードバック

code >> review -> issues
issues >>? impl -> code

17.3 集合

[a, b] >> merge -> c

17.4 parts

Ca >> merge -> C
Cb >> merge -> C

front matter:

artifact:
C:
title: 統合成果物
parts: [Ca, Cb]

⸻

18. 設計原則

* 成果物中心
* プロセスは純粋関数
* 暗黙依存禁止
* 人間可読な糖衣構文
* 機械処理可能な正規形
* IDと表示名の分離
* 生成関係と構造関係（parts）の分離
* 手編集しやすいファイル形式
* 差分安定性重視
* 実装互換性重視

⸻

19. バージョン

本仕様は PFDSL仕様書 v0.0.2 とする。

v0.0.1 からの主な変更点：

* Artifact に parts 構造を追加
* Primary / Feedback 二層グラフを明文化
* 正準順序にランク順を追加
* front matter の artifact / process 定義を整理
* lexer規則を明文化
* 表示名分離方針を明文化
