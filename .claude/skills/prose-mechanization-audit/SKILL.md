---
name: prose-mechanization-audit
description: |
  Use to sweep this repo's prose assets (skills, commands, agents, `.pfdsl`
  companions and bindings, CLAUDE.md) against the mechanism ledger that hooks
  and check scripts actually form — prose still teaching a discipline a hook
  now enforces, prose re-explaining what a script already prints, the same
  paragraph restated within one layer, and prose whose taught command form a
  guard now denies. Invoke when `make release` refuses because the
  prose-mechanization sweep gate is overdue, when `make release-status`
  reports that threshold exceeded, or when asked to audit the prose assets
  against the hooks and checks.
---

# 散文資産と機械化台帳の突合 sweep

pfd-ops SKILL.md 運用プロトコル6「散文として書く前に機械化を検討する」は**書く時点**の規律であり、既に書かれて堆積した散文を洗う工程はどこにも無い。
このスキルがその工程になる（#915）。
機構が1つ増えるたびに、それを語っていた散文・それが禁じる形を教えている散文が黙って陳腐化する — 増えるのは機構の側なので、増分は機構の追加件数で数える。

発火条件は `scripts/lib/asset-sweep.mjs` の `SWEEP_TARGETS`（`id: prose-mechanization`）が持つ閾値。
`node scripts/check-asset-sweep.mjs` が現在の状態を判定する。

## 対象

- **散文資産**: `.claude/skills/`・`.claude/commands/`・`.claude/agents/`・`.pfdsl/*.md`・`.pfdsl/bindings/*.md`・`CLAUDE.md`
- **機械化台帳**: `.claude/settings.json` が配線する hook と `scripts/` の実体

`.pfdsl/bindings/pfd-retro-patterns/` は `retro-pattern-sweep` の担当なので、ここでは扱わない。
`docs/spec/` は規範であって運用散文ではないため対象外。

## 読む範囲を絞る

前回 sweep の commit は `docs/asset-sweep/prose-mechanization.json` が持つ。

```sh
cat docs/asset-sweep/prose-mechanization.json   # 無ければ初回（下記の初回分岐へ）
```

このファイルが存在しないことは初回を意味する（`docs/asset-sweep/README.md`）。
先回りして空のレコードを置く運用ではないので、不在は異常ではない。

工程1 は毎回全件を実測する（台帳は小さく、差分で追うと配線だけ変わった機構を見落とす）。
工程2 と工程5 は前回 sweep 以降に**増えた機構**を起点にする — 陳腐化させた側が新しい機構のほうであり、散文は古いまま動かないからである。

```sh
git diff --name-only --diff-filter=A --no-renames <前回 sweep commit> HEAD -- scripts/ hooks/ \
  | grep -E '^(scripts|hooks)/[^/]+\.mjs$' | grep -v '\.test\.mjs$'
```

絞り込みはゲートが数える単位に合わせる（`scripts/lib/` と `*.test.mjs` は機構を増やさない — 一次情報は `SWEEP_TARGETS` の `matches`）。
素の `-- scripts/ hooks/` で見ると、1つの check を実装分割しただけの refactor が機構3件に見える。

工程3 と工程4 は散文側の変更分を起点にしてよい。

```sh
git diff --name-only <前回 sweep commit> HEAD -- .claude/skills/ .claude/commands/ .claude/agents/ \
  .pfdsl/ CLAUDE.md ':!.pfdsl/bindings/pfd-retro-patterns'
```

除外指定を落とすと、`retro-pattern-sweep` の担当であるカタログ（66件規模）が差分を埋め尽くす。

記録が無い（初回）場合は工程2〜5 でこの絞り込みが効かず、対象は散文資産の全件になる。

記録が無い（初回）場合はこの絞り込みが効かないので、全件を対象にする。

## 1. hook / check 台帳を実測で列挙する

一次情報は `.claude/settings.json` の配線と `scripts/` の実体のみ。
issue の「見送り」「実装予定」の記述を台帳の代わりに読まない — 現物より遅れる（#650 で見送りとされた候補 C・D・H・I が後続サイクルで実装済みだった）。

```sh
node -e 'const s=JSON.parse(require("fs").readFileSync(".claude/settings.json","utf8"));
for (const [event, entries] of Object.entries(s.hooks))
  for (const e of entries)
    for (const h of e.hooks) console.log(event, e.matcher ?? "*", h.command);'
ls scripts/check-*.mjs
```

各機構について「何を検出し、deny / ask / advisory のどれで返すか」「メッセージが運ぶ情報は何か」を1行で書き出す。
この1行が以降4工程すべての突合材料になるので、実際の出力文言まで見る（regex や条件式だけを読んで挙動を要約しない）。

## 2. 機械化済み対策を語る散文を検出する

台帳の各機構について、その機構が既に強制している規律を、散文がなお「気をつけて守れ」の形で説明していないか探す。
判定は**残すか消すかの二択ではない**。機構の出力文言が全情報を運ぶなら散文は削除し、運ばない残余（機構が拾えない範囲・deny された後にどう直すか）だけを残す。
どちらかを選ぶ前に機構を実際に走らせて出力を読む — 文言を推測したまま「hook が言うから消せる」と判断すると、消した情報がどこにも無くなる。
`.pfdsl/bindings/pfd-retro-patterns/unverified-precedent-style.md` の問い（先例の形だけを写して、その先例が下した判断を確認していないか）をこの工程に組み込む。

## 3. スクリプト出力を再説明する散文を検出する

散文が、スクリプトが実行時に自分で印字する内容（項目名・判定条件・フィールドの意味）を先回りして列挙していないか探す。
列挙は実装が変わるたび手で追随することになり、追随を保証する機構は無い（#560）。
該当したら、散文からは一次情報の所在（どのファイルのどの定数・どの JSDoc が持つか）だけを指し、内容の複製を落とす。
落とせない残余は「実行前に知っている必要がある入力契約」だけである — この区別が付かないうちは落とさない。

## 4. 層内の同文再掲を検出する

同じ層（スキル本文どうし・companion どうし・binding どうし）に、同じ規律を述べた段落が複数箇所へ写されていないか探す。

```sh
node scripts/retro-patterns.mjs near --word <固有語>
```

`near` はパターンカタログ向けだが、渡す語の選び方（草案そのものの固有語を渡す・一般語では順位が沈む）は同じである。
カタログ外の散文には使えないので、こちらは各層で特徴的な語を `git grep -n` で当てて重複箇所を数える。
複数箇所に同じ規律がある場合、**どれが一次情報かを決めてから**残りをポインタへ落とす。
決めずに1箇所を消すと、残った側が一次情報を主張できないまま参照されることになる。

## 5. 散文と機械の矛盾を検出する

散文が教えるコマンド形・手順を、hook が deny / ask しないか確かめる。
散文の中のコマンド例を実際に台帳の guard へ当てる。
guard が読むのは生のコマンド行ではなく hook の payload なので、`{"tool_name":"Bash","tool_input":{"command":"<散文が教えるコマンド>"}}` を標準入力へ渡す。
判定が出なければ allow である（guard は allow のとき何も印字しない）。
実例: work-cycle.md が教えていた `gh issue view --comments` の形は本文を返さないため、そのまま従うと設計確定コメントは読めても本文を読み落とす（#912）。
矛盾を見つけたら、散文と機構のどちらが正しいかを決める — 散文を直すとは限らない。

## 各工程の直後に検査する

```sh
node scripts/check-md-linebreaks.mjs
make check-docs
```

散文を削除・ポインタ化・書き換えた工程の直後に回す。
最後にまとめて回すと、どの工程の編集が壊したかを切り分ける手戻りが出る。
散文を消す編集では `check-companion-bindings`（必須見出しの実在）と `check-entry-path-headings` が特に落ちやすい — 一次情報へのポインタだけを残したつもりで、見出しごと落としている場合がある。

## 記録する

結果を `docs/asset-sweep/<YYYY-MM-DD>-prose-mechanization.md` に書く。
何を削除・ポインタ化・修正したか、判定に迷ったが手を付けなかった項目とその理由を含める。

記録は2コミットに分ける。

1. 工程1〜5 の散文変更と実行記録の `.md` をコミットする。
2. `docs/asset-sweep/prose-mechanization.json` に `commit`（1 のコミットの40桁 sha）・`date`（`YYYY-MM-DD`）・`log`（実行記録の `.md` のファイル名）を書き、これを2つ目のコミットにする（`docs/distribution-review/reviewed.json` と同じ形。初回はファイルごと新規作成する）。

`commit` に書くのは sweep 済みの状態を指す sha であり、それを書いているコミット自身ではない — 自己言及になるため分けている。
2つ目のコミットは `scripts/`・`hooks/` を触らないので、記録した sha 以降に機構の追加は発生せず、ゲートは緑のままになる。
2 をコミットする前に `node scripts/check-asset-sweep.mjs` が exit 0 を返すことを確認する（このスクリプトは作業ツリーの json を読み、記録した sha から HEAD までの追加を数えるため、json を書いた時点で判定できる）。

実行記録の冒頭に、前回の記録の `date` からの日数・その間に追加された機構の件数・本回の findings 件数を書く。
閾値 20 は「1回の sweep で期待 findings ≒ 1.2件」を根拠に置いた値だが、その歩留まりを実測し直す工程は他にどこにも無い — ここで残さないと閾値は一度も見直されないまま回り続ける。
findings が0件の回が続くなら閾値を上げ、毎回大量に出るなら下げる。
初回は前回が無いので、代わりに #915 のマージ日からの日数を書く。

## このスキルを配布しない理由

利用側リポは突合の片側である hook・check 台帳を持たない — `scripts/lib/gen-plugin.mjs` が配る `trees` / `files` / `whole` の一覧に `scripts/` も `.claude/settings.json` も入っていない。
散文の側は事情が違い、`pfd-ops` 等の配布スキル本文は利用側リポにも実体として届く。
ただしそれらの上流はこのリポであり、利用側で編集する経路が無いので、突合して直す工程はこちら側にしか置けない。
`scripts/lib/gen-plugin.mjs` の `PLUGIN_SKILL_DIRS` に載せなければ配布されない — `retro-pattern-sweep` / `distribution-review` / `spec-stress-test` / `vscode-ext-debug` と同じ扱い。
