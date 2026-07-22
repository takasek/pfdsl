# ADR-0032: pfd-ops 配布物を専用ディレクトリ `scripts/pfdsl/` に隔離する

- Status: Accepted
- Date: 2026-07-22

## Context

ADR-0028 以降、`install/` の実体は `scripts/audit-issues-flow.mjs` / `scripts/normalize-pfdsl.mjs` / `scripts/lib/{issues-flow-audit,gh-exec,gh-compat,github-rest,proxy-fetch,proxy-fetch-worker,yaml-require}.mjs` として採用リポの `scripts/lib/` 直下に実配置される。採用リポ側の開発者から見ると、`scripts/lib/gh-exec.mjs` のようなファイル名だけでは pfdsl 由来の配布物なのか自リポ独自のスクリプトなのか区別がつかない。将来 pfdsl 側がこれらのファイルを削除した場合、`check-install-sync.mjs` の manifest ベース orphan 検出機構自体は追跡できるが、由来を知らない開発者にとって `scripts/lib/` 直下に出自の異なるファイル群が混在し続けること自体が可読性上の負債になる。

対応として、配布可能ファイルを実行するワークフロー本体（`.github/workflows/flow-on-issue-close.yml`）が node script を直接呼ぶ構成をやめ、composite action を `uses: ./scripts/pfdsl/actions/flow-sync` で呼ぶだけの薄い構成に変更し、実体スクリプトを pfdsl 専用ディレクトリ `scripts/pfdsl/` へ集約する案を検討した。

ADR-0016 は過去に「composite action 経由で呼ぶ」設計を却下している:

> 却下した代替案: composite action 経由で呼ぶ: cross-directory coupling が生じ、GitHub Actions の working directory context の問題が残る

調査の結果、この却下は PR #56 時点の実装（`.claude/skills/pfd-ops/actions/flow-sync/action.yml` を配布先ワークフローから `uses: ./.claude/skills/pfd-ops/actions/flow-sync` で呼ぶ形）に基づくもので、当時 canonical `install/` を採用リポにそのまま `cp -r` 複製する規約だったことが前提になっていた。composite action を使うと配布物が「workflow 1 ファイル」ではなく「workflow + それが参照する action.yml のディレクトリ一式」に分裂し、`uses: ./相対パス` が配布先リポでも同一ディレクトリ構造を保つことを要求する。これが cross-directory coupling の実体であり、`install/` の単純な `cp -r` 規約と衝突していた。

ADR-0028 で採用リポはもう canonical `install/` を持たず、`/pfd-init` が plugin 同梱 canonical から実配置するだけになっている。配置先ディレクトリ構造は `/pfd-init`（実体は `check-install-sync.mjs --deploy`）側で自由に設計できるようになっており、ADR-0016 が却下した当時の前提はすでに崩れている。

## Decision

配布物の配置ルールを次の非対称マッピングに変更する:

- `.github/workflows/pfdsl-flow-on-issue-close.yml`（リネーム）: 薄い呼び出し役としてリポ標準パス `.github/workflows/` に配置する（GitHub Actions の性質上ここは動かせない）。`.github/workflows/` 直下は採用リポの他ワークフローと混在するため、ファイル名に `pfdsl-` prefix を付けて由来を明示する。中身は checkout + `uses: ./scripts/pfdsl/actions/flow-sync` の呼び出しのみ。
- 実体（audit/normalize スクリプト・`lib/*`・composite action 本体・PR 作成ロジック）はすべて `scripts/pfdsl/` 配下に集約する:
  - `scripts/pfdsl/actions/flow-sync/action.yml`（composite action。PR 作成ステップ `peter-evans/create-pull-request` も含めて完結させる — ワークフロー側に実質的なロジックを残さないため）
  - `scripts/pfdsl/audit-issues-flow.mjs` / `scripts/pfdsl/normalize-pfdsl.mjs`
  - `scripts/pfdsl/lib/{issues-flow-audit,gh-exec,gh-compat,github-rest,proxy-fetch,proxy-fetch-worker,yaml-require}.mjs`

composite action の `run:` ステップは `${{ github.action_path }}` に頼らず、checkout 済みのリポルート基準の作業ディレクトリ（GitHub Actions のデフォルト）から `scripts/pfdsl/...` を相対パスで呼ぶ。`__dirname` 相当の action_path 越し解決は npm install の cwd 前提と衝突しうるため使わない。

pfdsl リポ自身の運用パスもこの新パスに統一する。「配布用 install/ の実体パス」と「pfdsl 自身が dogfood する実行パス」を分けると、pfdsl 自身が自分の配布物とは違う場所で運用する矛盾を抱えるため。

## Consequences

- 採用リポに配置される node script 群は `scripts/pfdsl/` 配下にまとまり、ファイル名を見るだけで pfdsl 由来と分かる。採用リポ独自の `scripts/lib/` との混在が解消される。
- ワークフロー本体は checkout + `uses:` 1行程度の薄い構成になり、実装ロジックの変更は `scripts/pfdsl/` 側だけで完結する。
- `install/` の配置規約自体（「リポルートからの相対パスを保ったままコピーする」ADR-0016）は変更しない。`install/scripts/pfdsl/...` → `scripts/pfdsl/...` という対応関係も単純な相対パス保持のままであり、`check-install-sync.mjs` の `listInstallFiles`（ディレクトリ走査ベース）に変更は不要。
- 過去に却下された「composite action 経由」は、当時の canonical-in-repo 前提のもとでは正当な却下だった。ADR-0028 がその前提を変えたことで再評価が可能になった、という経緯を本 ADR に記録する。

## References

- ADR-0016（install/ 集約 — 本 ADR が配布物のディレクトリ構造をさらに改訂する。ADR-0016 自体の「リポルート相対パスを保ったままコピーする」という配置規約は存続）
- ADR-0028（plugin 配布移行 — canonical-in-repo 前提を崩し、配置先ディレクトリ構造の自由度を生んだ）
- `scripts/pfdsl/actions/flow-sync/action.yml` — composite action 本体
- `.github/workflows/pfdsl-flow-on-issue-close.yml` — 薄い呼び出しワークフロー
