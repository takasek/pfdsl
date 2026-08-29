---
name: pfd-upstream-report
summary: upstream defect report
description: |
  Use when a defect or a missing capability turns up in the distributed pfdsl
  bundle itself — a pfd-* skill body, reference, agent, command or hook whose
  wording misled the session, a pfdsl CLI or gate script that behaved wrong, or
  a capability the bundle lacks — and it should reach the upstream repository
  as an issue. Also the filing procedure pfd-retro's upstream-change rule calls
  for when a finding belongs to the distribution layer. Not for defects in the
  adopting repository's own PFDs, code or work items; those belong to pfd-ops.
---

# 上流への欠陥報告

配布された pfdsl bundle の欠陥と未対応要望を、上流リポ `takasek/pfdsl` の issue として届ける。
対象は配布物そのもの（pfd-* スキル本文・reference・agent・command・hook、pfdsl CLI、gate script）と、配布物に無い能力の要望である。
採用リポ自身の PFD・コード・作業項目の欠陥は対象外で、そちらは pfd-ops が扱う。

pfd-retro の「上流変更ルール」が配布層の finding を検出したときの起票手順でもある。

## 工程1: 実行環境の判定

**外部報告モードを既定とする。**
自リポモード（上流リポの作業ツリーにいる）へ切り替えるのは、次の両方が揃った場合に限る。

- `git remote -v` のいずれかが `takasek/pfdsl` を指す
- 工程2の環境採取が `installation` に `upstream-checkout` を返す

判定が付かなければ外部報告モードのまま進める。
remote だけを根拠にしない。
採用リポが参照用に pfdsl の remote を登録しているだけでも片方の条件は満たし、その誤判定は工程4の一般化スキップを通じて採用リポの固有名詞の公開へ直結する。
誤判定のコストは非対称であり、安全側は外部報告モードにある。

モードの差分は工程4と工程6にだけ現れる。

### `gh` の前提確認

モード判定と同じ工程で、`gh auth status --hostname github.com` が成功することを確かめる。
**ホストを省かない。**
素の `gh auth status` は設定済みの全ホストを検査するため、github.com が未認証でも別ホストの認証が通っていれば成功し、逆に github.com が正常でも無関係なホストの壊れた認証で失敗する。
報告の宛先は github.com に固定されているので、確かめるべきもそのホストだけである。

工程5の重複確認も工程6の投稿も `gh` に依存しており、**本文を組み立ててから使えないと分かるのが最も無駄が大きい**。

`gh` が存在しない、または github.com が未認証の場合はここで止め、何が足りないかをユーザーへ報告する。
本文の起草へ進まない。
別経路（ブラウザ・REST を直接叩く等）へ自分で切り替えない。

自リポモードでも起票する。
配布層の欠陥をその場で直すと、いま回しているサイクルのスコープが膨らむ。
issue へ切り出してコンテキストを区切るほうが健全である。
その場修正は選択肢として提示してよいが、既定にしない。

## 工程2: 証拠の収集

環境ブロックは pfd-ops 同梱のスクリプトが採取する。

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/pfd-ops/scripts/collect-report-environment.mjs
```

CLAUDE_PLUGIN_ROOT は plugin ロード時に実パスへ置換される変数（`${CLAUDE_PLUGIN_ROOT}` の形でのみ置換対象 — この説明文中の表記のように波括弧を外せば置換されない）。
上のコマンド行がパス置換されず変数名のまま見えている場合は plugin 外（repo-local）ロード — `node .claude/skills/pfd-ops/scripts/collect-report-environment.mjs` を使う。
**どちらも解決しない場合**（変数名のまま見えており、かつ repo-local の `.claude/skills/pfd-ops/` も存在しない）は、いま読んでいるこのファイル自身の所在から sibling の `pfd-ops/scripts/` を相対で辿る。
このファイルが読めている以上その所在は判明しており、それが3つ目の分岐になる。

出力は JSON で、`installation`（`claude-plugin` / `codex-plugin` / `repo-local` / `upstream-checkout` / `unknown`）・`pluginVersion`・`bundleContentHash`・`cliVersion`・`repoCommit`・`installProvenance`・`unavailable` を持つ。
取得できた項目と `unavailable` の全件を、そのまま issue 本文の環境ブロックへ載せる。
`unavailable` を省くと、読み手は「その導入形態では取れない」のか「採取に失敗した」のかを区別できない。

スクリプトが実行できない場合（Node が無い、bundle の部分コピーで pfd-ops が存在しない等）は、代替の採取経路を自分で組み立てず、環境ブロックに「採取できなかった」と、試したパスを書く。

### 種別ごとの追加項目

- プロンプト欠陥: bundle 内の相対パスへ正規化した該当箇所の引用と、実際にどう読まれたか
- CLI・gate script: コマンド行、最小入力、実出力、期待した出力
- 要望: 詰まった作業と、現行の回避策

## 工程3: 所在の特定

症状を「何をしようとして何が起きたか」の形で1文に確定する。
そのうえで所在（どのファイルのどの記述か、どのコマンドか）を特定する。

**探索はこのスキルが行い、利用者へ求めるのは候補の確認だけとする。**
配布物の実体パスは導入形態で変わるため、利用者に手で探させると形態ごとの知識を利用者側へ押し付けることになる。
探索の起点には工程2で解決した skill root を使う。

**修正方針の判断は求めない。**
「プロンプトが CLI の挙動を誤って説明している」型では、プロンプトと CLI のどちらを直すかが上流の設計判断であり、報告側は食い違いの指摘までしか行えない。
所在を特定できなかった場合は症状のまま出し、特定できなかったことを本文へ明記する。

## 工程4: 一般化（外部報告モードのみ）

採用リポの固有名詞（リポ名・ファイル名・ドメイン語彙・issue タイトル・PFD の中身）を抽象形へ置換した本文を作る。
**既定は一般化とする。**
生の抜粋が再現に必須の箇所は「生で載せる候補」として列挙し、利用者へ個別に確認を取る。
利用者が承認した箇所だけを生のまま残す。

自リポモードではこの工程を行わない。
隠す相手がおらず、具体名詞があるほうが修正しやすい。

## 工程5: 重複確認

単一の語による1回の検索では取りこぼす。

- 症状・コマンド名・診断メッセージ・該当パスなど複数の語で `gh issue list --repo takasek/pfdsl --search <語> --state all --limit 50` を引く
- open と closed の両方を対象にする（`--state all`）
- `--limit` を既定値任せにしない

**ヒットを同一と決めない。**
候補として提示し、同一性の判断は利用者が行う。
語の一致だけでコメントへ倒すと、別問題の issue へ誤投稿する。

同一と判断された場合は新規起票ではなく既存 issue へのコメントとする。
コメントも本文の承認と、工程6の readback の対象になる。

検索自体が失敗した場合（ネットワーク不通・レート制限・read 権限の不足）は、**重複確認を省いて起票へ進まない。**
何が失敗したかを報告して止まる。
重複の有無が分からないまま起票すると、既存 issue の分岐を増やす。

## 工程6: 承認と投稿

本文の全文を提示し、明示の承認を待つ。
承認なしに投稿しない。

投稿は pfd-ops の `references/github-issues-backend.md`「複数行本文の外部書込み」規約に従う。
新規起票と既存 issue へのコメントで、write と readback の対象が違う。

まず一時パスを2つ用意する。
`mktemp` が一意な名前を作るので、並行セッションと衝突しない。

```bash
body_path="$(mktemp)"
readback_path="$(mktemp)"
```

承認された本文を `"$body_path"` へ書き、タイトルを `title` へ入れる。
**山括弧のプレースホルダをそのままシェルへ貼らない** — `> <readback.json>` は `<` が入力リダイレクトとして解釈されて parse error になり、引用のないパスは空白・glob・先頭 `-` を含むと argv が壊れる。

新規起票:

```bash
issue_url="$(gh issue create --repo takasek/pfdsl --title "$title" --body-file "$body_path")"
issue_number="${issue_url##*/}"
gh issue view "$issue_number" --repo takasek/pfdsl --json body,url > "$readback_path"
```

既存 issue へのコメント（`issue_number` は工程5で同定した issue の番号）:

```bash
comment_url="$(gh issue comment "$issue_number" --repo takasek/pfdsl --body-file "$body_path")"
comment_id="${comment_url##*issuecomment-}"
gh api "repos/takasek/pfdsl/issues/comments/$comment_id" > "$readback_path"
```

**`gh issue view --json comments` の一覧から似た本文を拾って代用しない。**
規約はこの読み方を明示的に禁じている。
一覧は自分が今書いたコメントを同定できず、他の誰かの似た本文を通してしまう。

どちらの経路でも、最後に JSON の `body` を decode して正本ファイルと比較する。

```bash
node -e 'const fs=require("node:fs");const persisted=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).body;const canonical=fs.readFileSync(process.argv[2],"utf8");if(persisted!==canonical){console.error("readback mismatch");process.exit(1)}' "$readback_path" "$body_path"
```

**`--jq .body` でシェルへ取り出して比較しない。**
`--jq` は本文を端末向けテキストとして出力し終端に改行を足すため、body 自身の末尾改行と出力の区切りを区別できない。
コマンド置換で受けると今度は末尾改行がすべて剥がれる。
どちらも「改行を含めて完全一致」を確かめられない。
JSON のまま保存して decode する経路だけが、改行を保ったまま比較できる。

一致しなければ成功として扱わず停止する。
**コマンドの成功表示や返された URL は persisted body の証拠にならない。**

一致を確認できたら `"$body_path"` と `"$readback_path"` を削除する。
失敗して停止した場合は消さない — `"$body_path"` は手動投稿の入力として要る。

ラベルは外部報告モードでは付けない。
外部利用者に write 権限がなく、付与を試みれば失敗する。
仕分けは上流メンテナが行う。

自リポモードの起票後処理は pfd-ops の GitHub Issues バックエンドへ委譲する。
ラベル判定基準・判定タイミング・roadmap 追加の要否・ラベル付与の確認要否はいずれも `github-issues-backend.md` が規定しており、ここには複製しない。

工程1の前提確認を通っていても、投稿の時点で失敗することがある（write 権限の不足、レート制限、issue が無効化されたリポ）。
その場合は本文ファイルのパスと手動投稿コマンドを提示して停止する。
**別経路への迂回を自分で決めない。**

## issue 本文の形式

タイトルは上流の慣例に合わせ `<type>(<scope>): <症状>` とする。
scope は所在の由来（`pfd-ops` / `pfd-retro` / `cli` 等）を用いる。
所在を特定できなかった場合は scope を省略する。

本文は次の順に並べる。

- 症状（1〜2文）
- 環境（工程2の出力。`unavailable` を含む）
- 再現手順、または該当箇所
- 期待した挙動
- 一般化の注記（外部報告モードのみ。「採用リポの固有名詞は抽象化してある」と明示する）
