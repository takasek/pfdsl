# Core / CLI 設計監査

> アーカイブ注記（2026-09-10）: この文書は固定コミット `827bcb1cb96238f918dad84dc6453176f131e029` を対象にした当時の監査記録であり、現行の不具合一覧や実装計画ではない。
> 最新の対応状況と残件は [#1055](https://github.com/takasek/pfdsl/issues/1055)、CLI 0.0.26 の公開完了記録は [#1138](https://github.com/takasek/pfdsl/issues/1138) を参照する。
> 観測・評価・提案は当時の内容を保持し、個人環境を含むパス表記は公開用の例示パスへ置換した。
> Markdown リンクは、このアーカイブ内の相対参照または監査対象コミットへの固定参照へ置き換えた。

監査対象は commit `827bcb1cb96238f918dad84dc6453176f131e029`、checkout は `/path/to/pfdsl` である。
対象 commit の実装・仕様・テストと、その commit から build した checkout-local dist を用いた再現結果を根拠とする。
issue・PR の取得・検索・重複確認は行っていない。
製品コードの変更、commit、push、外部公開操作は監査範囲外である。

| ID | 優先度 | 根本原因と確認結果 |
| --- | --- | --- |
| C1 | P1 | formatter が受理した文書を別の文境界・字句規則で再構成し、正当な入力の辺を診断なしで失う。 |
| C2 | P2 | 複数ファイルの読込結果と検証済み範囲が結び付かず、依存先の診断や孫の境界不整合が entry の成功結果に現れない。再帰検証の契約には未決事項がある。 |
| C3 | P2 | YAML 値を型付き frontmatter とみなし、shape 検査・空宣言の正規化を consumer ごとに行うため、診断を返す経路が例外で終了する。 |
| C4 | P2 | presentation の継承 DAG を経路ごとの列へ展開し、実効値が一定の入力でも不要な指数増大を起こす。 |

## 責務と依存関係

[core の入口](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/index.ts#L143)は、frontmatter 読込、body の字句解析、構文解析を共通化する。
`analyze` はそこから normalize、validator、graph 構築へ進み、graph と診断を同時に返す。
部分結果を返せること自体は editor の途中入力にも有用であり、欠陥とは扱わない。

[CLI の graph loader](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/cli/src/index.ts#L1950)などは、通常、診断の error を確認してから query を実行する。
一方、formatter は文書全体とは別に断片を再解析し、multifile loader は frontmatter を最低限の入力として依存を辿る。
今回の主要問題は、この派生経路で元の解析・検証の保証が引き継がれない点にある。

frontmatter の書換えは [CST 層](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/frontmatter-cst.ts#L50)を共有する。
CLI の `meta set` は全 ID の事前検査と書換え後の error 検査を行うが、formatter の保存経路は出力の error 検査やグラフの意味比較を持たない。
multifile の presentation 解決は core に置かれ、CLI render から利用される。
これらの共有境界には存在理由があり、機能の撤去ではなく保証の受渡しを改善することを提案する。

## C1 — P1: 正当な入力の辺を失う formatter

### 確認した動作

次の入力は、いずれも整形前の診断が空である。

```pfdsl
"a#b" >> P -> c
```

`format(source, { style: "flows" })` は `a#b >> P -> c` を返した。
元の2辺は再解析すると0辺になり、整形時・整形後の診断も空だった。
引用が外れた `#` がコメント開始として解釈されるためである。

```pfdsl
[a, b]
# note
>> P -> c
```

この入力は3辺から `# note` だけの出力へ変わった。
整形時・整形後の診断は空で、整形後の辺は0件だった。
対照の `a >> P -> c` は同一出力となり、2辺を保持した。
実測値は [results.json の format 配列](evidence/core-cli/results.json)に保存されている。

### 呼出し経路と根本原因

`CLI fmt --write → runFmt → core.format → splitBodyIntoSegments → 各断片の parse / normalize → formatAsFlows → writeFileSync` という経路である。

- [formatter.ts:18](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/formatter.ts#L18)は空行・先頭 `#` の行を独立した segment とみなす。parser が一つの statement として扱う継続コメントもここで分断する。
- [index.ts:312](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/index.ts#L312)は segment を再解析するが、その診断を取り出さず、部分的な辺だけを使用する。
- [formatter.ts:99](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/formatter.ts#L99)と [flat 出力](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/formatter.ts#L38)は正規化済み ID を引用・エスケープせず文字列へ挿入する。
- [index.ts:341](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/index.ts#L341)が返す診断は元文書のものだけであり、出力の意味保持を表さない。
- [runFmt:575](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/cli/src/index.ts#L575)はこの診断で保存可否を判断し、[591行](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/cli/src/index.ts#L591)で出力を保存する。

追加実験では、実 CLI を別プロセスで起動して quoted-id の fixture に `fmt --write` を実行した。
exit 0、stdout・stderr とも空で終了し、実ファイルの読戻しは `a#b >> P -> c`、辺は2件から0件になった。
この実 CLI 保存結果は [cli-boundary-results.json の formatWrite](evidence/core-cli/cli-boundary-results.json)にある。
VS Code の全体整形も [format-logic.ts:13](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/format-logic.ts#L13)で同じ戻り値を採用し、[format.ts:21](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/vscode-extension/src/format.ts#L21)で文書置換へ渡す。
VS Code 上の UI 操作は本件の実験範囲外である。

### 契約・成立条件・影響

[仕様 §4.2](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/docs/spec/spec.md#L685)は quoted-id を認め、[§6](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/docs/spec/spec.md#L733)は quoted-id 内の `#` をコメント扱いしない。
[§7.1](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/docs/spec/spec.md#L748)は継続オペレータの前にコメント行を挟むことを認める。
したがって、不正な入力を formatter へ渡した例ではない。
グラフの意味を変えない整形操作でこれらの構文を扱うと、依存関係が消え、後段の check も通り得る。
保存に使われる通常の操作で情報を失うため P1 とする。

### 反証とテストの識別力

[parser.test.ts:201](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/parser.test.ts#L201)は継続コメントを単体テストで受理する。
一方、[formatter.test.ts:46](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/formatter.test.ts#L46)は spaced ID の非 roundtrip を既知の gap として期待する。
parser の受理テストと formatter の出力テストが分かれており、入力で認めた構文を整形後も同じグラフとして読む性質を十分に区別できていない。
通常の bare ID を使った対照では問題が再現しないため、formatter 全入力の破損とは主張しない。

### 小さな改善と維持する保証

文境界は parser の statement 範囲から求め、文途中のコメントで断片を再解析しない。
ID の serializer を共有し、quoted-id が必要な値を正しく引用・エスケープする。
まず回帰テストで、正規化した辺、ノード種別、孤立ノードが整形前後で同値であることを検証する。
出力を再解析して error の有無だけ見る検査では、今回の0辺化を防げない。
保存前の意味比較を恒久的に毎回実行するかは費用と合わせて選び、同じ全解析を無条件に重ねる設計は要求しない。
正準順序、コメント保持、CRLF、frontmatter の CST による表記保持を維持する。

## C2 — P2: 複数ファイル検査の成功が示す範囲が不明確

### 確認した動作

親を次の内容にする。

```pfdsl
---
process:
  P:
    subflow: child.pfdsl
---
a >> P -> b
```

子の内容を次のようにすると、`check child.pfdsl --json` は V001 で exit 1 になる。
同じ時点の `check parent.pfdsl --json` は `{"ok":true,"diagnostics":[]}` と exit 0 を返した。

```pfdsl
a >> Q -> b
a >> R -> b
```

次に、子は `a >> Q -> b` とし、Q の `subflow` に `grandchild.pfdsl` を指定する。
孫を `x >> R -> y` にすると、子を直接 check した場合は入力側・出力側の V034 が2件出るが、親の check は診断なしで成功した。

また、`extends: preset.yaml` を持つ entry の check は、preset が `statusStyles: [` という不正 YAML でも、`statusStyles.done.unknown_style: red` という既知の許容属性外の設定でも、診断なしで成功した。
対照として preset に `artifact: { a: {} }` を書くと、V028 と exit 1 を返した。
つまり複数ファイル検査全体が動いていないのではなく、診断の種類・参照位置によって検査範囲が異なる。
結果は [results.json の multifile](evidence/core-cli/results.json)にある。

### 呼出し経路と根本原因

[runCheck:415](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/cli/src/index.ts#L415)は entry を analyze して診断を確認する。
次に [fileLoader:348](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/cli/src/index.ts#L348)を使う再帰 loader で依存先の `AnalyzeResult` を取得するが、CLI はその文書自身の診断を集約しない。
[loadSubflowGraph](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/multifile.ts#L73)は読込文書を保持し、path 不在・循環を検出する責務であり、最低限の文書型も [frontmatter だけ](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/multifile.ts#L55)である。

CLI の [境界検査ループ:455](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/cli/src/index.ts#L455)は entry の process だけを回す。
読み込んだ子の辺を直接境界の集合計算へ使う一方、子が持つ孫との境界は検査しない。
extends 側では [490行](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/cli/src/index.ts#L490)で全 preset の top-level whitelist を確認するが、構文や style の診断を集約しない。
不正 YAML の `frontmatter: null` は [validatePresetKeys:498](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/multifile.ts#L498)で空の診断になる。

### 確認済みの欠落と、必要な契約判断

依存先のエラーが entry の check に現れないことは実証済みである。
ただし、仕様は「entry を check すると全 descendant の単体診断も集約する」と明言していない。
[§2.9.1](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/docs/spec/spec.md#L447)は V001 等がファイル単位で成立することを定め、ファイル間で ID や status を平坦化して検査することを要求していない。
このため、子の V001 非集約を、それだけで全面的な再帰検証仕様への違反とは断定しない。

一方、[§15.11](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/docs/spec/spec.md#L1098)は展開プロセスの境界整合を、[§2.9.5](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/docs/spec/spec.md#L572)は preset が presentation の YAML であることを定める。
成功出力は、読み込んだ preset が解析可能か、どの親子境界まで確認したかを示していない。
問題の中心は、依存ファイルを調べる check の成功と、利用者が得られる検証範囲の情報が対応していない点にある。

### 成立条件・影響・反証

entry と直接の子の境界集合が合い、内部エラーまたは孫の境界だけが壊れている場合に、親の成功結果だけでは不整合を把握できない。
これはファイル書換えを行う障害ではなく、親の check を依存全体の確認として利用する運用に影響するため P2 とする。
全 `.pfdsl` を別途検査する運用では子の V001・孫の V034 を捕捉できるため、「どの運用でも検査不能」とは主張しない。
plain YAML preset をすべて `.pfdsl` と同じ入口へ渡せるとも仮定しない。

[CLI の multifile テスト](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/cli/src/index.test.ts#L1852)は直接境界、パス不在、preset whitelist を扱う。
今回の直接 check との対照は、子内部エラー・孫境界・不正 preset の差を示す。
[render の継承解決](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/multifile.ts#L450)は診断を落とす lenient な方針を明記しており、その fallback 自体は本所見の欠陥扱いに含めない。

### 小さな改善と維持する保証

まず、読み込んだ依存の解析失敗を回収し、解析不能な子の部分結果から境界妥当性を判定しない。
次に、entry の check が全 descendant の単体診断・境界まで保証するか、entry と直接境界を保証するかを決め、出力・help・テストに検証範囲を明記する。
全依存閉包の検査を唯一の改善案とはしない。
全体検査を選ぶ場合も、一度ロードした文書と診断を使い、同じ子を親ごとに再解析しない。
path を持つ診断にして問題の所在を保つ。
ファイルローカル ID、subflow を複製しない意味論、共有子の一度だけのロード、通常 query の単一ファイル性は維持する。
成功をキャッシュする設計を将来入れる場合は、選択した検証範囲の各ファイルが変わった時点で結果を失効させる必要がある。
今回、キャッシュの実装や失効不具合を実証したわけではない。

## C3 — P2: YAML と型付き frontmatter の境界が consumer ごとに異なる

### 確認した動作と対照

```pfdsl
---
artifact:
  a:
    parts: 42
---
a >> P -> b
```

`run(["check", "-"], {readStdin})` と `render` は、いずれも `TypeError: number 42 is not iterable (cannot read property Symbol(Symbol.iterator))` を投げ、`CommandResult` を返さなかった。
実ファイルの `extends: 42` を check すると `TypeError: value.includes is not a function`、次の空 process 宣言を持つファイルでは `TypeError: Cannot read properties of null (reading 'subflow')` となった。

```pfdsl
---
process:
  P:
---
a >> P -> b
```

対照として `artifact.a.label: 42` は check・render とも exit 0 であり、DOT に表示値 `42` が現れた。
[仕様の label 説明](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/docs/spec/spec.md#L108)は数値拒否を明記していないため、この数値 label は欠陥から除外する。
実測の例外と正常出力は [results.json の types 配列](evidence/core-cli/results.json)にある。

### 呼出し経路と根本原因

[loadFrontmatter:118](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/frontmatter.ts#L118)は YAML の構文解析に成功した object を、shape を確かめず `Frontmatter` に cast する。
`analyze → validate → partsMembership` の [for-of](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/rules/parts.ts#L19)は、数値 `parts` を診断へ変換できない。
`runCheck → loadExtendsChain → resolveRefPath → isUrlLike` は、数値を [文字列として処理](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/multifile.ts#L18)する。
`runCheck → loadSubflowGraph → collectSubflowRefs` は [空の process 値](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/multifile.ts#L48)を直接参照する。
CLI の [最上位](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/cli/src/cli.ts#L5)にも、この種の例外を診断形式へ整える境界はない。

空宣言については単なる未対応入力ではない。
[validator.test.ts:150](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/validator.test.ts#L150)は空 process の非クラッシュを、[rules.test.ts:122](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/rules/rules.test.ts#L122)は null を空レコードへ正規化することを明示的に期待する。
しかし、その正規化は [RuleContext 内のコピー](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/rules/context.ts#L54)だけであり、別 consumer が読む frontmatter に同じ保証がない。

### 契約・成立条件・影響

[extends の型](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/docs/spec/spec.md#L76)は文字列または文字列配列、[parts](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/docs/spec/spec.md#L230)は部分成果物の集合として定められている。
それらの不適切な形状を、構造化された診断でなく実装内部の例外にしてしまう。
加えて、既に局所的には許容する空宣言でも実ファイルの check が終了する。
通常の CLI 利用や editor の途中入力を扱う API 利用者に影響するが、全 YAML 入力のクラッシュや情報漏えいを示したものではないため P2 とする。

### 小さな改善と維持する保証

YAML 値は `unknown` として受け、既知フィールドのうち consumer が前提とする shape を入口で検査する。
空の artifact/process 宣言を許容する既存方針は保ち、全 consumer が同じ正規化値を読むようにする。
未知キーの許容と既知フィールドの shape 検査を分け、大きな schema framework の追加を前提にしない。
CLI 最上位で例外を捕捉するだけでは既知入力の保証の不統一が残るため、入口の型境界を先に整える。
未知の拡張キー、任意タグ、日本語 ID、正常に扱える label の挙動を不用意に狭めない。
テストは decoder 単体に閉じず、同一入力を実ファイルの check、stdin の check、render へ渡した際の結果を区別する。

## C4 — P2: 一定の実効値のために presentation DAG を指数展開する

### 再現と一回の観測値

各階層に `aN.yaml` と `bN.yaml` を登録し、終端以外の両ファイルから次階層の2ファイルを extends する。
終端の値は全て `statusStyles.done.color: red` とする。
この Map を `buildPresentationChain("/virtual/a0.yaml", docs)` と `resolvePresentation` に渡した。
実効値は全ケースで同じ1属性だった。

| 深さ | Map に登録した文書数 | 生成 chain 要素数 | chain 作成と merge の観測時間 |
| ---: | ---: | ---: | ---: |
| 5 | 12 | 63 | 0.277 ms |
| 10 | 22 | 2,047 | 2.491 ms |
| 15 | 32 | 65,535 | 28.804 ms |
| 18 | 38 | 524,287 | 160.097 ms |

各条件につき一回の観測であり、benchmark の分布、他環境の所要時間、メモリ上限、UI の停止時間を示す値ではない。
登録した同階層の `b0.yaml` は entry `a0.yaml` から到達しないため、到達する文書は表の数より1件少ない。
再現コードと全数値は [presentation-probe.mjs.txt](evidence/core-cli/presentation-probe.mjs.txt)と [presentation-results.json](evidence/core-cli/presentation-results.json)にある。

### 呼出し経路と根本原因

`CLI render → resolveEffectiveFrontmatter → loadExtendsChain → buildPresentationChain → resolvePresentation` という経路である。
[CLI render](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/cli/src/index.ts#L2562)と [実効値解決](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/multifile.ts#L463)で利用される。
loader は共有 preset の読込をまとめるが、[buildPresentationChain:417](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/multifile.ts#L417)は現在経路の cycle guard だけを持ち、共有子を経路ごとに再展開する。
今回の深さ d の入力では、chain の長さは `2^(d+1)-1` となる。
同じファイルを何回読むかという制御と、読み込んだ結果を何回展開するかという制御が分かれている。

### 契約・成立条件・影響・反証

[仕様 §2.9.4](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/docs/spec/spec.md#L527)が要求する結果は、指定順の深マージで得る実効 frontmatter である。
「全単純経路を出力する」graph path と違い、一定の実効値を得るために全経路の列を成果物として作る必要はない。
diamond の重なる有効な継承 DAG で、入力ファイル数・結果の大きさからは不要な計算と割当てが増えるため P2 とする。
38文書で必ず操作不能になる、通常の浅い preset でも問題が顕在化する、という主張はしない。

[multifile.test.ts:692](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/packages/core/src/multifile.test.ts#L692)の diamond テストは、ロード済み文書数と診断を確かめる。
その保証は成立していても、後段の経路展開量までは抑えない。
全ケースで結果の値は正しいため、本件は merge 値の誤りではなく不要な中間表現の増大として扱う。

### 小さな改善と維持する保証

一回の解決の中で、ファイルごとの解決済み frontmatter をメモ化し、親は指定順にその実効値を深マージする。
これにより、変更監視や永続キャッシュの失効を新規に導入せず、同じ invocation 内の再計算を省ける。
現在の chain に単純な visited-set を追加するだけでは不十分である。
後の枝が継承する base の値も完全な実効値の一部なので、先の枝の override を後から上書きする場合がある。
その意味を失わないよう、[仕様の完全な resolve 値](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/docs/spec/spec.md#L529)をキャッシュする。
順序による後勝ち、属性単位の深マージ、ローカル最優先、循環診断、共有ファイルの読込回数を維持する。

## 再現方法と証拠の扱い

親監査者が対象 commit の build 後に、次の standalone probe を実行した。
本レポート作成時に、出力 JSON と probe 本体を読み戻した。

```sh
node /path/to/pfdsl/audit-2026-09-08/evidence/core-cli/reproduce.mjs
node /path/to/pfdsl/audit-2026-09-08/evidence/core-cli/presentation-probe.mjs
node /path/to/pfdsl/audit-2026-09-08/evidence/core-cli/cli-boundary-probe.mjs
```

[reproduce.mjs.txt](evidence/core-cli/reproduce.mjs.txt)は core/CLI dist を絶対パスで import し、型・multifile の再現には一時ディレクトリ内の fixture を使う。
[cli-boundary-probe.mjs.txt](evidence/core-cli/cli-boundary-probe.mjs.txt)は実 CLI の `fmt --write` を起動して fixture を読み戻す。
同 probe の diff 比較は別担当の監査証拠であり、このレポートでは formatWrite の結果だけを使用した。
出力先は probe 内の `/tmp/pfdsl-audit/core-cli` であり、保存した evidence の JSON を上書きする構成ではない。
別 checkout で再実行する際は import 先と一時出力先を自分の環境に合わせ、当該出力先ディレクトリを用意する必要がある。
fixture の一部は同一実験内で内容を差し替えるため、実験後の fixture 一覧だけで過去の全ケースを再構成せず、probe と結果 JSON を対にして読む。

## 確認範囲と未確認箇所

| 領域 | 確認した内容 | 検証の限界 |
| --- | --- | --- |
| lexer / parser / normalize | ID、quoted-id、継続、型推論、重複辺、部分結果の経路。 | 全 Unicode、全 malformed token 組合せの網羅ではない。 |
| validator | RuleContext とルール配列、完全性、DAG、parts、revises、status、shape の責務配置。 | 全ルールの全分岐を本監査で個別再実行していない。 |
| formatter / CST / edit | 本文の分割と serialize、frontmatter 書換え、sort / reindex / insert-definition、CLI 保存前検査。 | 同時書込み、ディスク障害、全 YAML 表記の roundtrip は未確認。 |
| graph / query / status | graph 構築、隣接と closure、CLI の error gate、roadmap type 制約、ready / blocked の計算経路。 | graph path の大規模全経路出力、深いグラフの stack 上限は未測定。 |
| multifile / presentation | 再帰ロード、直接境界、preset whitelist、継承 chain、実効値 merge。 | OS 別 path、symlink identity、子からの extends を含む全組合せは未確認。 |
| CLI 入口 | command metadata、strict な flag 解析、I/O、JSON 失敗の経路。 | 並行 `run` の host override、全 OS の標準入力・出力障害は未確認。 |

通常スイートは親監査側が一度実施し、その実施記録は総合レポートに集約する。
本担当は通過済みスイートを重ねて実行せず、上記の小さな反例と対照を用いた。
通過した通常テストは、今回の検証境界をまたぐ反例を否定する根拠として扱わない。
`status ready --best` の補助候補は実証を完了していないため、採用した4所見には含めない。
この監査は主要境界を優先したものであり、コードベースの欠陥を完全に列挙したとは主張しない。
