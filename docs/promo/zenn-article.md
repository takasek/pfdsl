---
title: "8行のテキストから「次にやること」を計算できる工程図が生える — pfdsl 入門"
emoji: "🧭"
type: "tech"
topics: ["pfdsl", "graphviz", "cli", "projectmanagement", "ai"]
published: false
---

<!-- 図版は docs/promo/assets/ にある SVG を PNG 化して Zenn にアップロードし、URL を差し替える。 -->
<!-- 掲載している CLI 出力はすべて @pfdsl/cli 0.0.21 の実出力。 -->

計画は、作った瞬間から腐り始めます。
作図ツールで描いた工程図は、現実が変わっても誰も直しません。
TODO リストは並び順しか持たないので、「なぜこの順なのか」「どれが何をブロックしているのか」という一番大事な情報を失います。
最近だと、AI にプランを立てさせるケースも増えました。Markdown の箇条書きで立派なプランが返ってきますが、方向転換した瞬間に前提が崩れて、結局は書き捨てになります。

この記事で紹介する **pfdsl** は、この問題への一つの答えです。
計画を「絵」ではなく「コード」として書きます。
コードなので、検査でき、diff でき、そして「次にやるべきこと」を計算できます。

https://github.com/takasek/pfdsl

## 覚える記法は実質1行

```
requirements >> design -> spec
```

「requirements を入力に、design というプロセスが spec を出力する」と読みます。
成果物（モノ）は `>>` でプロセス（コト）に入り、プロセスは `->` で成果物を出す。それだけです。
これは XDDP（派生開発）で知られる PFD（Process Flow Diagram）— 成果物とプロセスの依存グラフで仕事を設計する手法 — をプレーンテキストで書けるようにした DSL です。

## 触ってみる: 8行でリリース計画を書く

```bash
npm install -g @pfdsl/cli
```

プロダクトをリリースするまでの計画を書いてみます。`launch.pfdsl` という名前で保存します。

```
product_idea >> define_requirements -> requirements
user_interviews >> define_requirements
requirements >> write_design -> design_doc
design_doc >> implement -> implementation
implementation >> run_tests -> test_report
requirements >> build_landing_page -> landing_page
test_report >> ship -> release
landing_page >> ship
```

これで図が出ます。

```bash
pfdsl graph launch.pfdsl --format svg > launch.svg
```

![8行のテキストから生成された工程図](/images/pfdsl-intro-01-plain.png)
*角丸なしの矩形が成果物、楕円がプロセス。外部から与えられる入力と最終成果物は太枠になる。*

レイアウトは Graphviz が計算するので、矢印の引き回しに悩む時間はゼロです。
テキストを直せば図が変わる。図と現実が乖離する隙がありません。

## 計画そのものを lint する

ここからが作図ツールとの分かれ道です。壊れた計画を書いてみます。

```
spec >> design -> spec
draft >> review
```

```bash
$ pfdsl check broken.pfdsl
broken.pfdsl:1:1: error [V003]: Process 'review' has no outputs
broken.pfdsl:1:1: error [V010]: Primary graph contains a cycle involving 'design' → 'spec'
```

「このプロセス、何も生み出していなくない？」「これ循環していない？」を機械が指摘してくれます。
ホワイトボードに描いた工程図では、この種の計画バグはレビューする人の目力に頼るしかありませんでした。
`--audit` を付ければ、終端成果物（＝このプロジェクトの最終ゴール）と外部入力の一覧も出ます。ゴールが2つある計画や、どこからも作られない成果物は、この時点で気付けます。

## 図が生きた進捗盤になる

成果物にステータス（todo / wip / done / waiting / suspended）を付けると、ただの図が進捗盤に変わります。

```yaml
---
type: roadmap
statusStyles:
  done: { fillcolor: "#d4edda", style: filled }
  wip:  { fillcolor: "#fff3cd", style: filled }
  todo: { fillcolor: "#f8f9fa", style: filled }
artifact:
  product_idea: { status: done }
  user_interviews: { status: done }
  requirements: { status: done }
  design_doc: { status: todo }
  # ...
---
product_idea >> define_requirements -> requirements
# （エッジ定義は先ほどと同じ）
```

![ステータスで色分けされた工程図](/images/pfdsl-intro-02-status.png)
*done は緑、wip は黄、todo はグレー。色もスタイルも自分で定義できる。*

そして、ここが pfdsl の一番気持ちいいところです。**「今なにをやるべきか」を計算で出せます。**

```bash
$ pfdsl ready launch.pfdsl --best
Ready processes (2):
  * write_design         "write_design"   inputs: [requirements]
    build_landing_page   "build_landing_page"   inputs: [requirements]

* = recommended next (removes the last blocker for the most downstream processes)
```

入力が全部揃っているプロセスだけが「着手可能」として列挙され、`*` は「最も下流のブロッカーを外す一手」の推薦です。
作業を終えたら1コマンドで記録します。

```bash
$ pfdsl status-set launch.pfdsl design_doc done
newly ready: implement
```

完了を記録した瞬間に、**新しく着手可能になった作業が返ってきます。**
「終わった、次どれだっけ」とリストを眺め直す時間が消えます。依存関係を書いたのだから、次の一手はグラフから計算できる — 当たり前のことですが、絵に描いた工程図はこれをやってくれません。

## 計画がコードであるということ

プレーンテキストなので、計画が git に乗ります。

- 計画の変更履歴が残り、**計画変更が PR レビューの対象になる**
- `pfdsl diff a.pfdsl b.pfdsl` で構造の差分（ノードやエッジの増減・変化）が取れる。`--format svg` で視覚差分も出せる
- `pfdsl fmt` / `pfdsl reindex` で整形と正規化ができるので、diff がノイズで汚れない
- 主要コマンドは `--json` と終了コードを持つので、CI やスクリプトに組み込める

## AI エージェントと相性がいい理由

AI にプランを立てさせたことがある人なら、あの Markdown 箇条書きプランの寿命の短さを知っていると思います。
数時間の作業で方向が変わり、プランの前半と後半が矛盾し始め、直すより捨てて作り直すほうが早くなる。プランが「検証できない文章」だからです。

pfdsl の計画はエージェントにとって扱いやすい形をしています。

1. **機械可読**: エージェントが計画を読んで、着手可能な作業を自分で判断できる
2. **機械検証可能**: エージェントが計画を書き換えても、`check` が循環や出力のないプロセスを弾く
3. **再計算可能**: 方向転換で計画の一部を書き換えたら、`ready` が現状から次の一手を計算し直す

つまり、**変更に耐えるプランの置き場所**になります。人間はレビューで計画の形を監査し、エージェントはグラフを見て手を動かす、という分担が成立します。
VS Code 拡張（エディタ内ライブプレビュー）と Claude Code 用プラグインも用意されています。

## 開発以外の仕事にも使える

「依存関係のある成果物を積み上げる仕事」なら何でも書けます。リポジトリの [docs/examples](https://github.com/takasek/pfdsl/tree/main/docs/examples) には次のような実例が入っています。

- **本番障害対応**: トリアージ → 応急対応 → ポストモーテム。得られた知見を runbook に反映して次回対応へ還流するループを、フィードバックエッジ `>>?` で表現
- **採用プロセス**: 求人票から内定承諾までの成果物チェーン
- **書籍執筆**、**カンファレンス運営**、**契約交渉**、**ML モデル開発** など

## 1画面に収まらなくなったら

実プロジェクトで育てるための道具も揃っています。

- 成果物・プロセスに `label` / `description` / `owner` / `criteria`（完成条件）を持たせられる。`criteria` のない成果物は check が警告してくれる
- `subflow` で「このプロセスの詳細は別ファイル」と階層化できる
- グループ・タグ・スタイル定義、日本語ラベルにも対応

## はじめる

```bash
npm install -g @pfdsl/cli

pfdsl check plan.pfdsl                        # 計画を検査
pfdsl graph plan.pfdsl --format svg > plan.svg  # 図を生成
pfdsl ready plan.pfdsl --best                 # 次の一手を計算
```

- リポジトリ: https://github.com/takasek/pfdsl
- VS Code 拡張: マーケットプレイスで「PFDSL」を検索（エディタ内ライブプレビュー付き）

<!-- TODO: 方法論連載（PR #361）公開後、ここに連載へのリンクを追加する。 -->
この記事はツールの入り口だけを紹介しました。
実プロジェクトの運用（ロードマップとワークフローの分け方、エージェントとの分担、計画の育て方）については、続編の連載で掘り下げる予定です。
