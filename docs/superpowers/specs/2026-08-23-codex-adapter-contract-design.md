# Harness Capability Contract Design

## Goal

#956 で導入した dual-harness generator を、Claude Code と Codex が中立 capability model を並列に消費する構造へ改める。
どちらか一方へ新しい component、manifest field、hook event、command 表現、agent 表現を追加したとき、もう一方の扱いが未分類なら生成を明示的に失敗させる。

## Context

#956 は、Claude Code 形式を短期の編集元として維持し、共有 inventory と harness adapter の境界を導入した。
現行の runtime pipeline では、Claude adapter output が Codex plugin assembly の入力になっている。
この依存を検査対象として強化すると、Claude Code 側の変化だけが互換性判断の起点になり、#956 で一時的とした主従関係を変換契約として固定する。

#981 では本文の編集元を `.claude` から移さない。
ただし、`.claude` は当面の source encoding として扱い、変換の意味と各 harness の処分は中立 capability model に移す。
完全な中立 source への移行は、source decoder を差し替える後続作業として保留する。

## Architecture

変換を source decoding、capability contract、harness encoding の三層へ分ける。

1. Source decoder が現在の `.claude` tree、repository settings、plugin metadata を読み、中立 capability record を作る。
2. Harness capability contract が各 capability に対する Claude Code と Codex の処分を保持する。
3. Claude adapter と Codex adapter が同じ capability record と contract を並列に消費し、それぞれの output を生成する。

Codex adapter は生成済み Claude root を入力にしない。
Claude adapter output と Codex adapter output は、drift gate と consumer validation で初めて合流する兄弟成果物とする。

## Residual source asymmetry

今回の変更後も、`.claude` は maintained source と `claude-repository` delivery の実体を兼ねる。
`claude-repository` の native mapping は同じ maintained source を参照し、Claude adapter がその場所へ書き戻すことはしない。

したがって、source storage まで完全に対等になるわけではない。
対等にする範囲は、capability の意味、四つの delivery target の処分、各 target の検証、Claude plugin と Codex outputs の生成判断である。
残る source storage の非対称性は source decoder の入力境界に限定し、Codex adapter や capability contract へ伝播させない。

## Neutral capability model

各 capability record は、少なくとも次の情報を持つ。

- 安定した capability ID。
- `skill`、`command`、`agent`、`hook`、`plugin-metadata` などの kind。
- 現在の source encoding と source location。
- harness に依存しない本文、説明、識別子などの意味データ。
- Claude Code と Codex の各 delivery target に対する mapping。

Source location が `.claude` 配下にあることは、capability の意味を Claude Code が所有することを表さない。
Source decoder が Claude Code 固有の frontmatter、settings、directory layout を中立 record へ閉じ込め、両 adapter はその表現を直接読まない。

将来 source を中立 directory へ移す場合、capability ID と harness mapping を維持したまま source decoder と source location だけを変更する。

## Symmetric delivery mappings

Contract は `claude-repository`、`claude-plugin`、`codex-repository`、`codex-plugin` を対称な delivery target として定義する。
各 capability は四つの target に対する mapping を一つずつ必ず持つ。
mapping の処分は次の三種類とする。

- **native**：その harness の標準表現へ意味を変えずに出力する。
- **transform**：その harness 固有の表現へ変換し、出力 surface と consumer probe を宣言する。
- **intentional exclusion**：その harness へ出力せず、理由と利用者への影響範囲を宣言する。

特定の harness または delivery target だけに既定の処分を設けない。
一つでも target mapping が欠けた capability は、出力生成前に contract error とする。
同じ capability に複数の処分を割り当てた場合も失敗させる。

現在の command は Claude targets では native、Codex targets では skill への transform になる。
現在の agent は Claude targets では native、`codex-repository` では TOML への transform、`codex-plugin` では intentional exclusion になる。
将来 Codex 固有の能力を追加する場合も、Codex targets だけで完了せず、Claude targets の transform または intentional exclusion を同時に要求する。

## Source decoder closure

Source decoder は、自分が読む source root と schema の実在集合を全件分類する。
現行の対象は `.claude/skills`、`.claude/commands`、`.claude/agents`、`.claude/settings.json`、plugin metadata、配布 hooks である。

各既知 root 内の entry、command frontmatter field、agent frontmatter field、settings のトップレベル field、hook event、hook entry field を観測集合として列挙する。
decoder が知らない root または field を観測した場合、source path、surface kind、未分類名を含むエラーを返す。

公式仕様に存在していても、このリポジトリが source として採用していない surface は先回りして分類しない。
Claude Code 上流の未採用機能を定期取得または監視することは、この closure の責務ではない。

## Adapter output closure

各 harness adapter は、自分が生成する output surface を contract mapping から導出する。
Claude Code と Codex の root、manifest、repository asset をそれぞれ実在集合として列挙し、宣言済み output surface と突合する。

新しい output root または manifest field が生成されたのに対応する mapping が無い場合、その harness の adapter が失敗する。
一方の output 集合を他方の期待値として使わない。
各 delivery target の closure test は同じ検査関数と同じ contract schema を使い、対象 target だけを引数で切り替える。

共通 plugin metadata は capability record から両 manifest builder へ渡す。
Claude manifest を作ってから Codex manifest の入力へ戻す経路は作らない。
`repository`、`skills`、`interface` など片方だけが必要とする field は、該当 harness mapping の output として宣言する。

## Probe requirements

Native または transform の mapping は、対象 delivery target の生成物だけを読む consumer probe の種別と対象 output を宣言する。
Claude probe は Codex tree を参照せず、Codex probe は Claude tree を参照しない。
Contract test は各宣言を実際の probe fixture と対応づけ、宣言だけで未検証の mapping を残さない。

Intentional exclusion は、理由と影響範囲を空でない文字列として保持する。
Exclusion fixture は、mapping を除くと未分類エラーになる capability を作り、mapping がある場合は対象 delivery target の output へ能力が混入しないことを確認する。

対称性そのものも fixture で検査する。
四つの target mapping を一件ずつ欠落させ、どの target でも同じ missing-mapping error になることを確認する。

## Generation flow

1. Maintainer が現在の source encoding を編集する。
2. Source decoder が全入力を中立 capability records へ変換し、未知 topology と未知 schema を拒否する。
3. Contract checker が各 capability に四つの target mapping が一意に存在すること、probe 宣言、exclusion metadata を検査する。
4. `claude-repository` の native target を maintained source 上で検証し、Claude plugin adapter と Codex adapter が同じ capability records を別々の一時 root へ変換する。
5. 各 adapter の output closure と harness-only consumer probes を実行する。
6. 既存の atomic publish が両 root と repository assets をまとめて置換する。
7. 既存の drift gate が追跡済み生成物との差分と未追跡生成物を検査する。

未分類表現は adapter input の段階で止まり、片側だけの未分類 output は各 adapter の closure で止まる。
生成後の diff が変化しない場合でも、contract と観測集合の不一致が独立して失敗する。

## Failure messages

Source decoding error は、source path、surface kind、未分類名を表示する。
Missing mapping error は、capability ID と不足している delivery target を表示する。
Duplicate mapping error は、capability ID、delivery target、競合する処分を表示する。
Probe 宣言の不足と exclusion metadata の不足は contract 定義時に失敗させ、生成物の diff として遅れて報告しない。
Output closure error は、harness、未宣言 output surface、生成元 capability ID を表示する。

## Operational guidance and PFD updates

`.pfdsl/runtime-pipeline.md` に、source topology、capability schema、delivery mapping、output surface を変更する前に四つの target の処分と probe を決める手順を追加する。
この手順は Claude Code 変更時と Codex 変更時に同じ条件で発火する。

`.pfdsl/runtime-pipeline.pfdsl` は source decoding と中立 capability model を表す process と artifact を追加する。
`claude_adapter_output >> assemble_codex_plugin` の依存を削除し、Claude adapter と Codex adapter が中立 model を並列に消費する edge へ置き換える。
`harness_inventory`、両 adapter process、両 adapter output、drift gate の description と criteria は contract check の実体に合わせて更新する。

新しい retro pattern は作らない。
既存の「検査対象を手列挙で指定する trap」に #956 と #981 の具体例を統合し、同じ問いの構造を別ファイルへ分裂させない。
Pre-artifact の確認は runtime-pipeline companion に置き、retro pattern の全サイクル向け一覧を専用手順の代用にしない。

## Testing strategy

実装は t-wada 流 TDD で進める。
最初の failing fixture は、欠落 target mapping、未知 source root、未知 source field、未知 hook event、未宣言 output surface を順に追加する。
各 fixture は capability ID、delivery target、surface kind、未分類名のうち判断に必要な値を含むエラーを期待する。

三角測量として、native、transform、intentional exclusion の正常系と、重複 mapping、理由なし exclusion、probe なし mapping の異常系を追加する。
Claude-only consumer probe と Codex-only consumer probe は別 fixture root で実行し、兄弟 output への参照が無いことを検査する。

既存回帰検査は Claude plugin strict validation、Codex plugin validation、Claude output identity、Codex-only consumer、generator transaction、drift gate を含む。
文書変更後は Markdown linebreak check、retro pattern check、変更した PFD の strict check、graph IO、link check を実行する。

## Acceptance criteria

- 四つの delivery target mapping を一件ずつ欠落させた capability が、対称な missing-mapping error で失敗する。
- 未知 source root、source schema field、hook event、adapter output surface の各 fixture が明示的に失敗する。
- 新しい capability は、四つの delivery target の各々に native、transform、intentional exclusion のいずれか一つを持たなければ生成できない。
- Native と transform は対象 delivery target だけを読む consumer probe で検証される。
- Intentional exclusion は理由と影響範囲を共有 contract から機械的に取得できる。
- Codex adapter は生成済み Claude root または Claude manifest を入力にしない。
- 既存の Claude Code output identity、Claude plugin strict validation、Codex plugin validation、atomic generation を壊さない。

## Non-goals

- 本文を中立 source へ移し、`.claude` 自体を生成物にすること。
- Claude Code 上流または Codex 上流の仕様変更を定期取得または監視すること。
- このリポジトリがまだ採用していない公式 surface を先回りして分類すること。
- Claude Code と Codex の plugin root を統合すること。
- Plugin、CLI、VS Code extension を公開すること。
