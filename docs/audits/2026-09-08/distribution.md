# 生成・配布境界の監査

> アーカイブ注記（2026-09-10）: この文書は固定コミット `827bcb1cb96238f918dad84dc6453176f131e029` を対象にした当時の監査記録であり、現行の不具合一覧や実装計画ではない。
> 最新の対応状況と残件は [#1055](https://github.com/takasek/pfdsl/issues/1055)、CLI 0.0.26 の公開完了記録は [#1138](https://github.com/takasek/pfdsl/issues/1138) を参照する。
> 観測・評価・提案は当時の内容を保持し、個人環境を含むパス表記は公開用の例示パスへ置換した。
> Markdown リンクは、このアーカイブ内の相対参照または監査対象コミットへの固定参照へ置き換えた。

対象コミットは `827bcb1cb96238f918dad84dc6453176f131e029`、対象 worktree は `/path/to/pfdsl`。
実装・関連テスト・配布設定を一次資料とし、issue・PR の取得や検索はしていない。
以下の2件は本物の実装を使った合成 fixture で確認した。
D1 は特定の実行順序を注入する実験であり、実際の2プロセス競合試験ではない。
再現ソースは [reproduce.mjs.txt](evidence/distribution/reproduce.mjs.txt)、観測値は [results.json](evidence/distribution/results.json) に保存している。

## D1 — P1: rollback の所有範囲が排他制御より広く、ロック拒否側が別 run の生成成果を取り消す

**経路と根本原因。**
[scripts/gen-plugin.mjs:27](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/gen-plugin.mjs#L27) は neutral skill を生成してから `assemblePluginDistIndependent` を呼ぶ。
同関数は [scripts/lib/gen-plugin.mjs:1205](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/gen-plugin.mjs#L1205) で生成先全体の snapshot を取り、[同:1266](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/gen-plugin.mjs#L1266) で Claude/install/manifest を書き、[同:1272](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/gen-plugin.mjs#L1272) で Codex の生成へ進む。
ロックを取得するのは inner の `assembleCodexAssets` に入った [同:855](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/gen-plugin.mjs#L855) である。
取得拒否も outer の [同:1297](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/gen-plugin.mjs#L1297) が受け、[同:665](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/gen-plugin.mjs#L665) の削除・復元処理で全 snapshot を戻す。
ロックを持たない run にも、他の run が変更し得る生成先全体を復元する権限がある。

**破られる不変条件。**
「ロック取得に失敗した生成は、他の run の公開成果を変更しない」「失敗時の復旧は自分が変更した状態に限る」という排他制御・復旧の前提が成立しない。
これは [scripts/lib/gen-plugin.mjs:676](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/gen-plugin.mjs#L676) と [同:830](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/gen-plugin.mjs#L830) が述べる、生成失敗による旧・新成果の混在回避を保つために必要な条件である。

**再現と実値。**
合成 root に既存ロックと `AGENTS.md = old` を置いて contender B を開始する。
B の snapshot 完了後、decoder の呼出し位置にロック保持側 A の書込みを模した処理を注入し、`AGENTS.md = published-by-lock-holder-a` とする。
B の Codex 生成は実装どおりロック取得に失敗するが、outer rollback が A の書込みを取り消す。
保存結果は `injected: true`、`final: "old"`、`lockRemains: true` で、エラーは `Codex asset assembly lock is held ...` だった。
期待する結果は、B の取得拒否後も `published-by-lock-holder-a` が残ることである。

この実験は本物の outer snapshot/rollback と inner lock を使用する。
decoder と Claude adapter を置換して実行順序を固定しており、実際の2プロセスによる全生成、OS の競合頻度、crash recovery は測っていない。
したがって、特定の interleaving に対する非干渉性の欠陥を示すもので、実運用での発生件数を示すものではない。

**対照と反証。**
inner 同士だけならロック拒否前に公開しないことを検証するテストがある。
ただし [scripts/lib/gen-plugin.test.mjs:1820](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/gen-plugin.test.mjs#L1820) は `assembleCodexAssets` 同士を競合させ、outer の snapshot/rollback を通らない。
一方、[同:1305](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/gen-plugin.test.mjs#L1305) の outer 復旧テストには他の writer が存在しない。
両保証を別々に試すだけでは、outer と inner の境界が重なる今回の条件を区別できない。

**影響条件と優先度。**
同じ checkout で full generator と full/Codex-only generator が重なる場合に成立する。
ロック拒否側の復旧が別 run の更新後に動けば、成功した側の成果まで古い値へ戻し得るため P1 とした。
適切に分離した別 worktree 同士の通常生成にはこの条件を適用しない。
実在する利用先での損失は調査していない。

**小さな改善と維持する保証。**
full generation の最外周で、snapshot と生成を始める前に同じロックを取得する。
inner には取得済みの所有情報を渡すか、ロック内で呼ぶ実装を分けて二重取得を避ける。
ロック拒否側には snapshot/rollback を実行させない。
現在 transaction 前に走る [scripts/gen-plugin.mjs:27](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/gen-plugin.mjs#L27) の neutral skill 生成も、保証する生成単位に合わせて同じ境界へ含める。
4 target への配布、dist 不要な生成部分の利用、失敗時の既存成果保持を維持する。

## D2 — P2: install 更新が前回の配布 baseline と今回の canonical を混同し、無編集更新と orphan 回収を誤判定する

**経路と根本原因。**
配布済み pfd-ops の `check-install-sync.mjs --target <adopter> --deploy` は、[.claude/skills/pfd-ops/scripts/check-install-sync.mjs:501](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/.claude/skills/pfd-ops/scripts/check-install-sync.mjs#L501) で target を分類し、採用先なら [同:518](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/.claude/skills/pfd-ops/scripts/check-install-sync.mjs#L518) から `deployInstall` を呼ぶ。
[同:338](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/.claude/skills/pfd-ops/scripts/check-install-sync.mjs#L338) は target と今回の canonical の直接比較だけで「locally modified」とみなし、前回の配布 hash を参照しない。
さらに [同:373](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/.claude/skills/pfd-ops/scripts/check-install-sync.mjs#L373) は skip したファイルも含め、全 current file の今回の canonical hash を manifest に記録する。
次回の orphan 削除だけは [同:356](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/.claude/skills/pfd-ops/scripts/check-install-sync.mjs#L356) で、この記録を前回配布した値として使う。

**破られる仕様と曖昧さ。**
[check-install-sync.mjs:74](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/.claude/skills/pfd-ops/scripts/check-install-sync.mjs#L74) は manifest を「最後に deploy したファイルと、その時点の canonical hash」と定義する。
[同:313](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/.claude/skills/pfd-ops/scripts/check-install-sync.mjs#L313) は override が local edit を捨てるかだけを決めると述べる。
しかし [同:305](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/.claude/skills/pfd-ops/scripts/check-install-sync.mjs#L305) は今回の canonical との差を local edit と定義しており、upstream 更新と利用者の編集の意味が混ざっている。
保守的に全差分で停止する方針を選ぶ余地はあるが、その場合でも実際には配布していない hash を last-deployed の記録にしてはいけない。

**再現と実値。**
fixture は本物の `deployInstall` と標準 filesystem API を使う。
target は全工程で無編集のまま、canonical だけを変更する。

| 操作 | 実際の結果 | target / manifest |
| --- | --- | --- |
| 空 target へ `v1` を deploy | `copied: ["a.txt"]` | target は `v1`、記録 hash は `3bfc2695...` |
| canonical だけ `v2` に変えて通常 deploy | `copied: []`, `skipped: ["a.txt"]` | target は `v1` のまま、記録 hash は未配布の `v2` を表す `fb04dcb6...` |
| canonical から同ファイルを除いて通常 deploy | `removed: []`, `orphanSkipped: ["a.txt"]` | 無編集の旧配布ファイルが残る |

履歴を使って判定するなら、2回目は無編集 target を `v2` へ更新し、3回目はその無編集ファイルを削除できる。
現在の結果は upstream 更新のたびに不要な上書き指定へ誘導し、その指定をしなかった旧ファイルの削除判定も誤らせる。

**対照と反証。**
未知の既存ファイルや本物の local edit を保護すること、編集済み orphan を明示許可なしで消さないことは妥当である。
既存テスト [scripts/lib/check-install-sync.test.mjs:304](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/check-install-sync.test.mjs#L304) は初回から異なる内容を持つ target を、[同:377](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/check-install-sync.test.mjs#L377) は deploy 直後の canonical 削除を検証する。
これらは「canonical だけの更新で skip した後の削除」という履歴を区別しない。
実験は合成採用先で関数を直接呼んでおり、実際の plugin cache や利用者のファイルを変更していない。

**影響条件と小さな改善。**
既に配布した install ファイルの canonical が更新され、通常の `--deploy` を使うと成立する。
old deployed hash、target hash、new canonical hash の三者を比較し、target が old と同じなら通常更新、new と同じなら同期済み、それ以外や baseline 不明なら保護する。
manifest には実際に配布した新 hash、または skip した旧 baseline を保持する。
上書き許可と編集済み orphan 削除許可の分離、利用者編集の非破壊、upstream への deploy 拒否、repo-root source → install → 配布物という一方向の所有関係を維持する。

## 確認範囲と維持すべき設計

- `harness-inventory.mjs`、source decoder、capability contract、Claude mirror、Codex adapter、生成関連テストを読み、4 target の native/transform/intentional-exclusion と主要呼出し経路を確認した。
  repo maintainer 専用資産を配布から除外すること、Codex plugin の subagent 非対応を明示すること、marketplace の git-subdir が monorepo 全体や開発用 instructions を配布しないことには理由がある。
- [scripts/lib/gen-install.mjs:44](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/gen-install.mjs#L44) は明示 allowlist の存在と relative import の閉包を生成前に確認する。
  採用先 checker は標準ライブラリと skill 内 script で動き、upstream/ambiguous target への deploy を拒否する。
  この配布の自立性と canonical の境界は維持すべきである。
- [scripts/lib/bundle-manifest.mjs:1](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/bundle-manifest.mjs#L1) の hash は配布 snapshot の識別子で、runtime integrity 証明ではないと明記されている。
  ファイル path と個別 content digest を含め、manifest 自身を除外する構成を確認した。
  キャッシュの編集後に再計算しないことを、宣言した目的に反する欠陥とは扱わない。
- CLI/libraries の package manifests、CLI の tsup 設定、release driver/config/gates、CLI/libraries publish workflow を読んだ。
  CLI の workspace package bundling と `files: ["dist"]`、libraries の pnpm publish、core → graphviz → preview の公開順序を確認した。
  実際の公開や registry 検査はしていない。

## 未確認箇所と追加調査対象

- 生成の実2プロセス競合、kill/crash、stale lock の回収、途中 copy 失敗、manifest 書込み中断、symlink や不正な manifest path に対する耐性は新しい実験を行っていない。
- 全生成物の内容が1つの source snapshot に揃うか、実際に pack した各 package を別環境で import できるか、全配布対象で実ハーネスが認識するかは網羅検証していない。
- CLI version bump 後の stage 集合は追加調査対象である。
  [scripts/release.mjs:197](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/release.mjs#L197) は全生成を行う一方、[scripts/lib/release-config.mjs:76](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/lib/release-config.mjs#L76) の stage 集合は package と plugin だけである。
  [scripts/gen-skill.mjs:65](https://github.com/takasek/pfdsl/blob/827bcb1cb96238f918dad84dc6453176f131e029/scripts/gen-skill.mjs#L65) の version 派生物は generated tree と Codex repository skill にも及ぶ。
  release 全経路や pre-commit の拒否位置は再現していないため、確認済み欠陥2件には含めない。
- publish workflow の manual dispatch は local release driver の gates を通らない。
  手動 fallback の運用上の承認・確認契約を調べていないため、この経路の存在だけで不具合とは断定しない。

## 検証結果

親監査で setup、全 package build、通常テスト、typecheck、check-docs の成功を確認している。
本領域では同じ既存スイートを重ねて実行せず、2件の反例を優先した。
再現スクリプトは終了コード 0 で完了し、上記の不整合を results.json へ記録した。
この終了コードは観測の完了を示し、製品の正常性を意味しない。
製品コード・Git metadata・外部サービスへの変更は行っていない。
