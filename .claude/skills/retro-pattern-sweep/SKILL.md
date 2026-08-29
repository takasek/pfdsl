---
name: retro-pattern-sweep
description: |
  Use to sweep .pfdsl/bindings/pfd-retro-patterns/ for the drift a per-cycle
  additions-only discipline never revisits on its own — patterns whose trap
  is now machine-enforced, near-duplicate pairs that should have merged, a
  `具体例:` pointing at a mechanism that no longer exists, a missing
  `phase: pre-artifact` flag, tag-vocabulary drift, and semantic
  misclassification or internal inconsistency. Invoke when `make
  release` refuses because the retro-pattern sweep gate is overdue, when
  `make release-status` reports the sweep threshold exceeded, or when asked
  to sweep or audit the retro-pattern catalog.
---

# retro-pattern カタログの sweep

`.pfdsl/bindings/pfd-retro-patterns/` は毎サイクルの追記でしか触られない。
追記の規約自体は健全でも、集合として溜まったものを洗い直す工程がどこにも無いと、廃止すべきパターン・統合すべき近接ペア・ズレた `具体例:` が黙って残り続ける（#879）。
このスキルはその洗い直しを6工程で手順化する。

発火条件は `scripts/lib/asset-sweep.mjs` の `SWEEP_TARGETS` が持つ閾値（追加ファイル数）。
`node scripts/check-asset-sweep.mjs` が現在の状態を判定する。

## 読む範囲を絞る

カタログ全件を毎回読み直さない。前回 sweep の commit は `docs/asset-sweep/retro-patterns.json` が持っているので、そこからの追加分を機械列挙できる。

```sh
cat docs/asset-sweep/retro-patterns.json   # 無ければ初回（下記の初回分岐へ）
git diff --name-only --diff-filter=A --no-renames <前回 sweep commit> HEAD -- .pfdsl/bindings/pfd-retro-patterns/
```

このファイルが存在しないことは初回を意味する（`docs/asset-sweep/README.md`）。
先回りして空のレコードを置く運用ではないので、不在は異常ではない。

工程3・4・5・6（`具体例:` の参照実在・`phase:` 宣言漏れ・タグ語彙・所属と内部論理）は、この追加分だけを対象にしてよい。
工程2（統合）は追加分を起点に `near` を引くので、返ってきた既存パターンは範囲外でも開く。
工程1（機械化による廃止）だけは追加分の外に出る — 廃止対象は古いパターンのほうであり、前回 sweep 以降に**機械化されたもの**が引き金になる。
`git log --oneline <前回 sweep commit>..HEAD -- scripts/ hooks/ .claude/settings.json` で機構が増えたコミットを列挙し、それが潰した trap を持つパターンを探す。
記録が無い（初回）場合は6工程すべてでこの絞り込みが効かず、対象はカタログ全件になる。
工程1の機構コミットからの逆引きも起点を持たないため、初回だけは全件の `具体例:` を読んで機械化済みかを判定する経路になる。

明示的に「全件意味監査」を依頼された回は、記録の有無や追加件数にかかわらず工程6だけは全件を対象にする。
対象一覧は次のコマンドで固定し、その出力を上から1ファイルずつ開いて判定する。

```sh
rg --files .pfdsl/bindings/pfd-retro-patterns -g '*.md' | LC_ALL=C sort
```

## 1. 機械化により廃止できるパターンを探す

廃止条件・廃止の契機・廃止の方法は `.pfdsl/bindings/pfd-retro.md`「パターンを改訂・統合・廃止するとき」が一次情報。
ここには複製しない。
同じ節は「廃止の契機は機械化したサイクル自身であり、定期棚卸しでその日を待たない」とも定めている — これと矛盾しないのは、この工程が拾うのがその契機を逃した分だけだからである（同節の末尾がこの工程へ回している）。
各パターンの `具体例:` を読み、そこで説明されている trap が、その後の変更で機械的に検出・禁止されるようになっていないかを確認する。

## 2. 近接ペアを統合する

```sh
node scripts/retro-patterns.mjs near --word <固有語>
```

渡す語の選び方（固有語を渡す・一般語では順位が沈む）は同じ binding の「パターンを追記するとき」が一次情報。
ただしその節が言う「草案の固有語」は追記の文脈の語であり、sweep には草案が無い — sweep では対象パターン（追加分、初回は全件）のパターン名と `具体例:` に出てくる固有名詞がその位置に来る。
既存パターン同士の総当たりではなく、その固有名詞を1つずつ渡して近さを見る（`--word` は複数回指定できる）。
上位に返ったペアを実際に開き、同じ問いの構造を2ファイルへ分けたままにする理由が無いなら統合する。

## 3. `具体例:` が参照する機構の実在を確認する

各パターンの `具体例:` がスクリプト・チェック・コマンド・ファイルパスを名指ししている箇所を洗い出し、リポ内に実在するか `grep` で突き合わせる。
リネーム・統合・削除で消えた参照は、パターン本文を現在の名称に直すか、参照ごと落とす。

## 4. `phase: pre-artifact` の宣言漏れを判定する

各パターンの対策が効く時点（着手前・成果物を書く前か、実装後・レビュー時・retro 時でも直せるか）を読み、`phase: pre-artifact` の frontmatter が実際の対策と一致しているかを人手で判定する。
判定基準は同じ binding の「パターンを追記するとき」にある判定文がそのまま使える。

## 5. タグ語彙の drift を見る

```sh
node scripts/retro-patterns.mjs tags
```

件数1のタグ・見慣れない prefix・軸として成立していなさそうな値を洗い出す。
正準リストは無いので「乖離」ではなく、そのタグが本当に発火条件を表しているかを個別に判定する。

## 6. 所属と内部論理を監査する

対象パターンごとに次の9観点を表へ記録し、各欄を「妥当」「finding」「保留」のいずれかで判定する。
この表を定期 sweep と変更時の diff-scoped 意味レビューに共通する正準チェックリストとし、binding 側へ観点や問いを複製しない。

| 観点 | 判定する問い |
|---|---|
| 定義 | 冒頭の定義文は1つの再発可能な trap を述べ、後続の問い・具体例・対策と同じ失敗を指しているか |
| 所属 | 具体例はその定義の実例であり、別パターンへ所属すべき失敗を便宜的に統合していないか |
| 検出 | `問いの形:` は定義した trap の有無を判別でき、単なる注意喚起や別の失敗の問いになっていないか |
| 対策 | `対策:` は原因へ作用し、具体例だけを塞ぐ局所策や結果の確認だけになっていないか |
| 境界 | 近接パターンとの違いを具体的な失敗条件で説明でき、同じ問いの構造を重複保持していないか |
| タグ | 各タグは具体例の場所や対策でなく、このパターンを読むべきサイクルの発火条件を表すか |
| 時点 | `phase: pre-artifact` の有無は対策が効く最後の時点と一致するか |
| 証拠 | 断定の強さは記録された観測・測定の範囲を超えていないか |
| 肥大 | 1ファイルへ複数の独立した失敗型を抱え込み、片方だけが発火するサイクルで読まれにくくなっていないか |

所属・境界・肥大の判定では `near --word <固有語>` を補助に使ってよいが、語彙の類似度で意味分類を自動決定してはならない。
機械検査が証明するのは解析可能性・ファイル名・タグ有無・往復一致等の構造だけであり、定義への所属や論理的一貫性はこの表を使った人手判断である。

## 各工程の直後に検査する

```sh
node scripts/retro-patterns.mjs check
```

ファイルを削除・統合・書き換えた工程（1〜6 のいずれも該当しうる）の直後に回す。
解析可否・ファイル名の書式・タグ有無・往復一致に加え、`.pfdsl/bindings/pfd-retro.md` の bash ブロックの例が実サブコマンドと一致するかも見る。
最後にまとめて回すと、どの工程の編集が壊したかを切り分ける手戻りが出る。
`make check-docs` からも走るが、そこまで持ち越すと同じ切り分けを後でやることになる。

## 記録する

結果を `docs/asset-sweep/<YYYY-MM-DD>-retro-patterns.md` に書く。
何を廃止・統合・修正したか、工程6の各対象について9観点の判定、finding、判定に迷って手を付けなかった項目とその保留理由を含める。

記録の2コミット手順は `docs/asset-sweep/README.md`「記録の確定」が一次情報。1コミット目には工程1〜6 のカタログ変更と実行記録を含め、2コミット目で `docs/asset-sweep/retro-patterns.json` を確定する。

実行記録の冒頭に、前回の記録の `date` からの日数と、その間に追加されたファイル数を書く。
閾値は「実際の発火間隔を観測したら見直す」前提の値だが、その間隔を数える工程は他にどこにも無い — ここで残さないと、閾値は一度も見直されないまま回り続ける。
間隔が閾値の意図（数日〜数週間に1回）から外れていたら、`SWEEP_TARGETS` の `threshold` を実測で置き換える。
初回は前回が無いので、代わりにカタログが1ファイル1パターンになった日からの日数を書く（その日は `git log --diff-filter=A --format=%ad --date=short -- .pfdsl/bindings/pfd-retro-patterns/ | tail -1` で引ける）。

## このスキルを配布しない理由

利用側リポは `.pfdsl/bindings/pfd-retro-patterns/` を持たないので、この手順には実施先が無い。
`scripts/lib/gen-plugin.mjs` の `PLUGIN_SKILL_DIRS` に載せなければ配布されない — `distribution-review` / `spec-stress-test` / `vscode-ext-debug` と同じ扱い。
