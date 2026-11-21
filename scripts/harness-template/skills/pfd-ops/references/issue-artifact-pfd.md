# Issue artifact PFD の運用

複雑な一つの Issue の工程と入出力成果物を、任意に PFD で示す入口である。
原稿の正本は Issue の generic artifact に置き、別の embedded_html artifact に SVG または生成失敗の告知を置く。
通常の Issue、全体 roadmap、Issue close と PFD status の関係は変えず、PFD を使わない Issue に追加操作は要求しない。

## 環境と対象

`.pfdsl/config.json` の `githubIssues.enabled` が真偽値の true で、pfd-ops の install 配置を済ませたリポジトリで使う。
Node.js 18 以上と、`--reference-context` を持つ pfdsl CLI が必要である。
公開済みの @pfdsl/cli 0.2.0 はこのオプションを持たない。
対応版が公開されるまでは、上流の対応ビルドを `PFDSL_CLI` で指定する。
同じ 0.2.0 と表示される対応ビルドもあるため、版文字列だけでは判定しない。
起動時に `check --help` に `--reference-context` があるかを検査し、無ければ環境エラー（exit 3）として何も書かず終了する。
原稿の不正や公開失敗は exit 1、引数不正と GitHub 接続経路の不在は exit 2 である。
CLI の解決順は `PFDSL_CLI`、配置先の `packages/cli/dist/cli.js`、`node_modules/@pfdsl/cli/dist/cli.js` で、明示指定が無ければ後続候補を探す。
明示した `PFDSL_CLI` が存在しなければ失敗し、他の CLI に切り替えない。
描画は既存 CLI の SVG renderer を使う。
`--help` と各コマンドの `--help` は、GitHub や下位 CLI にアクセスせず書式・オプション・既定値・終了コードを英語で表示して exit 0 で終わる。
show は生本文を取得するだけなので下位 CLI の対応検査も要求しない。
gh 経路の artifact 取得は最大256 MiBまで読み取り、上限超過時は対象と上限を示して終了する。

GitHub 通信は認証済みの `gh api` を使う。
gh が存在しない場合だけ、`GH_TOKEN` または `GITHUB_TOKEN` による public GitHub の HTTP 経路を使う。
この入口自体は `gh issue artifact` や gh 2.103 以上に依存しない。
手動の閲覧・復元で `gh issue artifact` を使う場合だけ gh 2.103 以上が必要である。
読取には対象 Issue の読取権限、作成・更新には対象 Issue への書込権限が必要である。
fine-grained token の具体的な権限名は実 GitHub での確認が済んでいないため、ここでは確定していない。
対象は `GH_REPO=[HOST/]OWNER/REPO`、保存された gh の default repository、origin の順で解決し、状態の host・owner・repo と異なる場合は書かない。

## 作成と編集

次は配置先リポジトリのルートで実行する。
最初に plan.pfdsl を用意する。
次の最小例では、仕様から実装とテスト準備が並列に進み、その両方を検証工程へ渡す。

```pfdsl
request >> investigate -> findings
findings >> specify -> specification
specification >> implement -> code
specification >> prepare_tests -> tests
[code, tests] >> verify -> evidence
```

GitHub への書込みは既定で dry run であり、`--write` のある実行だけが書く。
dry run は状態や操作記録も変更しない。
pull は取得して作業ディレクトリを作る操作、render は指定した出力ファイルを作る操作、resolve は放棄を記録する操作であり、それぞれ `--write` を要求しない。

```sh
node scripts/pfdsl/issue-pfd.mjs --help
node scripts/pfdsl/issue-pfd.mjs publish --help
node scripts/pfdsl/issue-pfd.mjs create 123 plan.pfdsl --dir issue-123
node scripts/pfdsl/issue-pfd.mjs create 123 plan.pfdsl --dir issue-123 --write
node scripts/pfdsl/issue-pfd.mjs pull 123 --artifact 1 --version 2 --dir issue-123-v2
node scripts/pfdsl/issue-pfd.mjs check issue-123
node scripts/pfdsl/issue-pfd.mjs render issue-123 --out issue-123.svg
node scripts/pfdsl/issue-pfd.mjs publish issue-123 --write
node scripts/pfdsl/issue-pfd.mjs status 123 --artifact 1 --dir issue-123
```

create と pull の新しい作業先は空ディレクトリにする。
pull は通信中やファイル配置直前に作られた model.pfdsl・base.pfdsl・issue-pfd.json を上書きせず、既存ファイルがあれば失敗する。
失敗時は配置済みのファイルを残し、利用者のファイルを削除しない。
残った原稿と状態を退避・確認してから、別の空ディレクトリへ pull し直す。
pull の --version は省略すると現在版を取得する。
取得後は `model.pfdsl` を編集し、末尾の LF を保つ。
`issue-pfd.json` に対象、基底の版・原稿全文・両 hash、前置と後置の散文、操作記録 operations をまとめて保存する。
状態は一時ファイルからの rename で切り替える。
applied・superseded・overwrote になった図操作は artifact 番号・版・本文 hash に縮め、applied な原稿操作も本文 hash に縮める。
未確定・放棄した原稿操作と、他者の版を上書きした原稿操作の本文は保持する。
`base.pfdsl` は状態の基底から書き出す閲覧用ファイルであり、公開判定の正本には使わない。
旧スキーマの作業ディレクトリは、未公開編集を保全したうえで別の空ディレクトリへ pull し直す。

原稿の先頭には次のマーカーを置く。
id は PFD の sourceId、op はこの入口の公開操作ごとの UUID、base は公開時の基底版で、作成時は0である。
原稿にはちょうど一つの pfdsl フェンスを置き、前後の散文は companion として自由に編集できる。
公開時は散文の位置を保ち、原稿自身に Markdown フェンスが含まれる場合は外側のフェンスを長くする。

```text
<!-- pfdsl:issue-pfd source id=<uuid> op=<uuid> base=<version> -->
```

Web UI での原稿編集も利用できるが、マーカーとフェンスを保持する。
壊した場合でも、原稿全文の hash と履歴に残る sourceId により、その版向けの invalid-source 告知を生成できる。
複数の原稿があれば `--artifact`、同じ sourceId の図が複数あれば表示された番号で `--diagram` を指定する。
publish と restore でも `--diagram` を指定して保存済みの図番号を選び直せる。
図の操作が applied と確認できたら、その送り先が次の publish の既定になる。
明示した図への書込みの応答を失った場合も、後の照合で成立が分かれば同じ扱いになる。

## 入力の由来と参照文脈

check と render には毎回、[参照文脈の契約](https://github.com/takasek/pfdsl/blob/main/docs/reference-resolution.md)を満たす JSON を渡す。
この JSON は入口が自動で作り、利用者は用意せずコマンドへ渡さない。
basis は持たせず、extends と subflow を含む複数ファイルの原稿は CLI が拒否する。
相対 location と command.cwd は静的検査・描画では解決しないため、その実在や実行可能性は確認しない。
入力は開始時に読み、処理中の model.pfdsl の追加編集は次回分として残す。

読み戻した公開版では原稿 artifact の URL、版番号、artifact 番号を使う。
次は artifact 1 の公開版7の例である。

```json
{
  "adapter": "pfdsl:issue-artifact-v1",
  "model": {
    "source": "https://github.com/OWNER/REPO/issues/123/artifacts/1",
    "fixedRevision": "7",
    "documentId": "1",
    "extractionId": "pfdsl-fence"
  },
  "logicalPath": "issue-pfd.pfdsl",
  "targets": []
}
```

手元の check・render、create 前、publish 前の検証では、公開済みの版番号を名乗らない。
model.source は作業ディレクトリの local: 識別子、fixedRevision は未公開の入力バイト列の sha256 とする。
次は作業ディレクトリ `/work/issue-123` にある `a >> p -> b` と末尾 LF の原稿の例である。
取得元の版はこの JSON に混ぜず、状態の基底に保存する。

```json
{
  "adapter": "pfdsl:issue-artifact-v1",
  "model": {
    "source": "local:/work/issue-123",
    "fixedRevision": "b075f09390f9fab02abbb996bc15306fd387e0f56f92e4e61de184f22e81dc53",
    "documentId": "model.pfdsl",
    "extractionId": "pfdsl-fence"
  },
  "logicalPath": "issue-pfd.pfdsl",
  "targets": []
}
```

## 図の再生成と status

Web UI の編集、復元、CLI 更新、生成失敗の解消後は手動で再生成する。
artifact 編集による Issue の updated_at・timeline・events の変化は前提にせず、Webhook や Actions の自動生成は行わない。

```sh
node scripts/pfdsl/issue-pfd.mjs publish-diagram 123 --artifact 1 --write
node scripts/pfdsl/issue-pfd.mjs publish-diagram 123 --artifact 1 --version 2 --write
node scripts/pfdsl/issue-pfd.mjs status 123 --artifact 1 --diagram 2 --dir issue-123
```

publish-diagram は公開済みの原稿を使い、作業ディレクトリの未公開編集に触れない。
`--dir` を指定すると、そのディレクトリの操作記録も最初に照合する。
status の操作記録照合にも `--dir` を指定する。
省略時は現在のディレクトリに issue-pfd.json があればそれを使い、無ければ公開済みの原稿と図だけを照合する。
明示した --dir に issue-pfd.json が無ければ、状態なしの処理へ切り替えずに停止する。
他のディレクトリにある操作記録を自動探索することはない。

図の meta と可視テキストに schema・sourceId・sourceArtifact・sourceVersion・sourceBodySha256・result・cliVersion・generatedAt を置く。
原稿の形式が正しければ modelSha256、rendered なら svgSha256 も付ける。
可視テキストには常に Generated from source vN（原稿 vN から生成）と原稿 URL を示す。
embedded_html の Preview でインライン SVG を閲覧する。
CLI の検証・描画失敗には failed、マーカーやフェンスの不正には invalid-source と診断を置く。
原稿を公開する publish は、未公開原稿の検証に失敗すれば公開しない。

modelSha256 は原稿全文を LF に正規化し、開始フェンスの次行から終了フェンス直前までの UTF-8 バイト列から計算し、各行末の LF を含む。
sourceBodySha256 は LF に正規化した原稿全文、svgSha256 は実際に埋め込んだ SVG 要素の文字列そのものから計算する。
status は原稿→図→原稿の順に読み、SVG の実体も hash と照合する。
HTML コメントや template・script・textarea 等の表示対象ではない内容を除き、SVG 要素がちょうど1つで、そのバイト列の hash が刻印に一致する場合だけ対応する図とみなす。
SVG が0個・複数の場合や、扱えない HTML 文脈では stale として再生成する。

| status | 意味 |
| --- | --- |
| current | 照合時点で原稿の版・全文 hash と図の刻印・SVG 実体が一致する。 |
| current-model | 現在のモデル hash が図の入力モデルと一致する。中間版の編集内容は判定しない。再生成不要。 |
| stale | 原稿と図の hash が異なるか、図の SVG 実体が刻印と異なる。原稿版と図の入力版を表示する。 |
| failed | 現在版に対する CLI の失敗告知がある。 |
| invalid-source | 現在版のマーカーやフェンスが不正。最後の正常な図の版も表示する。 |
| missing | 対応する図が無い。 |
| unavailable | 原稿を取得できず、現在版を確認できない。 |
| changed-during-check | 照会前後の原稿版が異なる。もう一度 status を実行する。 |

## 競合、操作記録、lock

保証の対象はこの入口を通った書込みであり、GitHub の条件付き更新による上書き防止ではない。
公開直前の原稿が基底版と違えば、ディレクトリを変えずに競合として停止する。
別の空ディレクトリへ現在版を pull し、古い base.pfdsl と model.pfdsl の差分をそこへ統合して、そのディレクトリから公開する。
具体的には次の順で進める。

```sh
node scripts/pfdsl/issue-pfd.mjs pull 123 --artifact 1 --dir issue-123-current
diff issue-123/base.pfdsl issue-123/model.pfdsl
```

diff に表示された自分の編集を確認し、issue-123-current/model.pfdsl へ手作業で当てる。
新しいディレクトリで check し、内容を確認してから publish する。

```sh
node scripts/pfdsl/issue-pfd.mjs check issue-123-current
node scripts/pfdsl/issue-pfd.mjs publish issue-123-current --write
```

上書きされた版や現在版のマーカー・フェンスが壊れて pull できない場合は、show で解析せず生本文を取り出す。
show --out は同じ出力ディレクトリに mode 0600 の一時ファイルを作って置換し、既存の出力ファイルがある場合はその mode を保つ。
次は版2をファイルへ保存する例で、--out を省略すると生本文をそのまま標準出力へ出す。

```sh
node scripts/pfdsl/issue-pfd.mjs show 123 --artifact 1 --version 2 --out overwritten.md
```

取り出した本文と自分の diff を読み、現在版を取得した新しいディレクトリへ必要な編集を統合する。
原稿全文が基底と同じなら PATCH を省き、図だけを再生成する。
図も同じ原稿版・hash・CLI 版と正常な SVG に対応していれば、通常の publish は図への書込みも省く。
publish-diagram は明示的な再生成として引き続き使える。

読直しと PATCH の間に他者の書込みが入ることは防げない。
公開操作の op を持つ最古の版を履歴から探し、送信本文と一致し、その直前が base なら applied とする。
直前が他者の版なら overwrote を記録して非0終了し、上書きした vN の取得方法と統合手順を示す。
同じ本文が後で再現しても最初の版で判定する。
Web UI 同士の編集や、外部の --restore-version による上書きは検出しない。
これらは op を新規発行せず、どの版から編集を始めたかをこの入口へ記録しないためである。

保証が扱うのは、この入口を通った書込みに起きる並行編集・通信障害・中断である。
次の操作は保証の対象外であり、行った場合の結果は定めない。
図 artifact の HTML を手で編集して、SVG を隠したり別の画像を表示させたりすること。
作業ディレクトリの内部ファイル（issue-pfd.json と base.pfdsl）を手で編集・複製・リンクすること、作業ディレクトリを複製して複数の場所から同時に使うこと、model.pfdsl を他のファイルへのリンクにすること。
作業ディレクトリで利用者が編集してよいのは model.pfdsl だけで、別の場所で作業するときは新しい空のディレクトリへ pull する。

操作は送信前に sent として保存し、applied・overwrote・failed・unknown の結果を残す。
HTTP 4xx など不受理が確定した場合と、GitHub 通信経路がなく未送信と分かる場合だけ failed とする。
通信失敗、タイムアウト、履歴で op が見つからない場合は unknown を保持し続ける。
回復用の読取の後に PATCH が成立する場合もあるため、見つからないことを未適用の確定と扱わない。
原稿の操作が unknown の間は新しい原稿を公開しない。
create・publish・restore・status --dir・publish-diagram --dir・resolve で操作記録を照合し、後から見つかった操作の結果を報告する。
render はファイルへ描画するだけで操作記録を照合しない。
図の unknown は原稿の公開や restore を止めず、送信先の図の刻印が原稿版・sourceBodySha256・modelSha256・result と一致し、rendered なら SVG 実体の hash も一致するときだけ applied として閉じる。
送信先により新しい原稿版の図があれば superseded として閉じる。
図の POST の応答を失い候補が複数ある場合は、status または publish-diagram の --diagram で送り先を選ぶ。
候補の列挙だけで保存済みの公開先を別の図へ切り替えることはない。
候補が複数で図の操作が unknown のままでも原稿の照合と公開は続け、図を公開する段階で --diagram を要求する。
図がまだ無く、図の create が unknown の場合だけは重複作成を避けて新しい図を作らず、status と publish-diagram による確認を促す。
この場合でも先に原稿が公開できていればその基底は保持する。
自動再送と自動 merge はしない。

```sh
node scripts/pfdsl/issue-pfd.mjs status 123 --artifact 1 --dir issue-123
node scripts/pfdsl/issue-pfd.mjs resolve issue-123 --abandon <operation-uuid>
```

**resolve --abandon は GitHub の要求を取り消さない。**
放棄は原稿の unknown による新規公開の停止を解除する操作であり、未適用を確定する操作ではない。
放棄した操作も記録に残し、以後の照合で成立が分かれば上書きの有無を報告する。
create の途中失敗は同じ --dir で再実行し、sourceId と操作記録・刻印で再接続する。
以前の create 試行が確定した失敗でない限り、新しい POST は送らない。
POST の直前にも同じ Issue の artifact 一覧と原稿履歴を読み、同じ sourceId が既にあれば重複作成せず停止する。
失敗時の作業ディレクトリをバックアップから戻した場合も、この確認を行う。
停止した場合は表示された artifact 番号を確認し、未公開編集を保全して --artifact を指定し別の空ディレクトリへ pull する。
放棄した create も後から成立し得るため、この制限の対象になる。
要求済み artifact が見つからなければ再作成せず停止する。
通信経路がなく未送信と記録された create は、認証を整えた後に同じ --dir から再実行できる。
必要なら履歴を確認し、未公開編集と操作記録を保全して別の空ディレクトリへ pull する。

状態を書き換える操作は、作業ディレクトリの `.issue-pfd.lock` を排他作成する。
作業ディレクトリを使う入口は開始時に閲覧用の base.pfdsl を状態の基底と照合し、不一致や欠落があれば同じ lock の中で作り直す。
基底の保存後にローカル書込みが失敗しても、次に作業を始める時点で diff の基準を回復できる。
基底の再生成と通常の状態・出力の置換は一時ファイルから行い、既存ファイルの inode へ直接書き込まない。
base.pfdsl が model.pfdsl とハードリンクされていても、基底の修復で編集用の原稿を書き換えない。
作業ディレクトリのない図公開は、起動元リポジトリルートで同じ lock を取る。
取得できなければ PID・操作名・開始時刻を表示して終了する。
プロセスが異常終了して lock が残った場合は、表示されたプロセスが動いていないことと操作記録・履歴を確認し、状態をバックアップしてから残った lock ファイルだけを除去する。
自動的に古い lock と判断して奪わない。

原稿公開の成功時は、送信して読戻しで確認した原稿全文・版・hash を状態の基底へまとめて昇格する。
追加の手元編集は model.pfdsl に残し、次回は直前の公開を基底に比較する。
図だけが失敗しても基底は戻さず、publish または publish-diagram で図を作り直せる。
新しい版の図を読直しで見つけたら古い図で上書きしない。
図の読直しと更新の間の競合は防げず、status と再生成で回復する。
status の保証も照合時点での対応までで、その後の公開を防ぐものではない。

## バックアップと復旧

model.pfdsl と issue-pfd.json、閲覧用 base.pfdsl をまとめて保全し、操作記録を捨てない。
原稿と図の版つき REST 応答も保存すると履歴を照合できる。

```sh
gh api repos/OWNER/REPO/issues/123/artifacts/1 > source-artifact-backup.json
gh api repos/OWNER/REPO/issues/123/artifacts/2 > diagram-artifact-backup.json
node scripts/pfdsl/issue-pfd.mjs restore issue-123 --version 2
node scripts/pfdsl/issue-pfd.mjs restore issue-123 --version 2 --write
```

restore は現在版を取得してその版を操作の基底とし、過去版の散文と原稿を新しい公開操作として書き、図も再生成する。
通常の publish と同じ操作 ID と上書き検出を通り、過去の版も履歴に残る。
現在版のフェンスが壊れて新しく pull できない場合も、既存の作業ディレクトリから過去の正常版を復旧できる。
restore は操作記録を照合した後の基底と model.pfdsl が一致するときだけ実行できる。
未公開の編集がある場合は書かずに停止するため、編集を別の場所へ退避してから実行する。
原稿の復元が applied になったら作業ディレクトリを retired として記録し、以降の publish と restore を拒否する。
retired の印が無くても、現在の基底を作った操作が applied の restore なら同じように公開を拒否する。
model.pfdsl は書き換えず、処理中に追加された手元編集も保持する。
復元後は新しい空のディレクトリへ pull し、退避した編集を確認してから作業を続ける。
図の公開だけが失敗した場合は publish-diagram で再生成できる。
gh 2.103 以上の `gh issue artifact edit --restore-version` も使えるが、この入口の上書き検出の対象外であり、実行後は図を再生成して新しく pull する。
