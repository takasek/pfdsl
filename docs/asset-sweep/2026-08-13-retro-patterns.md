# retro-pattern カタログ 棚卸し（2026-08-13）

初回。
前回の記録が無いので絞り込みは効かず、全66件を対象にした。

## 発火間隔の実測

カタログが1ファイル1パターンになったのは 2026-08-06（`dbb74d34`）で、本日まで **7日**。
その間の追加は **29件**（分割時38件 → 本日62件。差の9件は本回を含む統合・削除による減）。
1日あたり約4件で、閾値20 は約5日に1回の発火になる。
`SWEEP_TARGETS` の閾値が意図する「数日〜数週間に1回」の下限寄りだが範囲内なので、**閾値20 は据え置く**。

初回のゲートが 62件で即超過したのは、記録が無い状態では分割時にファイル化された38件も「前回 sweep 以降の追加」として数えられるためで、以降の回では起きない。

## 工程1 — 機械化により廃止できるパターン

**廃止 0件。**

`verification-ran-in-another-tree` を #840 の `verification-tree-guard.mjs` に照らして判定した。
guard が塞ぐのは「cwd が main checkout に解決し、かつリポ内に linked worktree が実在する状態で、対象ツリーを cwd から解決するコマンド（`make`・`pnpm`/`npm`・`npx`・相対スクリプトパスの `node`・絶対パス操作を持たない `node --test`）」で、決定は ask。
廃止条件（trap が構造的に起こり得なくなったこと）を満たさない理由は3つある。
ask は deny でないので承認すれば同じ経路が通る。
判定はコマンド開始時の cwd で行われるため `cd <dir> && make test` の形は両方向に外れる。
対象コマンドの外は素通しで、パターンの4つ目の具体例（`git status --short` と `tail` が main の内容を返した回）はそもそも判定対象に入らない。
廃止せず、この機械化の範囲をパターン本文へ1節として書き足した。

`unmatched-vocabulary-defaults-to-pass` は、具体例が名指ししていた語彙 allowlist（`OPTION_HEADING_PATTERNS`）が #800 で撤廃済みだった。
ただし撤廃されたのは allowlist であって catch-all の分岐ではなく、列挙という形を取らない案の提示は依然その既定へ落ちる。
廃止せず、どの半分が機械化されたかを具体例に書き足した。

部分機械化で手当不要と判定したもの: `meta-item-hides-subitems`（`Closes` 系サブ項目のみ #801/#871 で機械化、他3例は残存）、`duplicate-name-not-a-discriminator`（npx 例のみ command-usage-guard C が ask）、`entry-path-reads-as-out-of-scope`（機械化の範囲を自己申告済み）。

## 工程2 — 近接ペアの統合

**4件を統合し、カタログは66件から62件になった。**

- `mirrored-checker-drops-sibling-caveat` → `unverified-precedent-style`。どちらも「模倣元の性質を確認せず形だけ写す」を問う。前者は散文（hook ポインタのスタイル）、後者はコード（姉妹チェッカーのリスク受容注記）で、写されない性質の載る器が違うだけだった。統合先へ第2の軸として節を足し、タグに `target:check-script` と `method:unify` を加えた
- `companion-addendum-oversight` → `meta-item-hides-subitems`。単一ポインタがサブ項目群を隠す同型で、前者は単一事例。統合先のタグは `always` のまま（軸を問わず常に返るので、吸収した `target:prose-doc` を足しても届く範囲は広がらない）
- `parallel-refactor-blind-spot` → `partial-fix-sweep`。問いは「同型の他箇所を掃いたか」で一致し、差は引き金が並行作業か単独作業かのみ。並行の場合に固有な検出機会（合流時の横断 grep）は統合先へ残した。タグに `context:parallel-work` を加えた
- `subtracted-count-hides-its-minuend` → `unmatched-vocabulary-defaults-to-pass`。どちらも出力の1つの値が2つの意味状態を潰す形で、同じ `retro-patterns select` の出力が両方の具体例になっていた。対策が別物（catch-all の分岐を選び直す／減算前の数を出力へ戻す）なので、その差を統合先に明記した。タグに `target:cli-surface` と `method:count` を加えた

統合しなかった候補と理由:

- `observed-symptom-vs-inferred-cause` + `observation-frame-beyond-the-reporter-tools`。後者が本文で前者との区別（原因の枠に掛かるか、原因を名乗らない主張が枠を素通りするか）を既に言明しており、対策の効く工程も別（起票時の書き方／委譲報告を採用する時の照合）。統合の理由が無い
- `implicit-environment-assumption` + `unusable-named-means`。「実行主体に手段が届かない」で同構造だが、失敗形が ENOENT クラッシュか「呼べない」かで分かれ、後者の対策（規約の実行主体を1語で決めてから書く）は前者に効かない。後者は本文冒頭で前者を明示参照して区別を書いている
- `flag-scope-bundling` + `output-verb-subject-mismatch`。同一事故 #603 の別断面だが、問いはフラグの束ねと出力の動詞で別物

## 工程3 — `具体例:` が参照する機構の実在

全62件（統合前は66件）の本文からバッククォート内のパス様トークン・識別子を機械抽出し、ツリーと突き合わせた。

- パス様トークン: 3件がツリーに不在だったが、いずれも実在すべきパスではない。`/tmp/pr-body.md`（事故の説明そのもの）・`packages/cli/dist/cli.js`（ビルド成果物、gitignore）・`skills/pfdsl/SKILL.md`（`plugin/pfdsl/` 配下の相対表記）
- 識別子80件のうちカタログ外にヒットが無かったのは6件。4件はパターン名の相互参照とコミット SHA（`dd04837` は実在）で正常。残る2件が真の不整合だった
  - `one-sided-delegation-brief` が `workflow.pfdsl` の `sample_previews.description` と書いていたが、そのノードは `runtime-pipeline.pfdsl` にある。図の名前を訂正した
  - `OPTION_HEADING_PATTERNS` は撤廃済み（工程1に記載）

## 工程4 — `phase: pre-artifact` の宣言漏れ

宣言済み23件・未宣言39件（統合後）を、binding の判定文「対策が成果物を書く前・着手前にしか効かないか」で1件ずつ判定した。

**追加1件**: `inherited-solution-space`。
解空間の継承は issue の案を読んで設計する時点にしか対策が効かない（実装後に否定案を生成しても、既に確定した実装を捨てる話になる — 本文の具体例 PR #549 がその形）。
同じ `target:issue` + `method:choose-option` の兄弟2件（`observed-symptom-vs-inferred-cause`・`shipping-with-surviving-rejected-option`）は宣言済みで、この1件だけが漏れていた。

判定に迷って付けなかったもの:

- `shared-worktree-interference`。「予防はサイクルを worktree で回すこと」は着手前にしか効かないが、対策の中核は事後の復旧手順（退避 → worktree 作成 → `git apply` → 救済ブランチ）であり、判定文が問うのは対策の効く時点なので付けない側に倒した
- `overclaiming-beyond-measurement`。対策は成果物を書く時点で効くが、実測どおり事後の敵対的検証で検出・訂正できている（PR #865）
- `invariance-claim-unverified-across-the-operation`。「受け入れ基準に書く」は着手前だが、検証そのものは実装後にも実行できる
- `promoted-rule-invalidates-a-feature`。PR #934 のレビューが「対策は昇格時にしか噛まない」として宣言漏れを指摘した項目だが、本文の具体例では #787 の実装後の敵対的レビューが衝突を検出し、そこで機能の処遇を決められている。判定文が問うのは対策が効く時点であり、レビュー時に直せた実績がある以上は付けない側に倒した（タグの是正のほうは工程5で実施済み）

## 工程5 — タグ語彙の drift

件数1のタグは11件あった（#879 の 2026-08-12 実測時点の9件から、`context:rule-promotion` と `context:conflicting-mechanisms` の2件が増えていた）。
判定テスト（そのタグを持つサイクルを思い浮かべ、そのサイクルでこのパターンを読むべきか）を1件ずつ当て、**2件を是正した**。

`promoted-rule-invalidates-a-feature` の `context:rule-promotion` は、規約の昇格という**行為**を `context:` prefix で書いていた。
prefix の定義（`context:` は行為でなく成立していた周辺条件）に反しており、同じ軸は既存の `method:codify-rule`（規約を成文化する回）が持っている。
`context:conflicting-mechanisms` は、機構同士が衝突している状況というパターンが記述する trap そのもので、サイクル開始時には判定できない — 衝突があると分かっているサイクルなら trap は踏まない。
両者を落とし、`method:codify-rule` と、無効化される機能が載る面を表す `target:cli-surface` に付け替えた。

件数1のまま残した9件はいずれも発火条件として成立する。
`target:hook`（hook を触る回）・`target:scratch-file`（リポ外へ書く回）・`method:bundle`・`method:defer-finding`・`method:reuse-helper`・`method:search-absence`・`method:widen-data`・`context:entry-path`・`context:shared-tree` のうち、`target:scratch-file` だけは「今回はスクラッチファイルを触る」とサイクル開始時に認識しにくく判定が割れたが、PR 本文を `--body-file` で渡す回は事前に分かるので残した。

結果、件数1のタグは11件から9件へ減った。

## 工程の外に出た所見

`absence-search-scope` は「問いの形の追加」5層・「対策の追加」2層を積み上げており、冒頭の定義文（探索範囲の網羅性）が本文の後半（母集合の決め方・標本の偏り・器と一次情報の区別）を覆えていない。
binding は「1パターンが太ることは受け入れる」と定めており、この5工程にも肥大の判定は無い — sweep は近接ペアを統合するが、太りすぎたパターンを分割する工程を持たない。
本回では手を付けず、所見として残す（PR #934 のレビューが同じ点を指摘している）。
