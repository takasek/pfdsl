# ADR-0031: 配布スキルの CLI 呼び出しを素の `pfdsl` に統一する

- Status: Accepted
- Date: 2026-07-21
- Supersedes: issue #67（スキルを `npx @pfdsl/cli` に切り替えた判断）

## Context

スキル本文の CLI 呼び出しは #67（commit b13aec1）で `node packages/cli/dist/cli.js` から `npx @pfdsl/cli` へ切り替えられた。
理由は配布可搬性で、「生成スキルが任意のプロジェクトで動く」「ローカルバイナリを持たない採用リポでも手順に従える」ことだった（commit 8d86005）。
以来 `npx @pfdsl/cli` が実行例の多数派（約48箇所）になっている。

その後 #524 でバージョン preflight が入った。
スキルは必要 CLI バージョンを宣言し、最初のコマンド実行前に `--version` を確認、不足なら `npm install -g @pfdsl/cli@latest` を依頼して停止するようになった。
これにより「CLI 未導入／旧版」は、セッション途中の `unknown command` ではなく、冒頭の明示的な導入ガイドに変換される。

実測すると、`npx @pfdsl/cli <cmd>` は導入済みでもコマンドごとに約 +0.45s（warm）の解決オーバーヘッドを負う（ダウンロードではなく npx 自体の解決コスト）。
これはスキルテキストを verbatim 実行するエージェントにとって、グローバル導入済みのユーザーであっても払い続ける恒常コストになる。
テキストが `npx @pfdsl/cli` である限り速い経路は存在しない。速度を得るにはテキスト自体が `pfdsl` である必要がある。

先行して「読み手がどちらかを選んで一貫して使う」という案も検討したが、エージェントに一貫性を要求する形は強制不能として却下した。
したがって配布物としては単一の canonical 形を選ぶ必要がある。
なお ADR-0030 の時点で pfdsl は外部ユーザー不在の段階にあり、npx の可搬性ヘッジが守る対象は大半が将来の仮想採用者である一方、恒常税は現在の主要利用者が毎セッション払っている。

## Decision

**配布スキル本文の CLI 呼び出しを素の `pfdsl <cmd>` に統一する。**

- preflight は `pfdsl --version` を検査し、未導入／宣言バージョン未満なら `npm install -g @pfdsl/cli@latest` を依頼する。
- グローバル導入が真にできない環境向けに、バージョンを固定した `npx @pfdsl/cli@<version> <cmd>` を「ホットパス外の代替」として1行だけ残す。`@latest` ではなく固定版とし、gh-skill-install（main 追従）と npm 公開版の解決ズレを持ち込まない。
- 生成側（`scripts/lib/skill-cli-section.mjs` の `renderCliSection`）の prefix も `pfdsl` にする。

この判断は #524 の preflight が存在することを前提とする。preflight と invocation 統一は同一リリースで結合させ、preflight を外すリリースで invocation だけ先行させない。

## Rationale

1. **preflight が npx の唯一の存在理由を代替した**。#67 が避けたかった「未導入時の cryptic failure」は、preflight が冒頭の明示ガイドとしてより良く解決する。#67 は preflight 導入前の判断であり、前提が変わった。
2. **恒常税 対 一度きりの誘導付き導入**。npx の 0.45s/回 × 5〜15回/セッション × 全セッション × 全利用者（導入済みの多数派を含む）は永続コスト。対して global の代償は採用リポあたり一度の `npm install -g` で、しかも preflight が誘導する。
3. **テキストが速度を決める**。verbatim 実行のため `npx @pfdsl/cli` と書けば導入済みでも税が発生する。config で切り替えられる話ではなく、スキルテキストそのものが判断になる。
4. **版スキューが収束する**。gh-skill-install（main 追従）と npm 公開版の二重解決が、npm 一元管理＋preflight 検査という単一軸に収束する。
5. **散文との整合**。`references/spec.md` / `samples.md` の参照散文は既に素の `pfdsl` を使っており、実行例と表記が揃う。

## Consequences

- 採用リポは `@pfdsl/cli` のグローバル導入が前提になる。README の採用手順にこれを明記した。
- **stamp 元の狭い窓（既知・許容）**: preflight の宣言バージョンは `packages/cli/package.json`（ソースツリー）から刷られる。リリースは bump コミット→publish の順のため、publish workflow 実行中の数分間だけ「main のツリー版 > npm 公開版」となり、その窓で gh-skill-install した読者は preflight 偽陰性になりうる。publish 完了で自己修復する。これは #524 で既にある挙動で本 ADR が新たに生む問題ではなく、gen-skill に npm 問い合わせを足す脆さに見合わないため、コード対処せず既知の窓として記録する。
- ロックダウン環境向けの固定版 npx 代替は、固定版のまま保つこと。`@latest` に緩めると版スキューが再発する。
