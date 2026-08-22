# Claude Code / Codex Dual-Harness Distribution Design

## Goal

Claude Code の既存開発・配布経路を維持しながら、Codex の開発者と plugin・skill 利用者が Claude Code の導入や import 操作なしに同等の PFD ワークフローを利用できる配布基盤を構築する。

## Context

現在の編集元、生成器、drift 検査、release 手続きは `.claude/skills`・`.claude/agents`・`.claude/commands` と Claude Code plugin manifest を中心に構成されている。
Codex アプリの Claude Code import は開発者個人の移行には使えるが、配布物の利用者に別ハーネスの導入または import を要求するため、製品の対応ハーネスには数えない。
短期的には Claude Code 形式を canonical input として維持し、中期的に中立な canonical source へ移せる変換境界を先に作る。

## Design decisions

### Canonical input and compatibility

`.claude/skills`、`.claude/agents`、`.claude/commands` は今回の変更では canonical input のまま維持する。
既存の Claude Code 出力は現在の生成結果と identity-compatible に保ち、Codex 対応のために既存利用者の導入・実行経路を変更しない。
中立形式への移行は別サイクルとし、今回導入する harness adapter の入力側を差し替えることで実行できる構造にする。

### Harness-neutral inventory

配布対象の列挙は「Claude plugin に何をコピーするか」ではなく、「製品能力としてどの skill・command・agent・hook を配布するか」を表す inventory に寄せる。
inventory の各項目は maintained source と harness ごとの出力先・変換方法を対応付ける。
Claude Code と Codex の生成器は同じ inventory を消費し、個別の allowlist を別々に持たない。

### Harness adapters

Claude Code adapter は既存の skill tree、Markdown command、Markdown agent、hooks、`.claude-plugin/plugin.json` を生成する。
Codex adapter は同じ能力から Codex skill、TOML subagent、Codex hooks、`.codex-plugin/plugin.json` を生成する。
共通の Markdown 本文や references はコピーで済ませ、frontmatter、tool 宣言、変数、パス、command invocation のようにハーネス意味論が異なる箇所だけを明示的な変換関数で扱う。
文字列置換の連鎖や、Codex の Claude Code import 実装をビルド依存にしない。

### Separate official plugin roots

公式 Codex validator/runtime は plugin root の `skills/` を固定して検証・実行するため、単一 root の `skills/` には Claude Code と Codex の異なる skill tree を共存させられない。
したがって、既存の `plugin/pfdsl/` は Claude Code root として変更せず、Codex native output は `plugin/pfdsl-codex/` を独立した公式 root として生成する。
両 root は同じ inventory から導出し、単一の drift gate が Claude root、Codex root、repository Codex assets をまとめて再生成・比較する。

### Repository development assets

リポジトリ開発用には root `AGENTS.md`、`.agents/skills`、`.codex/agents`、`.codex/hooks.json` を生成する。
`CLAUDE.md` と `.claude` の内容を手で複製せず、配布 inventory と同じ adapter を利用する。
生成された Codex 資産は手編集禁止とし、生成元・生成先・再生成コマンドをファイルまたは隣接ドキュメントに明記する。

### Consumer distribution

`plugin/pfdsl/` は既存の Claude Code 配布 root として維持し、`plugin/pfdsl-codex/` は Codex native 配布 root とする。
Codex 利用者は Claude Code をインストールせず、Codex の plugin または skill 導入面だけで利用できることを受け入れ条件にする。
Claude Code 利用者の既存 marketplace 経路は維持する。
公開操作は本 issue の対象外とし、生成物が公開可能であることまでを実装・検査する。

## Generation flow

1. Maintainer が canonical input を編集する。
2. Harness-neutral inventory が配布対象と変換種別を列挙する。
3. Claude Code adapter が `plugin/pfdsl/` を、Codex adapter が `plugin/pfdsl-codex/` と repository Codex assets を生成する。
4. 結合 drift gate が両 plugin root と repository Codex assets を再生成し、追跡済み生成物と比較する。
5. Pre-commit と CI がどちらか一方だけの更新、未登録資産、変換不能な harness-specific construct を拒否する。

## Failure handling

変換できない harness-specific construct は黙って削除せず、source path と construct を示して生成を失敗させる。
Codex で未対応の能力がある場合は、その能力だけを除外する理由を inventory に明示し、Claude Code 側の暗黙 allowlist として表現しない。
生成途中で失敗した場合は一時ディレクトリから出力先を置換する既存の atomic mirror 方針を維持し、半生成状態を残さない。

## Testing

生成器の変更は t-wada 流 TDD で進める。
単体テストは inventory から両ハーネスの出力集合が導出されること、agent と command の変換、unsupported construct の fail-closed、既存 Claude Code identity を検証する。
統合テストは repository assets、`plugin/pfdsl/`、`plugin/pfdsl-codex/` を一時ディレクトリへ生成し、追跡済み成果物と一致することを検証する。
文書・PFD検査は `workflow.pfdsl` と `runtime-pipeline.pfdsl` が canonical input、両 adapter、二つの plugin root、結合 drift gate の変換関係を表すことを確認する。
最終検証は build、test、typecheck、lint、docs checks、変更した PFD の strict check を含む。

## Migration path

今回の完了後も maintained source path は `.claude` に残るが、配布対象の意味と harness 出力の意味は inventory と adapter に分離される。
将来の中立 canonical source 移行では、inventory の source path と共通本文の格納先を移し、Claude Code adapter と Codex adapter の出力契約を維持する。
その移行は既存 Claude Code identity と Codex identity を同じテストで保持したまま行う。

## Non-goals

- 今回の変更で canonical source を中立ディレクトリへ移すこと。
- Claude Code 対応を削除または縮小すること。
- Codex の import 機能を配布経路として採用すること。
- plugin、CLI、VS Code extension を公開すること。
