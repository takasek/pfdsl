# E0 証拠の往復：初回停止とsafe-mode成功記録

## 結果と受入状態

#1526の実作業の往復を、2026-10-26にsafe-modeで実行した。
[新試行の記録](safe-mode-20261026/README.md)に、固定入力・未編集driver・実入力監査・実作業・3版の証拠・checkerのPASSを保存した。
実際にreadyだった#542の§15.1クラスタを進め、見出しへ安定IDを付け、その2参照を置換した。
#542の全体criteriaは未達なので `spec_id_refs` はwipを維持し、E0の往復記録だけを受入済みとして `evidence_roundtrip_record` をdoneにする。
statusを書き換える新しい動詞は作っていない。

safe-modeでは共通指示・skill・過去会話・メモリが要求へ入っていないことを実API requestの復元とdigest照合で確認し、独立reviewerも同じ結果を確認した。
標準harnessと環境・アカウント識別metadataは残るため、metadata-zeroやサーバー内部の未記録加工までの証明は主張しない。
driverのassertion一覧保存にはprotocol逸脱があり、生成ソースを編集せず、親の実行ログ・実差分検証で補完した事実も新試行の記録に明示した。
run成功と全成果物のcriteria受入、検査器の保証と親側の検証を区別する。

公開用のパス除去と実行原本の違いは [公開用表現の説明](safe-mode-20261026/README.md#公開用表現と実行原本) を参照する。

## 成功試行の固定版と再検査

実行直後と同じ対象版と証拠の公開用表現はcommit `3ac0190a589bdc8b02ac4de57a0da0cd6bd353a8` に固定した。
後続のE0 done更新をdriverの成果に数えず、その更新後のモデルを実行時の版として渡さない。
リポジトリルートで次を実行すると、driverを再実行せず実行時の対象2pathだけを一時ディレクトリへ復元して実checkerで検査できる。
この復元先はGit worktreeではなく、版照合用のファイル集合である。

```sh
e0_replay_dir=$(mktemp -d)
mkdir -p "$e0_replay_dir/.pfdsl" "$e0_replay_dir/docs/spec"
git show 3ac0190a589bdc8b02ac4de57a0da0cd6bd353a8:.pfdsl/roadmap.pfdsl > "$e0_replay_dir/.pfdsl/roadmap.pfdsl"
git show 3ac0190a589bdc8b02ac4de57a0da0cd6bd353a8:docs/spec/spec.md > "$e0_replay_dir/docs/spec/spec.md"
node experiments/evidence-roundtrip/check.mjs \
  experiments/evidence-roundtrip/safe-mode-20261026/evidence.json \
  experiments/evidence-roundtrip/safe-mode-20261026/snapshot.json \
  "$e0_replay_dir"
```

期待結果は `PASS`、終了コード0である。
実行時の非公開原本の準備commitは `b521a4ce`、公開用対応commitは `a26efb9f78b4c794aeac3f0fdcc7bada0062bbf9` である。
公開用の新試行ディレクトリと `pins.json`、`input-audit.json` / `execution.json` / `parent-verification.json` を参照する。
CLI候補名は `evidence check` / `evidence inspect` のままで、製品動詞や恒久スキーマを採用していない。
readyにcriteriaが無い点は新試行でも既存の `meta get` 出力を組み合わせて扱い、readyの拡張はこの実験で追加していない。

## 初回停止試行（履歴）

以下は成功試行とは別に保存した初回の限定試験である。
この時点では成功往復が未達で、`evidence_roundtrip_record` はwipだった。

対象 `i1525_revise_boundary_test` はsnapshot取得時点で出力がwipであり、現行CLIのready集合に無かった。
先行した調査・文案作成をdriverの実行と数えず、過去のtodoへ戻さなかった。
準備担当が実作業を先に進めたため、計画したreadyからの実行を試せなくなった。
これは準備順序の失敗であり、直ちにモデルの欠陥やCLIの再開機能追加を要求する根拠にはしない。

| 実測 | 結果 |
| --- | --- |
| 別セッション生成driver | snapshotとreadyを読んで停止理由と証拠JSONを出力 |
| 読取専用検査器 | `FAIL: NOT_READY` |
| 不在processの証拠 | `FAIL: PROCESS_MISSING` |
| 入力未達の `reduce_work_cycle_protocol` | `FAIL: NOT_READY` |
| 対象processの実行・成果物受入 | 未実施 |

`reduce_work_cycle_protocol` の入力にはsnapshot上todoの `evidence_roundtrip_record` とwipの `boundary_test_revision_adr` があり、CLIのready集合に無い。
主試行のwipによる非readyと、否定例の入力未達を同一原因として扱わない。
否定例の内容と結果は `nonexistent-process.json`、`unfinished-input.json`、`negative-results.json` に保存した。
主試行は `evidence.json` と `result.json` に保存した。

## 初回停止試行の版と生成手順

既存契約は base `52cacebbe8da6781722ae62fc827bf3bb53f3053` のADR-0048契約3を使用した。
#1525の新しい4条件を実行契約へ追加していない。
`snapshot.json` は実行前のモデル原文・ready・3つの版・対象checkoutのcommitとモデルblobを持つ。
対象checkoutは `fa50ee2dccee99c1be6a94b0f0ed7f08c8f2c4ec` に未コミットのADR等がある状態であり、未コミット成果物は内容ダイジェストで区別した。
snapshotとprotocol、検査器の初版はdriver生成前のcommit `c64bf3006328b26c411ba7efb7ad79a841be07cf` に保存した。
その後の#1525のAccepted化・done更新は親担当の作業であり、この試行の成果として記録していない。

`prepare.mjs` は対象checkoutの既存CLIからreadyを取得する準備用入口である。
公開したsnapshotを再生成すると別の試行になるため、再試行では別の記録先を用意する。
`driver.mjs` は生成された実行物をそのまま保存した。
親担当が読取り先・書込み先を監査してから実行し、検査器と否定例生成は親担当が実行した。
外部実行主体が検査器まで自律実行した試験ではない。

## 独立性の限界と詰まった箇所

別CLIセッション `01a169da-c7e4-7590-9ddd-05544430eaae` へ、[短いprotocol](protocol.md)とCLI出力を渡した。
このセッションはツールを呼んでいない。
メモリとpfd-cycle本文は含まれなかったが、共通AGENTS指示とスキル一覧は注入された。
したがって「protocolとCLI以外を一切知らない」という厳密な隔離は未達である。
所有者の「限界を明記して限定試験まで行う」という指示の範囲で行った。
非公開の共通指示本文・認証情報は本記録へ収録しない。
注入内容とツール未使用は準備担当がセッション記録から確認したもので、公開資料だけによる第三者の再検証はできない。

driver生成時に実行入口を創作しない条件も明示した。
protocolの「対象がreadyに無ければ、空のchangedPathsとtransitions、execution-failure型の理由を記録して検査器へ渡す」に対し、driverは `is absent from the CLI ready list; execution stopped.` と記録した。
誤読は観測されなかったが、停止が明示された狭い課題であり、自律実行の理解度を測った結果とはしない。
生成時にskill探索等を制限しても共通指示・一覧が残った点と、準備中に対象をwipへ進めた点を、別々の未達理由として残す。

## スキーマと検査範囲

v0の形・版の計算法・実験用遷移規則は [protocol.md](protocol.md) が定義する。
process実在、出力criteriaの存在、固定した実CLI readyへの所属、版一致、出力artifactの遷移と受入参照の有無、パスの版対応、乖離型を検査する。
snapshotは準備側を信頼する入力であり、driver自身に書き換えを許す敵対的な証拠検証には使えない。
保存済み停止試行ではcriteriaの意味的達成、受入参照の実在、実行後の成果物版、無申告の変更、承認の妥当性、再開の契約は検査できていない。
それらをPASSが証明するとはしない。

実CLIの回帰試験では、type未指定のlegacy入力ではstatus省略がreadyとして扱われ、明示した `type: roadmap` では省略がV035になることも確認した。
入力を独自に `status === done` へ置き換えず、既存CLIの検証とready結果をそのまま使う。
独立レビューで作業項目IDの空配列を受理する欠陥を再現し、本リポでの必須化とprocessのissue URLとの対応検査を追加した。
これは初回実行後の修正であり、実行前の検査器とprotocolは上記固定commitから読める。
修正版でも保存済みの主試行と2否定例の判定が変わらないことを再確認した。
検査器の回帰テストは以下で再実行できる。
ローカルの `make test` とCIの全体テストにも登録した。

```sh
make build
node --test experiments/evidence-roundtrip/check.test.mjs
node experiments/evidence-roundtrip/check.mjs experiments/evidence-roundtrip/evidence.json experiments/evidence-roundtrip/snapshot.json
```

最後のコマンドは意図どおり終了コード1を返す。
CLI動詞候補は `evidence check` と `evidence inspect` だが、公開動詞の採用はしていない。
readyの出力にcriteriaが無いため準備側がモデルを別途読んだ。
criteriaを取得する別の問い合わせとの組合せかreadyの拡張かは、成功した往復で必要量を測ってから比較する。

## 初回停止試行の時点で残っていた試験

以下は当時の残件であり、現在の到達点は冒頭と新試行の記録を参照する。

未着手でスコープ内の実processを選び、作業を開始する前にsnapshot・入力・実行入口を揃える必要がある。
その後、driverが実作業を進めた差分と受入証拠を取得し、実行後の成果物版を含む検査を通す。
厳密な隔離は別途満たすか、所有者が受入条件自体を変更する必要がある。
今回の限定実施の承認を、#1526の受入条件変更とは解釈しない。

## 再開時の準備と検査器改善（2026-10-26）

既存PRをmainへrebaseした後、受入条件を維持して隔離の準備を調査した。
Codexの非実行入力表示と実際の読取専用起動を照合したが、project指示の上限とskill探索等の設定を指定しても共通AGENTSとskills一覧が残った。
設定の存在は[公式の設定リファレンス](https://learn.chatgpt.com/docs/config-file/config-reference)で確認したが、設定を指定したことだけを隔離の成功根拠にしていない。
秘密を含まない観測と実行引数は [isolation-preflight-20261026.json](isolation-preflight-20261026.json) に保存した。
非公開の指示本文は収録しておらず、公開記録だけで全注入内容を再検証できるとは主張しない。

所有者の承認を受けてClaude Codeのbare起動も試したが、`Not logged in · Please run /login` でAPI呼出し前に終了した。
この版のbareは通常のOAuth/keychainログインを使わず、APIキーまたは明示したapiKeyHelper等を必要とする。
環境にAPIキーは無く、認証の取得・移設や新しい費用設定はしていない。
この失敗をdriverの生成・実行や隔離達成に数えない。
当時はここで停止したが、その後safe-modeで通常のログインを使えることを確認し、新試行へ進めた。

実行後照合の不足は独立設計レビューでも確認し、[protocolの追加契約](protocol.md#実行後照合付きの再試行)に従う検査を追加した。
checkerが実行後の実ファイルを読み、申告された出力版、scope内の変更path集合、最終statusと遷移、出力に対応する受入参照を照合する。
prepareはcapture planと新規記録先を明示させ、対象がreadyでない場合と既存記録の上書きを拒否する。
scope内の虚偽申告・申告漏れ、証拠生成後の内容改変、出力以外のstatus変更等を回帰fixtureで検証した。
これは実験器具の改善であり、実在roadmapの1 processを進めた成功往復ではない。
この時点では過去のsnapshot・driver・停止証拠・2否定例を保持し、`evidence_roundtrip_record` はwipのままだった。
