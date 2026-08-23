# Codex Adapter Contract Design

## Goal

#956 で導入した共有 inventory と harness adapter の境界を拡張し、Claude Code 側へ新しい plugin component、manifest field、hook event、command frontmatter、agent frontmatter を追加したとき、Codex 側の扱いが未分類なら生成を明示的に失敗させる。

## Context

#956 は、Claude Code 形式を短期の正本として維持し、共有 inventory から Claude Code と Codex の出力を生成する境界を導入した。
現行の inventory completeness test は `.claude/skills`、`.claude/commands`、`.claude/agents` の既知 root 内にある entry を全件分類する。
一方で、root、manifest field、hook event、frontmatter field の集合自体は adapter 内の個別定数と分岐に分散している。
このため、既知集合の外に新しい表現を足した変更は、その表現を inventory や adapter が観測しなければ既存出力を再生成して正常終了できる。

#981 は Claude Code 上流の未採用機能を監視する仕組みではない。
このリポジトリが #956 の変換境界へ新しい Claude Code 表現を取り込む時点を検出対象とする。

## Adapter contract

共有 inventory に **adapter contract** を追加する。
adapter contract は、Claude Code 側で観測した表現ごとに Codex 側の処分を一つだけ割り当てる。

- **identity copy**：意味を変えずに Codex 出力へ複製する。
- **Codex transform**：Codex の表現へ変換し、変換先と検証 probe を対応づける。
- **intentional exclusion**：Codex 出力へ含めず、除外理由と利用者への影響範囲を記録する。

処分を generator と test に別々に列挙しない。
両者は同じ contract を読み、同じ表現が複数の処分へ入ることも、どの処分にも入らないことも失敗として扱う。

## Contract surfaces

### Claude plugin root

Claude adapter が生成した plugin root のトップレベル entry を実在集合として列挙し、contract の component 分類と突合する。
現行の `skills`、`commands`、`agents`、`hooks`、`.claude-plugin` を最初の対象とする。
`.claude-plugin/plugin.json` は manifest contract へ渡し、bundle manifest のような生成器 bookkeeping は intentional exclusion として理由を持たせる。

公式仕様に存在していても、このリポジトリが生成していない component は先回りして分類しない。
将来このリポジトリが新しい root を生成した時点で、実在集合との不一致が分類を要求する。

### Claude plugin manifest

Claude plugin manifest の実際のキー集合を列挙し、manifest field contract と突合する。
`name`、`description`、`version`、`author`、`homepage`、`license` の現行キーには、Codex manifest での identity copy または transform を割り当てる。
Codex 側だけで合成する `repository`、`skills`、`interface` は Claude field の処分と混ぜず、Codex-only output として別に宣言する。
Claude manifest builder に新しいキーを追加して contract を更新しなかった場合、Codex manifest の生成前に失敗する。

### Command and agent frontmatter

command と agent の既存 frontmatter allowlist を処分付き contract に置き換える。
command の `description` と、agent の `name`、`description`、`tools`、`model` は現行変換へ対応づける。
未知キーを拒否する既存挙動は維持し、エラーには source path、表現種別、未分類キーを含める。

### Repository settings and hooks

`.claude/settings.json` のトップレベルキーと `hooks` 内の event 名を別々に分類する。
Codex repository hooks へ渡す field と、Claude Code の permission 設定として除外する field を contract に記録する。
hook payload の matcher と command entry は現行 adapter が意味を保存できる範囲を fixture で固定する。
新しい event または entry field が追加された場合、明示的な transform または exclusion が無ければ失敗する。

## Enforcement flow

1. Claude adapter が一時 root へ既存どおり出力する。
2. Generator が一時 root、manifest、maintained command、maintained agent、repository settings から観測集合を作る。
3. Contract checker が各観測集合と分類集合の完全一致、一意な処分、exclusion metadata、transform の probe 種別と対象出力の宣言を検査する。
4. 検査に通った Claude output と共有 contract だけを Codex adapter へ渡す。
5. Codex adapter が一時 root と repository assets を生成する。
6. 既存の atomic publish と drift gate が、Claude root、Codex root、repository assets をまとめて確定または比較する。

Contract check は Codex 出力後の diff だけに依存しない。
未分類表現を adapter 入力の段階で止めることで、「既知 path の出力が変わらなかったため正常終了する」という #981 の失敗経路を塞ぐ。

## Probe requirements

Codex transform の各分類は、生成済み Claude tree を参照せずに変換結果を検査する Codex-only consumer probe の種別と対象出力を宣言する。
probe は Codex root または repository Codex asset だけを入力とし、分類した能力が利用面に現れることを確認する。
Contract test は各宣言を実際の probe fixture と対応づけ、宣言だけで未検証の transform を残さない。

Intentional exclusion の各分類は、理由と影響範囲を空でない文字列として保持する。
exclusion fixture は、分類を除くと未分類エラーになる入力を作り、分類がある場合は該当能力が Codex 出力へ混入しないことを確認する。
これにより、除外理由の記録と fail-closed の両方を同じ fixture で検査する。

## Failure messages

未分類エラーは、観測元、surface kind、未分類名、必要な処分を表示する。
重複分類エラーは、同じ表現へ割り当てられた処分を列挙する。
probe 宣言の不足と exclusion metadata 不足は contract 定義時に失敗させ、生成済み出力の diff として遅れて報告しない。

## Operational guidance and PFD updates

`.pfdsl/runtime-pipeline.md` の dual-harness adapter 境界に、Claude Code の root、manifest field、hook event、command 表現、agent 表現を変更する前に contract 分類と probe を決める手順を追加する。
`.pfdsl/runtime-pipeline.pfdsl` は `harness_inventory`、`gen_plugin`、`assemble_codex_plugin`、両 adapter output の description と criteria を contract check の実体に合わせて更新する。

新しい retro pattern は作らない。
既存の「検査対象を手列挙で指定する trap」に #956 と #981 の具体例を統合し、同じ問いの構造を別ファイルへ分裂させない。
pre-artifact の確認は runtime-pipeline companion に置き、retro pattern の全サイクル向け一覧を専用手順の代用にしない。

## Testing strategy

実装は t-wada 流 TDD で進める。
最初の failing fixture は、未知 plugin root、未知 manifest field、未知 hook event、未知 command frontmatter、未知 agent frontmatter をそれぞれ一件ずつ注入し、surface kind と未分類名を含むエラーを期待する。
三角測量として、identity copy、Codex transform、intentional exclusion の正常系と、重複分類、理由なし exclusion、probe なし transform の異常系を追加する。

既存回帰検査は Claude plugin strict validation、Codex plugin validation、Claude output identity、Codex-only consumer、generator transaction、drift gate を含む。
文書変更後は Markdown linebreak check、retro pattern check、変更した PFD の strict check、graph IO、link check を実行する。

## Acceptance criteria

- 未知 plugin root、manifest field、hook event、command frontmatter、agent frontmatter の各 fixture が明示的に失敗する。
- 新しい Claude surface は、identity copy、Codex transform、intentional exclusion のいずれか一つを持たなければ生成できない。
- Codex transform は Claude tree を参照しない consumer probe で検証される。
- Intentional exclusion は理由と影響範囲を共有 inventory から機械的に取得できる。
- 既存の Claude Code output identity、Claude plugin strict validation、Codex plugin validation、atomic generation を壊さない。

## Non-goals

- Claude Code 上流の仕様変更を定期取得または監視すること。
- このリポジトリがまだ生成していない公式 plugin component を先回りして分類すること。
- Claude Code 形式から中立 canonical source へ移行すること。
- Claude Code と Codex の plugin root を統合すること。
- plugin、CLI、VS Code extension を公開すること。
