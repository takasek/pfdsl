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
<!-- DO NOT EDIT. Authoritative source: .claude/skills/pfd-upstream-report/SKILL.md. -->

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

自リポモードでも起票する。
配布層の欠陥をその場で直すと、いま回しているサイクルのスコープが膨らむ。
issue へ切り出してコンテキストを区切るほうが健全である。
その場修正は選択肢として提示してよいが、既定にしない。

## 工程2: 証拠の収集

環境ブロックは pfd-ops 同梱のスクリプトが採取する。

```bash
node ${PLUGIN_ROOT}/skills/pfd-ops/scripts/collect-report-environment.mjs
```

PLUGIN_ROOT は plugin ロード時に実パスへ置換される変数（`${PLUGIN_ROOT}` の形でのみ置換対象 — この説明文中の表記のように波括弧を外せば置換されない）。
上のコマンド行がパス置換されず変数名のまま見えている場合は plugin 外（repo-local）ロード — `node .agents/skills/pfd-ops/scripts/collect-report-environment.mjs` を使う。
**どちらも解決しない場合**（変数名のまま見えており、かつ repo-local の `.agents/skills/pfd-ops/` も存在しない）は、いま読んでいるこのファイル自身の所在から sibling の `pfd-ops/scripts/` を相対で辿る。
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

## 工程6: 承認と投稿

本文の全文を提示し、明示の承認を待つ。
承認なしに投稿しない。

投稿は pfd-ops の `references/github-issues-backend.md`「複数行本文の外部書込み」規約に従う。

1. セッション固有名を持つ body file に正本を書く
2. `gh issue create --repo takasek/pfdsl --title <title> --body-file <path>` で正本を直接渡す
3. write response が返した stable identifier で対象を取り直す（`gh issue view <number> --repo takasek/pfdsl --json body,url`）
4. persisted body が改行を含めて正本と完全一致することを確認する
5. 一致しなければ成功として扱わず停止する

**コマンドの成功表示や返された URL は persisted body の証拠にならない。**
既存 issue へのコメントも同じ5手順を踏む。

ラベルは外部報告モードでは付けない。
外部利用者に write 権限がなく、付与を試みれば失敗する。
仕分けは上流メンテナが行う。

自リポモードの起票後処理は pfd-ops の GitHub Issues バックエンドへ委譲する。
ラベル判定基準・判定タイミング・roadmap 追加の要否・ラベル付与の確認要否はいずれも `github-issues-backend.md` が規定しており、ここには複製しない。

`gh` が未認証、または権限不足で失敗した場合は、本文ファイルのパスと手動投稿コマンドを提示して停止する。
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
