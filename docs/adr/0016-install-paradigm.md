# ADR-0016: pfd-ops 配布可能ファイルの install/ 集約

- Status: Accepted
- Date: 2026-06-15

## Context

pfd-ops は複数リポに配布されるスキルである。配布可能ファイル（GitHub Actions workflows、 監査スクリプト）とスキル固有ファイル（ガイド文書、参照文書）が同一ディレクトリに混在すると、 「何を採用先へコピーすべきか」の境界が暗黙になる。

列挙ベースで管理する場合（MANIFEST ファイル等）は、ファイル追加時の更新漏れ（drift）が 構造的に発生する。composite action 経由で呼ぶ案は、cross-directory coupling と GitHub Actions の context 問題（`__dirname` 解決等）を生む。

PR #56 でこの問題を解決する設計を導入した。本 ADR はその決定を記録する。

## Decision

配布可能ファイルを `.claude/skills/pfd-ops/install/` ディレクトリに集約する。
`install/` 以下のファイルはリポルートからの相対パスを保ったままコピーする。

CI ワークフロー（`check-pfd-ops-sync.yml`）が canonical（`install/X`）と deployed（`X`）の identity を `diff` で強制する。

## Consequences

- 新ファイルを配布対象にするには `install/` 以下に置くだけでよい（列挙不要）
- CI が drift を検出し、canonical と deployed の乖離を PR/push 時に即座に弾く
- 採用手順は `cp -r .claude/skills/pfd-ops/install/. .` 1コマンドに集約される
- `check-pfd-ops-sync.yml` 自身も `install/` で管理されるため、CI の更新も drift 検出の対象になる

却下した代替案:
- **ファイルごとに配布対象を明示**: MANIFEST or 列挙コメントで管理 — ファイル追加時の更新漏れが構造的に発生する
- **composite action 経由で呼ぶ**: cross-directory coupling が生じ、GitHub Actions の working directory context の問題が残る

## References

- PR #56（install/ 集約の実装）
- PR #62（adopt 手順の `cp -r` 1コマンド化）
- `.claude/skills/pfd-ops/install/` — canonical ファイル群
- `.github/workflows/check-pfd-ops-sync.yml` — drift 検出 CI
