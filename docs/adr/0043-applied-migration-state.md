# ADR-0043: 採用先が移行を適用した版を `.pfdsl/config.json` に記録し、照合は読むだけにする

- Status: Accepted
- Date: 2026-10-04

## Context

PR #1317 は、版別の移行手順を `docs/migration-guide.md` に集約し、配布スキルからはガイドへの参照だけを置く構成にした。
一方で、plugin を更新した後に、その採用先がガイドの移行を済ませていないことを採用先へ知らせる仕組みは無かった（#1319）。
plugin はユーザー単位で入るため、更新の事実だけでは、どのリポが移行を済ませたかを示さない。

知らせるには、リポごとに「どこまで移行したか」の記録が要る。
その記録を何にするかで、検出できる残骸の範囲が決まる。

## Decision

採用先が移行を適用し終えた plugin の版を、採用先の `.pfdsl/config.json` のキー `appliedMigration` に記録する。
置き場所は ADR-0042 が予約した `.pfdsl/config.json` である。

```json
{"appliedMigration": {"pluginVersion": "0.1.0", "bundleHash": "<64桁の hex>"}}
```

- `pluginVersion`: 移行を適用した時点の plugin の版。
- `bundleHash`: 同じ時点の bundle の集約 hash（`computeManifestAggregateHash`）。Claude Code の plugin だけが `bundle-manifest.sha256` を持つため、Codex の plugin で記録した場合は省く。

CLI の版は記録しない。
plugin の版は CLI の package version から導かれて一致し、移行ガイドの節も「CLI/plugin vX」の単位で書かれている。
CLI を別経路で入れた場合の食い違いは、CLI 自身が診断を出して止まる側で扱う。

### 記録するのは移行を適用した人だけ

`check-install-sync.mjs --record-migration` が、実行中の plugin の版と hash を `appliedMigration` に書く。
移行を実施する人または agent が、移行と同じ変更の中で、検証が通った後に明示的に実行する。
他のキーと、ファイルの字下げの流儀・末尾改行は保持する。`.pfdsl/` があって `config.json` が無ければ新規に作る。
照合（既定の実行と `--upstream`）はこのキーを読むだけで書かない。
`/pfd-init`（pfd-ecosystem のステップ 3）は、そのステップの前に `.pfdsl/` が存在しなかった場合（新規の採用先）に限り、続けてこのコマンドを実行し、新規採用先を現在の版で始める。
`config.json` を新規に作ったかどうかは条件にしない。0.0.26 以前の採用先は `config.json` を持たない（0.1.0 の scaffold で導入された）ため、`/pfd-init` を再実行して `config.json` が新規に作られても、その採用先は適用していない移行を適用済みと主張することになるからである。
hash を人手で計算させないためにコマンドを用意するが、キーを手で書くことは禁じない。

`--record-migration` は `--deploy`・`--overwrite-local-edits`・`--delete-edited-orphans` と同時に指定できない（引数の誤りとして exit 2）。
後ろの2つは `--deploy` の挙動だけを変えるので、記録と並べると黙って無視されるからである。
検証後に実行する記録と、移行の作業そのもの（`--deploy`）を、1回の実行にしない。

次の場合は、何も書かずに理由を示して exit 3 で拒否する。

- target が上流リポ、または canonical が曖昧と分類された場合。
- `.pfdsl/` が無い場合。
- 実行中の plugin の版を決められない場合（plugin の外、repo-local の旧配置からの実行など）。
- 実行中の版が、記録済みの版より古い場合。
- `.pfdsl/config.json` が JSON として読めない、または最上位がオブジェクトでない場合。

既にある `appliedMigration` の形が違う場合は、拒否せず上書きする。
通常の実行と `--deploy` が拒否する記録を書き直せるのは、書き手であるこのコマンドだけであり、拒否したままでは手で直すしかなくなるからである。
記録の版を読めないので、記録より古い plugin かどうかは評価できない。その場合は書込みを許す。

### 照合

`check-install-sync.mjs` が target を採用先と分類した場合に、`.pfdsl/config.json` の `appliedMigration` だけを読んで行う。
GitHub Issues バックエンドの採否にも `--upstream` の有無にも依存させない。
`--deploy` の拒否が通常の実行でも効く必要があり、pfd-ops の発火時セルフチェックは同じスクリプトを実行するので、Claude Code と Codex の両方で pfd-ops の起動時に走る。

- `.pfdsl/` が無い: 何もしない。plugin はユーザー単位で入るため、無関係なリポでも起動する（ADR-0028）。
- `appliedMigration` が無い: 仕組みの導入前の採用先として、移行ガイドの「Choosing the update range」を案内し、適用後に `--record-migration` を実行するよう示す。実行中の plugin の版を決められない場合（repo-local の旧配置など）は、そのコマンドが exit 3 で拒否されるため出さず、記録には plugin（Claude Code または Codex）経由の実行が要る旨を示す。失敗にはしない。
- 実行中の plugin の版を決められない: 照合を省き、その旨と理由を1行で示す。
- 実行中の版 < 記録した版: plugin の更新を促す。`--deploy` と `--record-migration` は exit 3 で拒否する。古い `install/` で新しい配置を巻き戻すことを防ぐためである。
- 実行中の版 > 記録した版: 記録した版と実行中の版を示し、その間のガイドの節を読むよう案内する。拒否しない。移行の作業そのものに `--deploy` が要る。
- 版が同じで、両方に hash があり異なる: 開発版と公開版のように同じ版番号の別内容であり、どちらが新しいかは判定できない旨を示す。拒否しない。順序を判定できない差で書込みを止めると、正しい側の作業まで止まる。
- 版の比較は `x.y.z` の数値比較で行う。どちらかが読めない版なら「比較できない」と示して拒否しない。
- `.pfdsl/config.json` が JSON として読めない、最上位がオブジェクトでない、または `appliedMigration` の形が違う: ファイル名を示して exit 3 で失敗する。壊れた宣言を「無い」と読んで黙って通さない。ADR-0042 が sweep workflow に課した規則と同じである。

older の状態で、`--deploy` を指さない通常の実行は失敗にしない。ただし、その出力の末尾に、拒否されると同じ出力が言っている `--deploy` の案内（未導入時の「To adopt it」、乖離時の「Run with --deploy to refresh」）は出さない。

### Codex

移行状態の照合は、両方の plugin manifest を読む `readPluginIdentity` で実行中の plugin の版を読む。
`bundleHash` は、`.claude-plugin/bundle-manifest.sha256` がある plugin でだけ読み、無ければ持たない。
plugin の外で動いていて、どちらの manifest も版を持たない場合は、版が不明として扱う。

### 範囲

2026-10-05 の方針更新（#1379）: 既知の v0.0.26 採用リポは所有者が把握しており、#1319 を個別に読ませて移行する。
その一度限りの案内のために、上流 main との版差・bundle 内容差を毎回通知する恒久的な導線は置かない。
`checkUpstreamVersion` とネットワーク比較を廃止し、移行が必要かどうかの信号は `appliedMigration` と実行中 plugin の照合が担う。
これは ADR-0028 論点4の上流版差通知と、本 ADR の当初の「上流版差通知は変えない」という判断を置き換える。
既存の呼出しを壊さないため `--upstream` は無作用の互換 flag として受け付けるが、現行の手順では付けない。
配置ファイルの同梱 canonical との drift、未記録・版差・内容差の移行照合、古い plugin の書込み拒否は維持する。

この仕組みより前の版の道具は `appliedMigration` を読めないため、守る対象にしない。
`.pfdsl/config.json` は `--target`（既定は cwd）の直下で探す。install/ の配置先と同じ基準である。

## 検討した対案

- **別ファイル `.pfdsl/migration-state.json` に置く（#1319 の最初の案）。** ADR-0042 の「宣言の置き場所を増やさない」決定と衝突するため却下した。中身の意味（移行を適用した版）は、この案を引き継いだ。
- **「最後に見た版」を記録する。** 移行を反映する前に記録だけが進むと、残骸を二度と検出できなくなるため却下した。記録は、移行を適用した人が検証後に進める。
- **SessionStart hook で通知する。** pfd-ops を経由しないセッションでも通知でき、`systemMessage` で人間へ直接見せられる利点はある。次の理由で採用しない。
  - pfd-ops を経由しない場面にはそれぞれ手当てがある。pfd-retro の D 層は宣言キーが無ければ自ら報告し（#1317）、CLI 側の変更は CLI 自身が診断を出して止まる。
  - plugin はユーザー単位で入るため、全リポ・全セッションで起動する。移行の担当でない人にも移行完了まで毎回表示され、Claude Code と Codex の二重保守にもなる。
  - Codex はユーザーが信頼するまで plugin 同梱の hook を実行せず、過去に plugin 内の hook が実行されない不具合（openai/codex#16430）も報告されている。現行版での挙動は確かめていない。
  - 再検討の条件は、pfd-ops を経由しないセッションで、移行漏れによる実害が観測された場合とする。
- **記録を持たず、配置済みファイルと install manifest の hash から適用済みの版を推定する。** manifest は、移行で触る領域の大半（CLI 呼出し・図の値・retro カタログ等）を持たず、配置ファイルが一致していても移行は済んでいないことがある（#1319 の初回点検表の大半が配置ファイルの外にある）ため却下した。
- **照合を CLI（`pfdsl check` 等）に置く。** CLI は plugin と別経路で入り、pfd-ops を使わない場面でも走る。拒否の対象である `--deploy` は pfd-ops のスクリプトにあり、同じ経路に置かないと拒否を掛けられないため却下した。
- **CLI の版も記録する。** 上のとおり plugin の版と一致するため、記録する値が増えるだけになる。CLI を別経路で入れた場合の食い違いは CLI が診断を出す側で扱う。

## Consequences

- 既存の採用先は、`appliedMigration` を記録するまで、pfd-ops の起動のたびに導入前の採用先として案内される。移行ガイドの Unreleased 節が、ガイドの適用後に `--record-migration` を実行するよう案内する。この節は公開準備で実際の公開先の版へ書き換える（`.pfdsl/workflow.md`「採用先への移行案内」）。
- 版を `x.y.z` の数値で比較するため、`0.2.0-beta.1` のようなプレリリース表記は「比較できない」と案内され、拒否は掛からない。
- plugin を更新しただけでは記録は進まない。更新後の作業を省くと「記録より新しい plugin」の案内が出続け、これが移行漏れの検出になる。
- `.pfdsl/config.json` が壊れていると、`--deploy` を含む通常の実行が exit 3 で止まる。宣言を直すまで先へ進めないことが、壊れた宣言を黙って無視しない代償である。
- 同じ版番号の別内容は、順序を判定できないため通知にとどまる。内容が意図したものか確かめ、必要なら `--record-migration` で記録し直す。
