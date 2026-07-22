# ADR-0032: pfd-ops 配布物を専用ディレクトリ `scripts/pfdsl/` に隔離する

- Status: Accepted（初版は composite action 化も含めて Accepted としたが、独立レビューで棄却され本文を全面改訂。当初案の詳細は git 履歴を参照）
- Date: 2026-07-22

## Context

ADR-0028 以降、`install/` の実体は `scripts/audit-issues-flow.mjs` / `scripts/normalize-pfdsl.mjs` / `scripts/lib/{issues-flow-audit,gh-exec,gh-compat,github-rest,proxy-fetch,proxy-fetch-worker,yaml-require}.mjs` として採用リポの `scripts/lib/` 直下に実配置される。採用リポ側の開発者から見ると、`scripts/lib/gh-exec.mjs` のようなファイル名だけでは pfdsl 由来の配布物なのか自リポ独自のスクリプトなのか区別がつかない。将来 pfdsl 側がこれらのファイルを削除した場合、`check-install-sync.mjs` の manifest ベース orphan 検出機構自体は追跡できるが、由来を知らない開発者にとって `scripts/lib/` 直下に出自の異なるファイル群が混在し続けること自体が可読性上の負債になる。

### 検討したが不採用にした案: composite action 化

当初、`.github/workflows/flow-on-issue-close.yml`（node script を直接呼ぶ実装）を `uses: ./scripts/pfdsl/actions/flow-sync` を呼ぶだけの薄いラッパーに変え、実装本体を新設の composite action `scripts/pfdsl/actions/flow-sync/action.yml` に切り出す設計を一度採用した。

これは ADR-0016 が過去に却下した設計の再挑戦だった:

> 却下した代替案: composite action 経由で呼ぶ: cross-directory coupling が生じ、GitHub Actions の working directory context の問題が残る

初版では「この却下は canonical `install/` を採用リポに `cp -r` 複製していた当時の前提に基づくものであり、ADR-0028 でその前提（採用リポが canonical `install/` を持つこと）が崩れたため再評価できる」と判断した。しかし独立したレビューで、この論拠自体が誤りだと指摘された:

- ADR-0028 が変えたのは「配置先パスを誰が決めるか」（`cp -r` 規約 → `/pfd-init` の deploy 規約）だけであり、ADR-0016 が問題視した cross-directory coupling の本体 — 「配布先ワークフローが `uses: ./相対パス` で自リポの特定ディレクトリ構造に依存する」性質 — は plugin 配布に移行してもそのまま残る。採用リポが `scripts/` をリネーム・移動すればどのみち壊れる。
- 実際にはカップリング点が **増えていた**: before（`node scripts/audit-issues-flow.mjs` を直接呼ぶ）はパス依存が1箇所だったのに対し、after は workflow 側の `uses: ./scripts/pfdsl/actions/flow-sync` と action 内の `run: node scripts/pfdsl/audit-issues-flow.mjs` の2箇所がリポルート相対パスに依存し、加えて `inputs`/`outputs`（`gh-token`/`issue-number` ⇄ `pull-request-operation`/`any-failed`）という契約層まで新設していた。
- 該当 action.yml は ADR-0016 が警告したもう一つの問題（working directory context）を避けるため `${{ github.action_path }}` を意図的に使わず、リポルート相対で兄弟スクリプトを呼んでいた。これは「自身の位置を基準にできない action」であり、action という抽象の利点（自己完結・可搬・再利用）を一つも得られないまま、`inputs`/`outputs` の ceremony だけを背負う結果になっていた。
- ステップ群（setup-node / npm install / audit / normalize / local_hook / summary / create_pr）は before と after で完全に同一であり、composite action 化は複雑性を削減せず純増させていた。得られる便益（「workflow 側に実質ロジックを残さない」）も、workflow ファイル自体が `check-install-sync.mjs` の hash 照合で deploy 時に上書き・drift 検出される以上、採用者による編集はそもそも抑止済みで、実質的な意味を持たなかった。

要するに、composite action 化は「ファイルの由来を分かりやすくする」という目的に対して直交した変更であり、目的を達成するのに composite action 化は一切必要なかった。この案は棄却し、`.github/workflows/pfdsl-flow-on-issue-close.yml` は元の fat workflow の形に戻す（ステップを直接記述し、呼び出すスクリプトのパスだけを新しい `scripts/pfdsl/` に更新する）。

## Decision

配布物の配置ルールを次の非対称マッピングに変更する:

- `.github/workflows/pfdsl-flow-on-issue-close.yml`（リネーム）: リポ標準パス `.github/workflows/` に配置する（GitHub Actions の性質上ここは動かせない）。`.github/workflows/` 直下は採用リポの他ワークフローと混在するため、ファイル名に `pfdsl-` prefix を付けて由来を明示する。中身は元の fat workflow のまま — 呼び出す node script のパスだけを `scripts/pfdsl/...` に更新する。composite action 化はしない（上記 Context 参照）。
- 実体（audit/normalize スクリプト・`lib/*`）はすべて `scripts/pfdsl/` 配下に集約する:
  - `scripts/pfdsl/audit-issues-flow.mjs` / `scripts/pfdsl/normalize-pfdsl.mjs`
  - `scripts/pfdsl/lib/{issues-flow-audit,gh-exec,gh-compat,github-rest,proxy-fetch,proxy-fetch-worker,yaml-require}.mjs`

pfdsl リポ自身の運用パスもこの新パスに統一する。「配布用 install/ の実体パス」と「pfdsl 自身が dogfood する実行パス」を分けると、pfdsl 自身が自分の配布物とは違う場所で運用する矛盾を抱えるため。

## Consequences

- 採用リポに配置される node script 群は `scripts/pfdsl/` 配下にまとまり、ファイル名を見るだけで pfdsl 由来と分かる。採用リポ独自の `scripts/lib/` との混在が解消される。
- ワークフロー本体の構成（fat workflow、node script を直接呼ぶ）は変わらない。パス依存箇所は before と同じく1箇所（workflow の `run:` ステップ）のままで、コンプレキシティは増えない。
- `install/` の配置規約自体（「リポルートからの相対パスを保ったままコピーする」ADR-0016）は変更しない。`install/scripts/pfdsl/...` → `scripts/pfdsl/...` という対応関係も単純な相対パス保持のままであり、`check-install-sync.mjs` の `listInstallFiles`（ディレクトリ走査ベース）に変更は不要。
- ADR-0016 が却下した「composite action 経由」は、本 ADR でも改めて不採用と判断する。ADR-0028 は却下の前提を変えていない — cross-directory coupling は canonical-in-repo か plugin 配布かに関わらず、`uses: ./相対パス` を使う限り本質的に残る制約であるため。

## References

- ADR-0016（install/ 集約 — 本 ADR が配布物のディレクトリ構造を改訂する。「リポルート相対パスを保ったままコピーする」という配置規約、および composite action 経由の却下は存続）
- ADR-0028（plugin 配布移行 — 配置先パスを誰が決めるかを変えたのみで、cross-directory coupling の性質そのものは変えていない）
- `.github/workflows/pfdsl-flow-on-issue-close.yml` — fat workflow のまま `scripts/pfdsl/` を参照するよう更新
