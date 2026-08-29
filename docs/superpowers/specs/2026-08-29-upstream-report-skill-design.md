# pfd-upstream-report スキル設計

## 背景と問題

pfd-retro の「上流変更ルール」は、採用リポが配布層（bundle 同梱のスキル本文・reference）の欠陥や昇格候補を検出したとき「issue バックエンドを採用しているリポでは上流リポへの変更提案として起票する」と定めている。
しかし起票の実行手順はどこにも存在しない。
上流リポの所在（github.com/takasek/pfdsl）は `pfd-ops/references/architecture.md` が ADR 参照の解決先として述べているだけで、報告の宛先としては書かれていない。
規約はあり、実行手段が空という状態にある。

さらに現行文面は一文の中に採用リポ自身の issue バックエンドと上流リポへの起票が同居しており、どちらへ立てるのかが読み取れない。

## スコープ

報告対象は配布物全般と未対応要望とする。

- 配布プロンプト（pfd-* スキル本文・reference・agent・command・hook）の記述の欠陥
- pfdsl CLI・gate script の挙動の欠陥
- 未対応の要望

対象外は採用リポ自身の PFD・コードの欠陥である。
それらは pfd-ops の作業サイクルが扱う。

対象種別で変わるのは証拠ブロックだけで、共通工程（所在の特定・環境の記録・重複確認・承認・投稿）が大半を占める。
種別ごとの必須項目を一覧で持てば分岐は吸収できる。

## スキル境界

名前は `pfd-upstream-report`。
harness-inventory の skillCapability として4ターゲット（claude-repository / claude-plugin / codex-repository / codex-plugin）へ配布する独立スキルとする。

- 入力: 利用者の症状申告とセッション文脈
- 出力: takasek/pfdsl に投稿された issue の URL
- やらないこと: 修正 PR の作成、採用リポ自身の欠陥の記録、外部利用者としてのラベル付与

独立スキルにする理由は、description が自前の起動条件を持てる点にある。
retro 以外の契機（作業中に CLI の欠陥へ気付いた等）でも発火する。
pfd-retro に節を足す形では retro 実行中しか発火せず、既に長い SKILL.md がさらに伸びる。

## 実行フロー

### 1. 実行環境の判定

外部報告モードを既定とする。
自リポモード（上流リポの作業ツリーにいる）へ切り替えるのは、複数の証拠が揃った場合に限る。

- `git remote` のいずれかが takasek/pfdsl を指す
- かつ工程2の環境採取が `installation` に `upstream-checkout` を返す（作業ツリーが上流リポの構造を持つことを、`plugin/pfdsl/.claude-plugin/plugin.json` と `scripts/lib/harness-inventory.mjs` の実在で確かめている）

判定が付かない場合は外部報告モードのまま進める。
remote だけを根拠にしない理由は、採用リポが参照用に pfdsl の remote を登録しているだけでも条件を満たすためである。
その誤判定は工程4の一般化スキップを通じて採用リポの固有名詞の公開へ直結する。
誤判定のコストは非対称であり、安全側は外部報告モードにある。

モードの差分は工程4と工程6に現れる。

同じ工程で `gh` の前提も確認する。
工程5の重複確認も工程6の投稿も `gh` に依存しており、本文を組み立ててから使えないと分かるのが最も無駄が大きい。
`gh` が存在しない、または未認証なら、ここで止めて何が足りないかを報告する。

自リポモードでも起票する。
retro 中に見つけた配布層の欠陥をその場で直すと retro のスコープが膨らむため、issue へ切り出してコンテキストを区切るほうが健全である。
pfd-retro の宛先表も「未着手作業の発見」を作業項目バックエンドへの記録として扱っている。
その場修正は選択肢として提示するが、既定にはしない。

### 2. 証拠の収集

環境ブロックで取れる項目は導入形態ごとに違う。
採取は pfd-ops の環境採取スクリプト（「実装方式」節）が行い、取得できなかった項目は欠落として明示する。
黙って省くと、読み手は「その形態では取れない」のか「採取に失敗した」のかを区別できない。

この2つは欠落の理由が違うので、別々に記録する。
形態が原理的に持たない項目（Codex plugin の contentHash 等）は形態ごとの宣言から、読めるはずの項目が読めなかった場合（manifest が壊れている、`git rev-parse` が失敗した等）はその場の失敗として記録する。
片方だけを記録すると、壊れた manifest が「その形態では取れない」と読める報告になる。

- Claude plugin: plugin version と bundle contentHash（`<skillRoot>/../../.claude-plugin/plugin.json` と、同ディレクトリの `bundle-manifest.json`）
- Codex plugin: `.codex-plugin/plugin.json` の version のみ。contentHash は配布物に含まれないため原理的に取得できない
- repo-local install: plugin manifest を持たない。install provenance（`pfd-ops-install-manifest.json`）と、取得できれば git commit
- 上流 checkout: リポの git commit

CLI version は導入形態と独立に `pfdsl --version` で取る。

種別ごとの追加項目。

- プロンプト欠陥: bundle 内の相対パスへ正規化した該当箇所の引用と、実際にどう読まれたか
- CLI・gate script: コマンド行、最小入力、実出力、期待した出力
- 要望: 詰まった作業と現行の回避策

この工程を所在の特定より前に置くのは、環境採取が skill root を解決するためである。
所在の探索はその skill root を起点にする。

### 3. 所在の特定

症状を「何をしようとして何が起きたか」の形で確定し、そのうえで所在を特定する。
配布プロンプトは採用リポから読める（plugin 導入なら `${CLAUDE_PLUGIN_ROOT}`、repo-local なら `.claude/skills/`、codex なら `.agents/skills/`）ため、所在（どのファイルのどの記述か、どのコマンドか）は特定できる。

ただし探索はスキルが行い、利用者へ求めるのは候補の確認だけとする。
実体パスは導入形態で変わり、pfd-ops 自身が plugin root の未置換や repo-local パスの不在まで含む分岐を持つ。
利用者に手で探させる形にすると、形態ごとの知識を利用者側へ押し付けることになる。
CLI のソースが採用リポの node_modules に常にあるとも限らない。
探索の起点には工程2が解決した skill root を使う。

求めないのは修正方針の判断である。
「プロンプトが CLI の挙動を誤って説明している」型では、プロンプトと CLI のどちらを直すかが上流の設計判断であり、利用者は食い違いの指摘までしか行えない。
所在を特定できなかった場合は症状のまま出し、特定できなかった旨を本文へ明記する。

### 4. 一般化（外部報告モードのみ）

採用リポの固有名詞（リポ名・ファイル名・ドメイン語彙・issue タイトル・PFD の中身）を抽象形へ置換した本文を作る。
既定は一般化とする。
生の抜粋が再現に必須の箇所は「生で載せる候補」として列挙し、利用者へ個別に確認を取る。

自リポモードではこの工程を行わない。
隠す相手がおらず、具体名詞があるほうが修正しやすい。

### 5. 重複確認

単一の語による1回の検索では取りこぼす。
次を行う。

- 症状・コマンド名・診断メッセージ・該当パスなど複数の語で `gh issue list --repo takasek/pfdsl --search` を引く
- open と closed の両方を対象にする
- `--limit` を既定値任せにしない

ヒットを同一と決めない。
候補として提示し、同一性の判断は利用者が行う。
語の一致だけでコメントへ倒すと、別問題の issue へ誤投稿する。

同一と判断された場合は新規起票ではなく既存 issue へのコメントとする。
コメントも本文の承認と、工程6の readback の対象になる。

### 6. 承認と投稿

本文の全文を提示し、明示の承認を待つ。

投稿は `github-issues-backend.md` の「複数行本文の外部書込み」規約に従う。
共通の1手目はセッション固有名を持つ body file に正本を書くことで、その先は新規起票とコメントで write と readback の対象が違う。

新規起票は `gh issue create --body-file` で正本を渡し、返された URL の issue 番号で `gh issue view <number> --json body,url` を引いて persisted `body` と照合する。
コメントは `gh issue comment <number> --body-file` で正本を渡し、返された comment URL の `#issuecomment-<id>` から `gh api repos/takasek/pfdsl/issues/comments/<id> --jq .body` を引いてそのコメント自体と照合する。
`gh issue view --json comments` の一覧から似た本文を拾う読み方は規約が禁じている。

どちらの経路でも、改行を含めた完全一致を確認し、一致しなければ成功として扱わず停止する。
同規約は、コマンドの成功表示や返された URL は persisted body の証拠にならないと明記している。

ラベルは外部報告モードでは付けない。
外部利用者に write 権限がなく、付与を試みれば失敗する。
仕分けは上流メンテナが行う。

自リポモードの起票後処理は pfd-ops の GitHub Issues バックエンドへ委譲する。
ラベル判定基準・判定タイミング・roadmap 同時追加・ラベル付与の確認要否はすべて `github-issues-backend.md` が規定しており、このスキルへ複製しない。
複製すれば分類規則の将来の変更に追従できなくなる。

gh が未認証、または権限不足で失敗した場合は、本文ファイルのパスと手動投稿コマンドを提示して停止する。
別経路への迂回は行わない。

## issue 本文の形式

タイトルは上流の慣例に合わせ `<type>(<scope>): <症状>` とする。
scope は所在の由来（pfd-ops / pfd-retro / cli 等）を用いる。
所在を特定できなかった場合は scope を省略する。

本文の構成。

- 症状（1〜2文）
- 環境（導入形態・bundle version・contentHash・CLI version）
- 再現手順または該当箇所
- 期待した挙動
- 一般化の注記（外部報告モードのみ）

## 実装方式

環境採取だけをスクリプトに寄せ、所在の探索・起草・一般化・重複確認・承認・投稿はスキル本文の手順で行う。

環境採取をスクリプトにする理由は、導入形態ごとの manifest 解決が `plugin-version-check.mjs` の持つ知識と重なるためである。
同じ知識をプロンプトへ書き写せば、配布物の構造が変わったときに二重に壊れる。

`plugin-version-check.mjs` そのものは拡張しない。
あちらは upstream との版差を best-effort で警告する責務を持ち、取得できなければ null を返して黙る設計になっている。
環境採取は逆に、取得できなかった項目を欠落として報告する必要がある。
責務が反対を向いている。

置き場所は `.claude/skills/pfd-ops/scripts/` とする。
新スキル側へ置くと、pfd-ops が既に持つ manifest 解決の知識が2つのスキルツリーへ分かれる。
スキル間の相互参照は bundle 配布が担保しており、既存の実例もある（pfd-retro から pfdsl の review-perspectives、pfd-ecosystem から pfd-ops の scaffold）。

スクリプトは bundle 内で自己完結する必要があるため Node stdlib のみを使う（`plugin-version-check.mjs` と同じ制約）。

## 既存資産への変更

- `.claude/skills/pfd-retro/SKILL.md` の「上流変更ルール」: 上流リポへの起票の記述をこのスキルへのポインタに改訂する。現行文面の曖昧さ（自リポのバックエンドと上流起票の同居）もここで解消する。あわせて「自リポが上流ならその場で編集してよい」の一文に既定を書き足す — このスキルが自リポモードでも起票を既定にする以上、接続元が無条件にその場修正を許すと既定が成立しない
- `.claude/skills/pfd-ops/scripts/`: 環境採取スクリプトを新設する
- `scripts/lib/harness-inventory.mjs`: `skillCapability("pfd-upstream-report")` を HARNESS_CAPABILITY_CONTRACT へ追加し、SKILL_SOURCE_FILES に新スキルの SKILL.md と pfd-ops の環境採取スクリプトを登録する
- `make gen-plugin` で配布物を再生成する
- distribution-review: 新規配布物のためレビュー記録が必要になる

## 検証

環境採取スクリプトはテストを持つ。
配置は既存パターンに従い、実装を `.claude/skills/pfd-ops/scripts/` に、テストを `scripts/lib/<name>.test.mjs` に置いて相対 import する（`plugin-version-check.test.mjs` と同じ形）。
導入形態4種それぞれの解決と、取得できない項目が欠落として報告されることを検証する。

スキル本文はユニットテストを持たない。
品質は次の3つで担保する。

- gen-plugin の drift check（生成物と一次ソースの一致）
- check-install-sync（配布経路の整合）
- distribution-review（採用リポの読み手視点でのレビュー）
