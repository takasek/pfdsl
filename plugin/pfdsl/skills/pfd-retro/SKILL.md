---
name: pfd-retro
summary: model retrospective audit
description: |
  Use when auditing a PFD model against execution evidence, reviewing a
  diagram's dependencies or boundaries, or investigating whether observed
  work requires a model change. Returns evidence-backed execution failures,
  model revision candidates, or no-change findings. General work practices
  and knowledge-document maintenance belong to separate audits.
---
<!-- DO NOT EDIT. Authoritative source: scripts/harness-template/skills/pfd-retro/SKILL.md. -->

# PFD model retrospective

PFD の状態・構造と、版が対応した証拠を照合する。
観測された失敗をすべてモデルの欠陥へ変換しない。
結論が対象にするのは、PFD の要素、companion の構造的事実、宣言、そこから導出される状態である。

## 適用単位と入力

採用済みの任意の PFD に適用でき、roadmap の存在を前提にしない。
図だけの A・B 監査は対象モデルとその版を入力とし、実行の成功や成果物の受入まで保証しない。
実行結果との照合には、pfd-ops の `references/work-cycle.md`「実行との対応と証拠」の入力が必要である。
対象モデルの版・成果物の版・criteria と、変更パス・status 遷移・対象 PFD ファイルと process ID・実行との対応・型付きの乖離を確認する。
作業項目 backend を採用している場合は、その項目との対応も含める。
図が無い、または scaffold の場合は、その図に固有の監査だけが非適用になる。

証拠不足・版の不一致・対象ファイルを特定できない場合は、該当する判定を保留し、不足情報を示す。
これは「変更不要」という結論ではない。
証拠の収集・凍結・保存方式や、監査の実行管理はこのスキルの規則に含めない。
一般の作業実践への監査や知識成果物監査を、モデル監査から自動起動しない。

## A・B. 図の監査

`graph orphans <file>`、`graph io <file> --json`、`graph edges <file> --json` で図の輪郭を確認する。
`terminals` と `externalTerminals` の両方を対象にする。
エッジの実在性、駆動源、粒度、型、終端の消費者を、対象 node・edge・criteria と照合する。

観点カタログは、`.pfdsl/bindings/pfd-retro.md` が示す所在を使う。
指定がなければ pfdsl スキルの `references/review-perspectives.md`（plugin なら `${CLAUDE_PLUGIN_ROOT}/skills/pfdsl/references/`、repo-local なら `.claude/skills/pfdsl/references/`）を使う。
到達できなければ不足したカタログを示し、その観点の監査を保留する。
binding が指すのはカタログや対象モデルの情報であり、一般の実行手順をこのスキルへ取り込むスロットではない。
pfd-lens は同じ A・B 観点を使う読取専用の監査手段であり、利用方法は実行側が選べる。

カタログの C 系は図ではなく normative 仕様への観点で、対象仕様を保守している場合に限り適用する。
仕様の所在・適用条件が不足していれば、その判定を保留する。

## 実行証拠との照合

「作業を忘れた」「追加の作業が生じた」という観測は、構造欠落の仮説を検査する契機である。
既存の入力・criteria が十分だったのに実行が従わなかった場合と、モデル自体に必要な要素が無かった場合を分ける。
同様に、実行の分担に失敗したことだけから入力 edge を増やさない。
対象モデル・criteria と証拠のどこが矛盾するかを示す。

モデル改訂候補は次の6型と修正先を対応付ける。

| 観測された乖離 | モデルの改訂候補 |
|---|---|
| 追加の入力が必要だった | 入力 edge、必要なら入力の producer |
| 想定した工程の分割が成立しなかった | process の統合・分割 |
| feedback が必要だった | `>>?` edge、または版 artifact |
| 成果物の定義が曖昧だった | artifact の分割・改名、description・criteria |
| criteria が観測不能だった | 観測可能な criteria |
| 下流の判断を上流で先取りした | 出力の付け替え、または境界の再モデル化 |

companion の構造的事実も、対応する node・edge・境界・宣言と矛盾がないか確認する。
モデル内に表せる事実は図を正本とし、モデル間の対応だけを companion に置く。
一般の実行手順の改善を、この表の型に無理に当てはめない。

## 結論と出力

各 finding は、対象モデルの版、PFD ファイルと node・edge・criteria、対応する証拠とその版、次の結論のいずれかを示す。
行位置を示せる資料には file:line を付ける。

| 結論 | 根拠と扱い |
|---|---|
| 実行側の失敗 | 既存のモデル条件と、実行が満たさなかった条件を名指す。実行側へ返し、pfd-ops・pfd-retro の新しい規則へ変換しない |
| モデルの改訂候補 | 上の6型、観測した乖離、影響する要素、改訂候補を示す。モデル所有者の判断へ渡す |
| 変更不要 | 照合したモデル要素と具体的な証拠を名指し、変更が不要な理由を示す。単なる所見0件や実行成功では代替しない |

異なる観測には異なる結論を出せる。
未判定の観測は3値の結論を持つ finding と混ぜず、不足した入力と再判定条件を示す。
対象外の事項は、対象モデルと適用条件を示して非適用とする。
既存の規則だけで済む失敗とモデル欠陥が併存する場合は、根拠の異なる finding に分ける。

改訂候補の宛先は対象の PFD 要素と構造的 companion である。
候補の提示は変更権限を与えない。
一般の開発規律、他の道具の設定や作業記録の書式を書き換える出力は持たない。
モデル所有者が判断するための根拠と、未判定事項を渡す。

## 配布層への還流（配布機構）

モデル監査とは別に、companion に残る一般化可能な規則を `pfd-ops/references/architecture.md`「昇格先の判定ルール」の0段目で点検できる。
判定単位は規則であり、同じ節の具体例や固有名詞の存在だけで除外しない。
意味論・対象・中立性・名指しを満たす候補と、採用先の実行規律へ置くものを区別する。
情報不足は非該当とせず保留する。
scaffold の未記入行は既に配布されるため、滞留候補にしない。

この監査は配布を維持するための機構であり、中核や付属機能の範囲を広げる根拠にしない。
候補を直せるのは配布物の上流であり、採用先のコピーは編集しない。
採用先からの提案は pfd-upstream-report の経路を使い、外部書込みの権限は採用先に従う。
実行規律の宛先は、採用先から実際に読める既存の規律とする。
private な共有場所が公開された採用先から読めるとは仮定しない。
