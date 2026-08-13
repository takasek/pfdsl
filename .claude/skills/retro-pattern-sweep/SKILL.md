---
name: retro-pattern-sweep
description: |
  Use to sweep .pfdsl/bindings/pfd-retro-patterns/ for the drift a per-cycle
  additions-only discipline never revisits on its own — patterns whose trap
  is now machine-enforced, near-duplicate pairs that should have merged, a
  `具体例:` pointing at a mechanism that no longer exists, a missing
  `phase: pre-artifact` flag, and tag-vocabulary drift. Invoke when `make
  release` refuses because the retro-pattern sweep gate is overdue, when
  `make release-status` reports the sweep threshold exceeded, or when asked
  to sweep or audit the retro-pattern catalog.
---

# retro-pattern カタログの sweep

`.pfdsl/bindings/pfd-retro-patterns/` は毎サイクルの追記でしか触られない。
追記の規約自体は健全でも、集合として溜まったものを洗い直す工程がどこにも無いと、廃止すべきパターン・統合すべき近接ペア・ズレた `具体例:` が黙って残り続ける（#879）。
このスキルはその洗い直しを5工程で手順化する。

発火条件は `scripts/lib/asset-sweep.mjs` の `SWEEP_TARGETS` が持つ閾値（追加ファイル数）。
`node scripts/check-asset-sweep.mjs` が現在の状態を判定する。

## 読む範囲を絞る

全61件を毎回読み直さない。前回 sweep の commit は `docs/asset-sweep/retro-patterns.json` が持っているので、そこからの追加分を機械列挙できる。

```sh
node -e 'console.log(JSON.parse(require("fs").readFileSync("docs/asset-sweep/retro-patterns.json","utf8")).commit)'
git diff --name-only --diff-filter=A --no-renames <前回 sweep commit> HEAD -- .pfdsl/bindings/pfd-retro-patterns/
```

工程3・4・5（`具体例:` の参照実在・`phase:` 宣言漏れ・タグ語彙）は、この追加分だけを対象にしてよい。
工程2（統合）は追加分を起点に `near` を引くので、返ってきた既存パターンは範囲外でも開く。
工程1（機械化による廃止）だけは追加分の外に出る — 廃止対象は古いパターンのほうであり、前回 sweep 以降に**機械化されたもの**が引き金になる。
`git log --oneline <前回 sweep commit>..HEAD -- scripts/ hooks/ .claude/settings.json` で機構が増えたコミットを列挙し、それが潰した trap を持つパターンを探す。
記録が無い（初回）場合はこの絞り込みが効かないので、全件を対象にする。

## 1. 機械化により廃止できるパターンを探す

廃止条件・廃止の契機・廃止の方法は `.pfdsl/bindings/pfd-retro.md`「パターンを改訂・統合・廃止するとき」が一次情報。
ここには複製しない。
各パターンの `具体例:` を読み、そこで説明されている trap が、その後の変更で機械的に検出・禁止されるようになっていないかを確認する。

## 2. 近接ペアを統合する

```sh
node scripts/retro-patterns.mjs near --word <固有語>
```

渡す語の選び方（草案そのものの固有語を渡す・一般語では順位が沈む）は同じ binding の「パターンを追記するとき」が一次情報。
既存パターン同士の総当たりではなく、パターン名や `具体例:` に出てくる固有名詞を1つずつ渡して近さを見る。
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

## 記録する

結果を `docs/asset-sweep/<YYYY-MM-DD>-retro-patterns.md` に書く。
何を廃止・統合・修正したか、判定に迷ったが手を付けなかった項目とその理由を含める。
`docs/asset-sweep/retro-patterns.json` の `commit` / `date` / `log` を更新する（`docs/distribution-review/reviewed.json` と同じ形）。
`node scripts/check-asset-sweep.mjs` が exit 0 になることを確認してコミットする。

実行記録の冒頭に、前回の記録の `date` からの日数と、その間に追加されたファイル数を書く。
閾値は「実際の発火間隔を観測したら見直す」前提の値だが、その間隔を数える工程は他にどこにも無い — ここで残さないと、閾値は一度も見直されないまま回り続ける。
間隔が閾値の意図（数日〜数週間に1回）から外れていたら、`SWEEP_TARGETS` の `threshold` を実測で置き換える。初回は前回が無いので、代わりにカタログが1ファイル1パターンになった日からの日数を書く。

## このスキルを配布しない理由

利用側リポは `.pfdsl/bindings/pfd-retro-patterns/` を持たないので、この手順には実施先が無い。
`scripts/lib/gen-plugin.mjs` の `PLUGIN_SKILL_DIRS` に載せなければ配布されない — `distribution-review` / `spec-stress-test` / `vscode-ext-debug` と同じ扱い。
