<!-- DO NOT EDIT. Authoritative source: scripts/harness-template/skills/pfd-ops/references/architecture.md. -->

# pfd-ops アーキテクチャ

pfd-ops スキルは4層で構成される。各層の「配布可能性」が異なる。

## 層の概要

| 層 | 内容 | 配布可能性 |
|---|---|---|
| **L1** 汎用プロトコル | PFD という概念だけから導ける手順。固有名詞ゼロ | SKILL.md 本文に直接記載 |
| **L2** ディスパッチ | 汎用パターン。宛先はリポが供給する `.md` companion | SKILL.md 本文でディスパッチ先を規約化 |
| **L3** バックエンド・プリセット | 作業項目の管理先として選択できる2種の流儀（GitHub Issues・ファイルベース・トラッカー）。採用リポはどちらかを選ぶか、どちらも採用しない | `references/` に同梱して配布 |
| **L4** リポ固有 | 対象リポ専有の事項（payoff_log・品質ガイド改訂経路等） | 配布対象外。採用リポの companion に記述 |

## L1: 汎用プロトコル（SKILL.md 本文）

PFD の概念だけで導ける手順。固有名詞なし。
項目の内容は `references/work-cycle.md` の「運用契約」と4手順が一次情報 — ここには複製しない（列挙ドリフト防止）。採用リポ固有の規律を加える節は `.pfdsl/bindings/<スキル名>.md` が持つ。

## L2: ディスパッチ（SKILL.md 本文）

汎用スキルは「ここに従え」とディスパッチするだけで、宛先はリポが供給する。
ディスパッチ先の一覧は SKILL.md 本文「運用ファイルの所在（L2 ディスパッチ）」が一次情報 — ここには複製しない。

`.md` companion の機構（「sibling を読め」という規約）は L2 に属し SKILL.md に記載する。companion の中身は L4（リポ固有）に属す。

PFD の種別は「この PFD が答える問い」で区別し、定義表・問診・1種別1ファイル原則は pfd-ecosystem スキルの `references/kind-taxonomy.md` を一次情報とする。変換グラフに参加しない外部提出先や最終消費者は artifact または process の `externalStakeholders` に列挙し、組織を出力ノードとして扱わない。組織境界をまたぐ引き継ぎは独立種別にせず、workflow または pipeline に吸収して内部責任者を `owner` で表す。

`.pfdsl/bindings/<スキル名>.md` はスキル固有の恒常指示を置く独立ファイルで、companion ではない（対応する `.pfdsl` グラフを持たず、sibling 規約の対象外）。スキルが自分の SKILL.md から直接参照する（詳細は次項）。sibling companion（`roadmap.md`・`workflow.md`・`pipeline.md`）に混ぜないのは、読み込み契機（PFD グラフを扱うタイミング）とスキル発火のタイミングが一致しないため。

### companion への書き分けルール（一次情報）

findings やゲート項目を companion に書くとき、**どの companion か**の判断基準:

| 書く内容の種類 | 宛先 companion |
|---|---|
| issue 固有ゲート・issue 管理バインディング・open PR 規約・issue バックエンド手続き | `roadmap.md` |
| 繰り返し手続き・知見振り分けルール・`develop` プロセスの運用規約・retro 宛先バインディング | `workflow.md` |
| 変換コンポーネントの追加・削除・境界変更に関する手続き | `pipeline.md` |
| ハーネス向け追加指示（PR 本文規約等）| `.pfdsl/bindings/pfd-ops.md` |

この表が一次情報。`pfd-ops SKILL.md` の L2 ディスパッチ・`pfd-retro` の出力振り分け・`.pfdsl/bindings/pfd-retro.md` はすべてここを参照する。

### companion の記述言語（一次情報）

companion（`.pfdsl/*.md`・`.pfdsl/bindings/*.md`）は内部メンテナ向け資料なので、そのリポの**メンテナが読む言語**で書く。公開物（README・CLI 出力・外部提出物）の言語と一致させる必要はない。判断軸は「読み手が外部ユーザーか内部メンテナか」。
配布 scaffold は日本語で配布されるが、これは既定値であって規約ではない。採用リポは初期構築時に自リポのメンテナ言語へ翻訳してよい。翻訳する場合はファイル単位で統一する（見出しだけ原文を残す等の混在をしない）。

### 昇格先の判定ルール（L4 → 配布層、一次情報）

上の表は**どの companion に書くか**を決めるものであり、companion に溜まった汎用ルールを**配布層のどのファイルへ昇格するか**は決められない。昇格先は次の3段で決める。

**0段目 — 区分 i・ii に入るか。** 昇格候補になるのは区分 i か区分 ii に入るもの（区分 i に添える既定値を含む）だけで、区分 iii は配布しない。区分の外には、所有者の決定で配布する付属機能と、配布を続けるための配布機構があり、どちらも昇格候補にならない。ただし、既に配布している付属機能・配布機構の記述を直すことは昇格ではなく、上流がそれぞれの正本で行う。この段の判定に必要な定義はここで閉じており、外部の文書を読まなくても適用できる。

判定前に、1文に混在する独立した規則を分け、対象・適用条件・例外を保持して一般化する。
たとえば「criteria を満たした根拠を示し、完了 commit と同時に done にする」は、完了根拠と VCS に結び付く更新時点へ分ける。
業種固有の名詞を artifact や process に対応付けることはできるが、業種固有の除外条件や承認条件を消して中立化してはならない。
参照先の規則・採用状態・criteria 等が不足するときは、取得すべき情報を示して判定を保留し、非該当や不合格とは区別する。
規則の分類と、ある変更にその規則が適用されるかの判断も分ける。

- **区分 i — 中核。** 一般化した規則は、次の4条件をすべて満たすことを要する。
  (a) PFD の意味論を取り除くと、判断の意味を失う。一般的な記録の同期や実行規律に PFD の語を添えただけでは足りない。
  (b) 判定・更新の対象が、PFD の要素（artifact・process・edge・feedback・criteria・status・kind・boundary）、companion の構造的事実、`.pfdsl/config.json` の宣言、CLI が導出できる状態に収まる。読取だけの規則では判定対象を確認し、書込みがあればその全対象も確認する。ほかの道具の skill・hook・CI 設定・agent 定義や作業記録の書式を書き換える規則は持たない。
  (c) 同じ適用条件と判断が、実行主体・業種・作業項目の管理先に依存しない。たとえば採用工程でも、定義済みの artifact・process・criteria に対応付けて同じ判断を行えることを確かめる。採用工程の criteria が未提示なら情報不足であり、それだけで規則が業種依存とは言わない。対象の道具名ではなく、規則がその道具の振る舞いを固定するかを調べる。
  (d) 読む・書く PFD 要素、または判定に使う CLI の問い合わせを名指せる。PFD 配下のパスやスキル名を挙げるだけでは足りず、対象と判定の関係を説明する。名指しは必要条件であって十分条件ではなく、語の検索だけで (a)〜(c) の成立を判定しない。
  4条件の AND は中核の入口を狭めるが、誤って入れる規則と誤って外す規則を同時に減らす保証ではない。混合文の分割、中核の正例、情報不足の保留を別々に確かめる。
  companion の構造的事実とは、名指した PFD 要素・境界・宣言と対応し、モデルから確かめられる構造上の関係、または単一ファイルのグラフでは表しきれないモデル間の関係を説明する事実である。たとえば別 PFD の process がどの artifact を消費するかとその対応根拠が該当する。図の node・edge・description・criteria で表せる事実は図を正本とし、companion を二重の status 台帳にしない。一般的な手順・再発防止・実行者への命令は、companion に置かれているだけでは構造的事実にならない。
  「done にするには criteria を満たした根拠を示せること」は中核であり、「完了 commit と同時に done にする」の時点は区分 iii に分ける。道具が process に要求されるか artifact を生産・消費するかでモデルへの参加を決める規則も中核であり、hook や agent という名だけで区分 iii に送らない。
  記法、PFD 種別の問診、後ろ向き導出による執筆、着手可能性と終端監査の契約（監査対象の PFD と作業項目がどの状態なら着手可能・完了と判定するか）、status 更新、図の監査観点がここに入る。PFD 側が外部の実行主体へ渡すもの（着手可能集合、process の入出力と criteria）、受け取った証拠をモデルに照らす扱い、同じ process の着手・状態・証拠を書き込む経路を1つに保つことも、実行主体の手法ではなく PFD 側の受け渡しなのでここに入る。
  出力 artifact の done 遷移を契機として、その出力と依存関係をモデル監査の対象にする契約はここに入る。done event がない回へその監査を広げない適用条件も同じである。これをどの会話ターン・実時間・呼出し順で実行するかは別の実行規律として区分 iii に分ける。
  完了チェーンの回収で残すもの（done でない artifact を出力する process と、その入出力 artifact）や作業項目と process の対応も、この4条件で判定する。管理先に依存しないことだけを、別系統の中核判定にしない。
  実行主体が変えてよい既定値（1サイクルで進める process の数など）は、規則にせず既定値として区分 i と一緒に配布する。数が PFD の語で書かれていても強制規則にはしない。規則にするのは、どの既定値でも残す PFD 側の対応（どの実行がどの process を進めたか）だけであり、受け取る証拠の対象 PFD ファイルの識別情報とファイル内 process ID の組で対応を確かめる。process ID はファイルローカルなので、モデル版が同じでも同名 ID を持つ別ファイルを混同しない。ファイルの識別情報はそのモデル版の文脈で対象を一意に特定できるもの（対象リポジトリの版における相対パスや、単一ファイルを一意に表すモデル識別子など）とし、不足時はどの process の証拠かを確定しない。process ID のグローバル化や新しい PFD フィールドは要求しない。保存方式・run ID の形式・PR 本文の書式はここでは固定しない。
- **区分 ii — 外部の仕組みとの連携。** 提供すると決めた用途ごとに、提供する理由と範囲を持つ連携だけが入り、そのうえで判定の論理が PFD の語彙で書けることを要する。対象が PFD 運用に関わるだけでは足りない。
  連携の部品（アダプタ）は外部の出来事を PFD の操作へ写すだけで、意味論を定義しない。完了と回収の規則は区分 i にあり、アダプタはそれをいつ実行するかだけを決める。外部の出来事（既定ブランチへの push など）を契機に区分 i の操作を起動する部品は、CI のワークフロー定義のような形を取っていてもここに入る。
  アダプタ自身が外部へ書くこと（区分 i の操作の結果を変更の提案として出すなど）と、書いた内容の読み戻しもここに入る。読み戻しは書いた部品自身の責任なので、比較の論理が PFD の語彙で書けなくてもここに置く。書き手が配布物の部品ならアダプタ自身の書込みであり、agent や人が書くなら下の区分 iii の「実行主体が外部へ書く手順」である。
  既存の連携で第三者の部品が作る提案の本文が固定説明と実行条件だけで、正しさの根拠が diff にあり人が審査する場合は、本文の読み戻しを追加していない。本文へ削除対象の ID や証拠データを載せ始めた場合は、そのデータの読み戻しを加える。この限定を、アダプタ自身の書込み全般の免除へ広げない。
  現時点で提供すると決めた用途は作業項目バックエンドとの連携で、その連携が契機に使う版管理や CI の出来事もこれに含む。ほかの外部の仕組みとの連携を足すときも同じ要件で判定する。
- **区分 iii — 有用だが利用者の環境に任せるもの。** 実行主体（agent・人・外部の orchestrator）を主語にする規則と、その振る舞いを点検する観点が入る。セッションやターンの構造（締めの確認、同じターンでの起動など）、commit・PR・branch・worktree と結び付けた時点や手順、git 衛生、commit 粒度、委譲とその worker（実装を担う agent を含む）、レビューの組み方、実行主体が外部へ書く手順と本文の規約、設計記録の置き場所・書式と再承認、1回の監査の実行管理（実行 ID、cutoff、情報源集合の凍結、並行実行や引継ぎの checkpoint）がこれに当たる。配布しない。
  ここで主語とは文法上の主語ではなく、判定・制約する対象を指す。agent が criteria と証拠を照合する文でも、その対象が PFD 側の受入契約なら区分 i であり、agent という語だけでは区分 iii にしない。
- **区分の外 — 付属機能。** PFD 運用が生む知識成果物のライフサイクル監査は、判定の論理の大半が一般の文書管理と同じで区分 ii の要件を満たさないが、所有者の決定で配布する。その観点のうち PFD の要素で書き直せるもの（能力成果物を使う process への edge の有無など）は、区分 i の図の監査観点に入る。範囲はその成果物に限り、一般の文書管理には広げない。付属機能が持つのはその成果物を点検する観点だけで、記録の書式や改訂の手順そのものは区分 iii に入る。付属機能は区分の判定から導いたものではないので、ほかの汎用ルールを昇格させる先例にしない。付属機能に項目を加えるのは昇格ではなく、所有者の新しい決定である。
- **区分の外 — 配布機構。** 配布ファイルの鮮度照合（`check-install-sync.mjs`）、移行状態の記録（`appliedMigration`）、plugin の版照合、環境の採取、上流への報告、配布前のレビュー、配布物の生成とハーネス別の複製、配布層への還流の監査がこれに当たる。配布物に含まれるものもあるが、それは配布を続けるためのコストであって PFDSL の責務ではない。区分 i・ii に入れる根拠にも、昇格候補にもしない。

監査に関わる区分 i の項目と付属機能の項目が定めるのは、監査の対象について何を判定するかである。この意味で、着手可能性・終端監査の契約は区分 i に入る。
その判定を1回の実行としてどう凍結し、記録し、引き継ぐかは PFD の意味論からは導けず、実行環境・並行性・証拠の可視性によって決まるので区分 iii とする。
監査の観点を配布していても、その実行管理は採用リポの binding に置く。

固有名詞を含まず全利用者に効くことは必要条件であって十分条件ではない。
区分 i・ii の要件を満たさない規律は、どれほど汎用でも昇格しない。
工程から呼ばれること、binding で有効化できること、用途を宣言できることだけでは根拠にならない。
区分 ii や付属機能の項目を任意で無効化できても、配布側の保守責務は残る。
この区分を定めた経緯は上流リポの ADR-0039、監査の対象と実行管理を分けた経緯は ADR-0040、付属機能と配布機構を区分の外に置いた経緯は ADR-0048、中核判定の4条件と companion の構造的事実を明確にした経緯は ADR-0051 にある（`ADR-\d+` の解決範囲は下の「配布物中の ADR 参照の解決」が定める）。経緯は判定に要らない。

**1段目 — どのスキルの管轄か。** 昇格元の companion がこれを決める。
PFD の sibling companion（上の表が宛先として挙げるもの）はすべて pfd-ops の管轄で、扱う PFD が違っても昇格先のスキルは変わらない。
`.pfdsl/bindings/<スキル名>.md` はファイル名が名乗るスキルの管轄。
companion の一覧をここに再掲しないのは、上の表と二重管理になり、companion が増えたとき片方だけ古くなるため。

**2段目 — そのスキルの中で SKILL.md 本文か reference か。** 固有名詞を含まず、そのスキルの全利用者に無条件で効く原則・プロトコルなら SKILL.md 本文（L1）。特定バックエンドの採用を前提にする規約なら L3 reference。手順の細目で、本文から手続きとして切り出されているものはその reference（pfd-ops のサイクル4手順なら `references/work-cycle.md`）。

固有名詞（リポ名・パッケージ名・ツール名・パス・issue 番号・ADR 番号）が残るものは、どの段でも配布層へ昇格できない。一般化してから昇格し、一般化できない具体例は companion に残す。

**ルール文が事実を主張している場合、その事実を一次情報で確認してから昇格する。** 固有名詞テストは文面だけで判定できるが、事実の真偽は文面から出ない — 両者を同じ工程で済ませると、検証されないまま配布層へ運ばれる。とくに落ちやすいのは、リポの外にあるもの（実行環境・harness・外部ツール）の仕様を述べる文である。自リポの実装なら誤りはいずれ実行時に露見するが、外部の仕様についての誤りは、その機能を使わない限り露見しない — 「使えない」と書いた文は、それを信じた読み手がその経路を試さなくなることで、自分の反証を封じる。確認できなかった場合は、ルール文からその事実への依存を外してから昇格する（能力の列挙をやめ、版に依存しない判断軸で書き直す）。

**一般形と元文を並べ、削った語を全部列挙する。** 一般化で削る対象は固有名詞だが、同じ作業で限定詞（「ことがある」「場合がある」「多くは」）も落ちる — どちらも「具体に属するもの」に見えるためである。落ちた結果、元文が正しく限定していた主張が一般形では無条件の断定になり、元の観測が1事例だったことは一般形からは読めなくなる。削った語に固有名詞でないものが混じっていたら、それが限定していた範囲を一般形へ書き戻す。観測が1事例なら、一般形にも1事例であることが残る書き方を選ぶ。

### バインディングファイルの命名規則

スキル固有の恒常指示・監査結果等は `.pfdsl/bindings/<スキル名>.md` に置く（例: `.pfdsl/bindings/pfd-retro.md`、`.pfdsl/bindings/pfd-ops.md`）。SKILL.md 側は「`.pfdsl/bindings/<スキル名>.md` が存在すれば読んで従う」とだけ書き、ファイルの中身（具体的な運用手続き）は書かない。1ファイルに集約しない（例えば全スキル分を `workflow.md` に集約しない）のは、companion がスキルと無関係な PFD 操作のたびに毎回丸ごと読まれる既存の読み込みモデルでは、集約するほど無関係な読み込みコストが増えるため。ファイル名（セクション名でなく）を規約にするのは、スキルが増えても既存ファイルへの追記でなく新規ファイル追加で済み、規約自体の変更が不要なため。
`bindings/<スキル名>.md` を読む規約を持つスキルの数だけ scaffold にファイルを用意する（内容が空でも実害のないファイル含む）。存在確認のコストは空ファイルでも実質変わらないため、都度作成でなく最初から揃えておく。
bundle 同梱スキル全数ではない — 自分の binding を読まないスキルの分を置いても、誰も読まないファイルが採用リポに増えるだけである。
スキルが新たに binding を読み始めたら、その時点で scaffold にも1ファイル追加する。
採用リポの宣言のうち、切り替えや列挙のような値は binding に書かず、採用リポが git で管理する `.pfdsl/config.json` のキーに置く。binding には手順・判断基準・理由の散文を書き、値はそのキーを指す。値を機械的に検証でき、workflow やスクリプトと agent が同じ値を読むためである。新しい宣言を足すときも、値ならこのファイルにキーを足す。

## L3: バックエンド・プリセット

「PFD の作業項目をどこで管理し、roadmap とどう同期するか」の流儀を、採用リポが選択できる再利用可能プリセットとして2種提供する。
どちらも pfdsl 固有ではなく、採用は任意である。
採用しないリポは `roadmap.pfdsl` の依存構造管理だけで運用する。

| プリセット | reference | リポルートへの実配置 |
|---|---|---|
| GitHub Issues | `references/github-issues-backend.md` | 要る（`install/` テンプレート） |
| ファイルベース・トラッカー（リポ内 markdown ファイル） | `references/file-based-tracker-backend.md` | 要らない |

どちらの reference も pfd-ops スキルの一部として plugin に同梱される（ADR-0028）。
採用リポは roadmap companion で採用したプリセットを宣言し、作業項目の管理では宣言したプリセットの reference だけに従う。
作業項目の管理以外で GitHub への外部書込みを行うスキル（上流への報告等）が GitHub Issues 版の書込み規約を参照するのは、この宣言と独立である。

### 配布単位

pfdsl / pfd-grill / pfd-ops / pfd-retro / pfd-ecosystem / pfd-upstream-report の6スキルツリーとハーネス別の資産を、`make gen-plugin` で共通正本から組み立てる（ADR-0028。旧 `pfdsl skill sync` は廃止）。
Claude Code plugin（`plugin/pfdsl/`）にはスキル・pfd-* Markdown コマンド・pfd-lens と pfd-implementer agent・hooks が入り、marketplace 経由で配布される。
スキル間の相互参照（pfd-retro → pfdsl の review-perspectives、pfd-ecosystem → pfd-ops の scaffold、コマンド → 各スキル）はこの bundle 配布が担保する。
`hooks/`（PostToolUse の managed issue リマインダ等）も同じ bundle に同梱される。plugin hook はインストール/有効化の同意機構を各ハーネスのプラットフォーム側に委ねる（`install/` + `check-install-sync.mjs --deploy` の配線を pfd-ops が自前で持たずに済む代替経路）。

### GitHub Issues プリセット

GitHub Issues プリセットを採用するには `install/` テンプレートをリポルートへ実配置する（`/pfd-init` のステップ 3.5 が実行する）:

```bash
node <pfd-ops skill root>/scripts/check-install-sync.mjs --deploy
```

このプリセットの配置済みかどうかは、`check-install-sync.mjs` が `install/` 由来ファイルの存在で判定する（どのプリセットを採用したかの一次情報は下の「採用」とは節）。

主な規約:
- issue が一次情報。`roadmap.pfdsl` は依存構造のみ管理
- process id は `iN_` prefix（N = issue 番号）。恒久 — issue close 後も剥がさない。出力 artifact id は最初から plain
- `flow:managed` / `flow:exempt` ラベルで管理対象を分類
- 未完了作業とその入出力を保って完了チェーンを回収する。`.pfdsl/config.json` で有効にした採用リポでは、デフォルトブランチへの push が `sweep-completed-chains.mjs` を起動して PR を提案し、マージは人が行う
- `audit-issues-flow.mjs` で読取専用の同期監査

詳細: [`github-issues-backend.md`](github-issues-backend.md)

### ファイルベース・トラッカー

作業項目をリポ内の markdown ファイルで管理する。
GitHub Actions や監査スクリプトを使わないため、`install/` の実配置も `check-install-sync.mjs --deploy` も要らない。
作業項目ファイルの所在は採用リポが決め、roadmap companion に書く。

詳細: [`file-based-tracker-backend.md`](file-based-tracker-backend.md)

## L4: リポ固有（配布対象外）

採用リポ固有の事項。各リポの `.md` companion（`roadmap.md` / `workflow.md` 等）に記述する。

pfdsl 開発リポ固有の例:
- payoff_log: PFD の効果を収集する目的
- pfdsl 品質ガイド改訂経路（このリポが pfdsl スキルの上流だから存在）
- ADR 改訂規約
- 学習ループのラウンド比較・残存ミスの lint 要件送り
- review-perspectives の C 観点を適用した pfdsl 固有例: 配布カタログ `docs/review-perspectives.md` の当リポ instance（`.pfdsl/review-perspectives.md`）
- review-perspectives instance（`.pfdsl/review-perspectives.md`）自体は図-companion でなく、配布参照カタログの repo-local instance

## `install/` ディレクトリの役割

```
<pfd-ops skill root>/            ← plugin: ${CLAUDE_PLUGIN_ROOT}/skills/pfd-ops、repo-local: .claude/skills/pfd-ops
  SKILL.md                     ← L1 + L2
  references/
    architecture.md            ← このファイル
    work-cycle.md              ← /pfd-cycle のサイクル4手順（L1 の手順本文を SKILL.md から切り出したもの。リポ固有の規律は採用リポの binding）
    github-issues-backend.md   ← L3 プリセット規約（GitHub Issues）
    file-based-tracker-backend.md ← L3 プリセット規約（ファイルベース・トラッカー）
    scaffold/                  ← L4 雛形テンプレート
  scripts/
    check-install-sync.mjs     ← install/ の実配置・鮮度セルフチェック（ADR-0028）
    plugin-version-check.mjs   ← 実行中pluginのidentity・bundle hashのローカル読取（移行照合と環境報告で共有）
  install/                     ← GitHub Issues プリセットの採用用テンプレート（リポルートへ実配置）
    .github/workflows/         ← pfdsl-sweep-completed-chains.yml
    scripts/pfdsl/             ← audit-issues-flow.mjs 等（配布物の由来を示す専用ディレクトリ、ADR-0032）
```

`install/` の canonical は plugin に同梱され、リポルートへの実配置・更新は `check-install-sync.mjs --deploy`（`/pfd-init` ステップ 3.5）が行う。
配置済みファイルと同梱 canonical の乖離は、pfd-ops 発火時の必須セルフチェックが hash 照合で警告する。

### 配置ファイルの鮮度セルフチェック

採用先では、出力の先頭に移行状態の通知が出ることがある。末尾だけを読んで済ませず、先にその通知を後述の「出力の意味と対応」で扱う。
deploy 関連の対応は出力末尾が名指しするため、移行状態の通知を扱った後で、その指示に従う。スクリプトは target の役割を分類し、`--deploy` が正しい向きの場合だけ案内するので、drift だけを根拠に反射的に deploy しない。GitHub Issues バックエンドを採用していないリポでは、未採用である旨と `--deploy` の案内が出る — これは報告であって指示ではない。そのリポが別のバックエンドを採用している、またはどれも採用していないなら、案内に従わず未採用のまま進む。

素の `--deploy` はローカル編集がないファイルをコピーし、ローカル編集がない orphan を削除する。`--overwrite-local-edits` は残るパスのローカル編集を canonical で上書きし、`--delete-edited-orphans` は消えるパスのローカル編集ごと削除する。旧ファイルの掃除ではまず素の deploy を実行し、編集済みとして残ったパスだけについて追加 flag の要否を判断する。
誰も編集していないのに同じファイルが deploy のたびに `Skipped` として残る場合は、旧版から更新した採用先に特有の状態である可能性がある。flag で上書きする前、また上流へ報告する前に、上流リポの [migration guide](https://github.com/takasek/pfdsl/blob/main/docs/migration-guide.md#files-reported-as-skipped-on-every-deploy) の該当節で確かめ方を確認する。

`Possible renames` は canonical 側の rename が新旧パスの `missing` と `orphaned` に分かれて見えている状態を表す。新パスを信用する前に旧パスのローカル編集を引き継ぐ。

上流 main との版差・bundle 内容差は取得も通知もしない。移行が必要かどうかは採用先の `appliedMigration` と実行中 plugin の照合で判断する。旧呼出しとの互換のため `--upstream` は受け付けるが、追加の処理や通知は行わない。

採用先では、同じチェックが `.pfdsl/config.json` の `appliedMigration` を実行中の plugin と照合し、`--upstream` の有無や GitHub Issues バックエンドの採否によらず、出力の先頭に結果を出す。
`appliedMigration` は、採用先が移行を適用し終えた plugin の版を `pluginVersion` に、Claude Code の plugin ではその bundle の集約 hash を `bundleHash` に持つ（Codex の plugin には bundle manifest が無いので `bundleHash` を持たない）。
`.pfdsl/` が無いリポでは何も出さない。plugin はユーザー単位で入るため、無関係なリポでも起動するからである。
照合は読むだけで書かない。記録を書くのは `--record-migration` だけで、移行を実施する人または agent が、移行と同じ変更の中で、検証が通った後に明示的に実行する。`--deploy`・`--overwrite-local-edits`・`--delete-edited-orphans` と同時には指定できない（引数の誤りとして exit 2）。
キーを手で書くことは禁じないが、hash を人手で計算させないためにコマンドを案内する。

出力の意味と対応は次のとおり。

- 「no appliedMigration」: この仕組みの導入前の採用先で、どの移行を適用したか分からない。失敗ではない。出力が指す migration guide の「Choosing the update range」で、導入済みの版から現在の版までの項目を実施し、検証が通ってから `--record-migration` を実行する。plugin の外（repo-local の旧配置など）で動かした場合は版が不明で記録できないので、コマンドは出力されず、plugin 経由で実行し直す旨が示される。
- 「Skipped the migration-state comparison」: 実行中の pfd-ops が plugin の外（repo-local の旧配置など）にあり、plugin の版を決められない。照合は行われていない。plugin 経由で実行し直す。
- 「older than the migration state」: 実行中の plugin が記録より古い。plugin を更新する。更新するまで `--deploy` と `--record-migration` は exit 3 で拒否される（古い `install/` で新しい配置を巻き戻さないため）。
- 「newer than the migration state」: 記録より新しい plugin で動いており、未適用の移行がありうる。出力が示す記録した版から実行中の版までの migration guide の項目を実施し、検証が通ってから `--record-migration` を実行する。拒否はされない（移行の作業自体に `--deploy` が要る）。
- 「same version … but different content」: 版が同じで bundle の内容が異なる（開発版と公開版など）。どちらが新しいかは判定できない。拒否はされない。差が意図したものか確かめ、必要なら `--record-migration` で記録し直す。
- 「cannot be compared」: 記録か実行中の版が `x.y.z` として読めない。拒否はされない。
- `.pfdsl/config.json` を名指しする失敗（exit 3）: JSON として読めない、最上位がオブジェクトでない、`appliedMigration` の形が違う、のいずれか。宣言が壊れたまま黙って無視しないための失敗で、ファイルを直すまで先へ進めない。

`--record-migration` は、上流リポや canonical が曖昧な target、`.pfdsl/` が無いリポ、plugin の版を決められない実行、記録より古い plugin、JSON として読めない・最上位がオブジェクトでない `.pfdsl/config.json` からでは、何も書かずに理由を示して拒否する。
既にある `appliedMigration` の形が違う場合は拒否せず上書きする（通常の実行と `--deploy` が拒否する記録を直せるのはこのコマンドだけで、記録の版を読めないので古い plugin の拒否は評価されない）。
`.pfdsl/config.json` が無く `.pfdsl/` だけがあるときは新規に作り、他のキーは保持する。
新規の採用先（`/pfd-init` ステップ 3 の前に `.pfdsl/` が無かったリポ）は、config をコピーした後にこのコマンドを実行し、現在の版から始める。既存の `.pfdsl/` がある採用先は、移行を適用して検証が通ってから記録する。

## 「採用」とは

L3 プリセットのいずれかを当該リポの作業項目バックエンドとして使う状態。
どのプリセットを採用したかは roadmap companion の宣言が一次情報である。
GitHub Issues プリセットは連携ワークフローの実配置を伴うため、`install/` 由来のファイルがリポルートに1つ以上存在すれば、その配置について「採用済み」と判定する。
ファイルベース・トラッカーは実配置を伴わないので、この判定の対象にならない。

「L3」= 選択できるバックエンド・プリセット群（GitHub Issues・ファイルベース・トラッカー）、「バックエンド」= 作業項目管理の一次情報源と同期機構を指す。

## 配布物中の ADR 参照の解決

配布スキル・reference に現れる `ADR-\d+` は、上流リポ（github.com/takasek/pfdsl）の `docs/adr/` にある設計記録を指す。採用リポには同梱されない — 設計根拠を確認したいときは上流リポを参照する。
