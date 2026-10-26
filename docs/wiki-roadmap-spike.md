# Wiki roadmap 連携の試作記録（#1519、第1段階）

この記録は採用判断のための内部資料であり、運用の切替宣言ではない。
第2段階の担当者が実験を再実行し、実環境の未確認点を埋めてから保存先とconsumerの契約を確定するために使う。
初回の調査基準は `8b16e2a3f4620bde95cb8e1045806cc0f130214c`、GitHub状態の確認日は2026-10-24（JST）。
追加した実Wiki試験の確認日は2026-10-26（JST）であり、その固定版と結果は後段に記す。
第2段階の参照先とstatusの説明は、2026-10-25の #1519・#1542 の決定とroadmap計画に合わせて更新した。試作の観測結果は当時のものとして保持する。
対象は [#1519](https://github.com/takasek/pfdsl/issues/1519)、接続先の契約は [#1497](https://github.com/takasek/pfdsl/issues/1497) と [ADR-0048](adr/0048-responsibility-boundary-by-pfd-semantics.md)。

## 今回の判断と方式比較

Wikiを主要候補としてローカルGitで取得・検証・描画・競合を試す。
現行の正本、consumer、共有doneの運用は切り替えない。
当初のローカル試作時点では、ユーザーの二段階の調査・試作の指定を根拠とし、Wikiの公開設定変更、試験ページ公開、Issueコメント投稿は別の外部書込みとして未実施だった。
以下の比較はその時点の記録であり、後日の有効化・試験ページ公開・実Wiki検証の結果は「GitHub実環境の到達点と残る確認」に分けて記す。

| 方式 | 編集 | 履歴 | 同時編集 | 検証 | 参照 | 日常運用と独立性 |
| --- | --- | --- | --- | --- | --- | --- |
| Wiki | Web/Gitを候補にできる | Gitの版と差分 | 通常pushの拒否を利用できる。Webは未実測 | 保存後検証は不正版が一時的に正本になるため利用拒否が要る | 本体repoの版と論理パスを別に指定 | 本体PRを待たず更新可能。イベント・認証・画像表示の実測が必要 |
| 専用Issue本文 | Issue編集UI/API | 本文をGit commitとして取得できない | 全文更新時の上書き防止を別途設計 | 検証用snapshotと生成画像の保存先が必要 | 本体repoの版と論理パスを別に指定 | 独立更新は可能だが原稿と画像の更新境界が分かれる |
| repo正本＋先行統合 | 既存PR編集 | 既存Git履歴 | PRで解決 | マージ前検査を利用 | 現行の配置を維持 | 状態更新だけのPR・統合待ちが残り、独立更新要件を満たさない |
| 別の計画専用Git repo | Git/PR編集 | Gitの版と差分 | 通常push/PR | 計画repo内のCI | 本体repoの版と論理パスを別に指定 | 独立性は満たす。別repoの権限・発見導線が必要 |

元の3案は「本体repoに付属した場所で計画を共有する」という前提を共有する。
それを外した4案目も成立候補として残す。
Wikiに原稿と生成画像を置く案を先に試すのはユーザーの試作指定に沿い、Git履歴と独立更新を同時に試せるためである。
専用Issueと別repoは却下しておらず、Wikiの権限・通知・表示が要件を満たさない場合に再比較する。
repo正本案は現行運用の継続先として残すが、独立更新要件を満たす採用案にはしない。

## 再現する試作

実装は `scripts/lib/wiki-roadmap-spike.mjs`、実行可能な実験は `scripts/lib/wiki-roadmap-spike.test.mjs`。
ローカルのbare GitをWikiに見立てる限定試作であり、URLを受け付ける公開アダプタではない。
本体repoのCLIをビルド後、次で実行する。

```sh
node --test scripts/lib/wiki-roadmap-spike.test.mjs
```

`acquire` はWikiのHEAD、ブロックhash、本体repoのcommitを固定し、本体の配置を複製した `.pfdsl/roadmap.pfdsl` へブロックを抽出する。
`evaluate` はその同じ実ファイルに `check --strict`、`meta check-links`、`status ready`、`status blocked`、SVG描画を順に適用する。
試作中はsnapshotを別の編集者へ渡さず、変更の有無を照合する。
正本の検証失敗を古い描画結果へフォールバックさせない。
描画のキーは抽出内容、本体repoのcommit、CLI/core/exporterのビルド済みJavaScript、lockfile、Node版である。
同じキーとSVG hashの一致を確認した場合だけ描画を省く。
無関係なページと生成物だけのcommitでWiki HEADが変わっても、同じ入力なら再描画しない。
検証とready/blockedの取得はその場合も行う。

`publish` は生成SVGとmanifestだけを通常commit/pushする。
公開前に描画結果の本文hashと本体repoのcommitを取得snapshotと照合し、本文が同じでも参照版が異なる結果は拒否する。
人間の `Roadmap.md` は書き戻さない。
取得したWiki commitからremoteが進んでいれば競合として止まり、fetchとpushの間の競合も通常pushの非fast-forward拒否へ委ねる。
無関係なページ更新でも公開時は一旦止め、再取得後に同じ入力なら描画を省く設計である。
force-pushや自動rebaseは使わない。
公開commitと再取得時のcurrent commitを分けて返す。

導入する概念はWiki版、本体参照版、抽出内容hash、生成結果のmanifestと入力キーである。
作業項目の対応付けや完了の判定規則は追加しない。
既存のCLIの外側に置く理由は、取得・push・イベントがGitHub固有の責務であり、PFDの意味論とは独立しているため。
現行の `.pfdsl/roadmap.pfdsl` 固定の各consumerをこの試作へ接続する変更は含めない。

## 検証対象と限界

| 実験 | 確認する結果 |
| --- | --- |
| 単一フェンス | backtick/tildeの閉じたトップレベルブロックを抽出。欠落・複数・閉じ忘れ・引用中のブロックは拒否 |
| 通常取得と描画 | 実際のCLIでcheck、ready、blocked、SVGを生成。本体の参照ファイルは取得後の更新から独立 |
| 生成物・別ページ更新 | 原稿はバイト一致を維持。同じ入力の再取得は描画を省略 |
| 二者編集と古い描画 | 先行したページ更新を保持し、古い描画の公開と後発編集者のpushを拒否 |
| 失敗 | clone失敗、ブロック欠落、YAML不正、循環を非成功として返す。既存の生成物があっても失敗を隠さない |
| 参照 | `basePath`つきlocation、extends、subflowを元の配置で解決し、参照先欠落を拒否 |
| 実roadmap | 現行HEADのroadmapをWikiページに埋めて抽出し、内容一致とCLI出力を確認 |
| 往復 | fixtureのready/blockedと内容がWiki移行・復元を通じて一致 |
| 空白付き原稿 | ページ先頭・末尾の空白を含め、公開後の読戻しで原稿をそのまま比較 |
| 参照版の取り違え | 本文不変でもpreset変更でSVGが変わる2版を用意し、古い結果の公開をWikiへの変更前に拒否。新しい版の再描画は公開できる |

ローカル試験はGitHubの認証、gollum発火、Web編集の競合UI、Wiki上のSVG表示を証明しない。
最初の試作の操作経路はテストから呼ぶ関数であった。
下記の更新候補コマンドを追加したが、実Wikiへの原稿更新を行う運用アダプタはまだない。
更新候補コマンドは検証用のPFDをLFへ正規化し、Wikiページのフェンス外本文と元の改行を保つ。
運用の切替は意味の同値性も照合し、任意のMarkdownをバイト同一で往復できるという契約にはしない。

## 原稿の更新候補を作る切替前準備

2026-10-26の所有者指示「#1542の仕様を確定してPRにまとめたら、#1519の切替前準備も続けよう」に基づく。
今回は、既取得のローカルWikiコピーと本体repoの固定版から、公開しない更新候補を作る経路を追加した。
Wikiを有効化していない状態でも、登録・構造変更・status変更の原稿往復を検証できるため、この経路を先行する。
別クラスの案は実環境用の取得runnerとgollum workflowを先に用意することだが、起草時にはWikiが無効で受入不能であり、日常の原稿更新経路も残っていた。
当初は所有者による有効化後も試験ページ公開とGit取得の受入が未完了であり、原稿更新経路を先行した。
その後に承認を得て進めた実Wikiの確認結果は、下の「GitHub実環境の到達点と残る確認」に分けて記す。
残る実環境用runnerとgollum workflowの試験は、今回の試験ページ公開とは分け、対象の公開内容と編集経路の受入条件がそろった段階で続ける。
既存試作のローカル制限を外して運用アダプタと呼ぶ案は採らない。
「公開まで一体化する」という前提を外し、取得・候補生成・検証・公開を分ける。

`scripts/wiki-roadmap-edit.mjs` はローカルのrepoとWikiを使う。
`scripts/lib/wiki-roadmap-spike.mjs` の取得・単一フェンス抽出を再利用し、取得時のWiki版とページ全体hashを期待値として照合する。
フェンス外の説明・画像参照を保ち、必要ならフェンスを長くして候補本文の終端記号との衝突を避ける。
差替え後に再抽出して、LF正規化した候補モデルと一致することを確かめる。
変更後のPFDは既存CLIで作るため、Wiki専用の登録・status・done判定の規則は追加しない。

次はローカルで取得済みのWikiコピー `../pfdsl.wiki` を使う例である。
本体の文脈とWiki原稿の両方をコミットで固定し、どちらの未コミット変更も入力に含めない。
候補の編集を始める前に期待版・ページhash・元ページを保存する。

```bash
code_revision=$(git rev-parse HEAD)
wiki_revision=$(git -C ../pfdsl.wiki rev-parse HEAD)
page_hash=$(git -C ../pfdsl.wiki show "$wiki_revision:Roadmap.md" | shasum -a 256 | cut -d ' ' -f 1)
git -C ../pfdsl.wiki show "$wiki_revision:Roadmap.md" > ../Roadmap.edit-base.md
```

保存した `../Roadmap.edit-base.md` のPFDブロックを `next-roadmap.pfdsl` へコピーし、既存CLI等で登録・構造・statusの変更を編集する。
編集後も上で保存した期待版とhashを使い、現在のHEADから取り直して古い候補と組み合わせない。
同じシェルで、存在しない出力先を指定して候補を生成する。

```bash
node scripts/wiki-roadmap-edit.mjs \
  --repo . --wiki ../pfdsl.wiki --repo-revision "$code_revision" \
  --expected-wiki-revision "$wiki_revision" --expected-page-hash "$page_hash" \
  --replacement next-roadmap.pfdsl --output ../wiki-edit-candidate
```

競合時は期待値だけを更新せず、新しい版の原稿を保存し直し、その原稿へ変更を適用し直す。
構文・グラフ検査の失敗時は候補PFDを修正して再実行する。
出力先が既存なら、元の出力を保持して新しい出力先を選ぶ。

検証用コピーの論理配置 `.pfdsl/roadmap.pfdsl` を保ったまま、固定したCLIでstrict check・ready・blocked・静的SVGを得る。
元のモデルが不正でも候補の修正は可能で、元の検査失敗はmanifestのbaselineに失敗として残す。
候補が不正なら成功出力を作らず、検証に使ったコピーの原稿も復元する。
PFDのcommandは実行しない。
元Wikiのページ・Git履歴を更新せず、ネットワーク取得・commit・pushを行わない。

出力は `Roadmap.before.md`、候補 `Roadmap.md`、`roadmap.pfdsl`、`Roadmap.diff`、`Roadmap.svg`、最後に書く完了記録 `manifest.json` である。
manifestは元Wiki版、元ページとPFDのhash、候補hash、本体の文脈版、実際のCLI等のdigest、変更前後のグラフ検査結果を区別する。
`referenceResolution: not-verified` と `operationalReady: false` を常に記録する。
strict checkの成功や候補のready一覧を、#1542の参照先解決・実運用の着手許可・共有doneの証拠としては扱わない。
この入口はリンク検査を参照解決の代理として実行しない。

候補作成後にWikiが進む可能性は残る。
将来の公開操作では、manifestの元Wiki版とページhashを実際の送信先で再照合し、不一致なら再取得と再編集を要求する。
今回の候補生成は、その送信直前の競合検査や実Wiki書込みの代替ではない。
companionと採用設定はまだ本体repoに残し、cycle-status・監査・ゲート・release-runner・完了チェーン回収のconsumerは切り替えない。
本体PRの未マージ状態とWiki版の差を扱う既存手順も、この準備段階では維持する。

ローカル検証はページ本文保存、期待版・ページhashの不一致、フェンス欠落・複数・引用内・未閉鎖、CRLF、終端記号との衝突、CLI検証失敗、既存出力の保護、実CLIを使うコマンド入口を対象とする。
このローカル検証だけで認証・gollum・Web編集・実Wiki上のSVG表示を確認したとは扱わない。
実Wikiの到達点は下節で区別し、#1519全体はwipを維持する。

### パスの契約

本体repoのcommitと論理パス `.pfdsl/roadmap.pfdsl` を固定する。
`location`/`command.cwd` は文書位置と `basePath` を使い、extends/subflowは文書位置を使う。
元の配置を再現することで、抽出先の一時ディレクトリ名に意味を依存させない。
この試作は全体で1つの参照commitを固定する。運用版のモデル既定とartifactごとの参照先上書きは #1542 のフィールドで解決し、Wiki専用の解決機構を追加しない。取得方針と、参照先がprocessのlocationやcommand.cwdにも及ぶかは #1542 の設計で確定する。
標準入力は一部のmulti-file検証を省くため、この経路には使わない。

`meta check-links` はURLやglobを検査しない。
SVG exporterは単一URLにhrefを付けるが、ローカルパスや複数locationにはクリック先を付けない。
したがって「検証できた相対locationをWikiでクリックできる」は未達である。
#1497のlocation配列と整合した表示方法は第2段階で決め、GitHub URLへの書換えを正本へ混入させない。

### 失敗と表示の契約

試作は失敗を呼出元へ返し、古い入力の描画を新しいHEADへ公開しない。
ただしWeb編集から再生成まで、以前のSVGがWikiに残る時間は避けられない。
manifestだけでは閲覧者に鮮度が伝わらないため、運用前に「最終成功版の図」であることと取得版・失敗状態をページ上へ表示する仕組みが必要である。
本試作をそのままworkflow化して「常に最新の図」と表示してはならない。
画像だけの更新でページ原稿を書き戻さない要件との両立は、生成専用statusページまたは外部の状態表示を候補とし、実際のWiki表示で確認する。

## GitHub実環境の到達点と残る確認

試作時はGitHub APIで `has_wiki: false` を確認した。
2026-10-26に所有者が設定で有効化し、APIで `has_wiki: true` を再確認した。
初期ページ作成前の `.wiki.git` へのHEAD照会は `Repository not found` であった。
同日の所有者指示「試験用・リポジトリ側が正本と明記して、Roadmap-Trial.mdとSVGを公開して。続けて実Wikiでの取得・検証・表示確認まで進めて」に基づき、次の試験公開と確認を行った。
公式文書は初期ページをGitHub上で作ってから `.wiki.git` をcloneする手順を示す。
WebとGitの両方を検証対象にするが、両方を正式対応するとまだ宣言しない。

承認された公開内容は、次の試験ページとそのSVGである。
編集権限の拡張は行っていない。
本体repoの正本や利用者の作業選択は変更しない。

```markdown
# Roadmap integration trial

This is a test page for issue #1519, not the operational roadmap.
The repository roadmap remains authoritative.

The diagram represents a recorded successful render, not necessarily the latest edit.

![Trial diagram](Roadmap-Trial.svg)
```

上記の本文に続けて、次の単一 `pfdsl` フェンスを置く。

```pfdsl
---
type: roadmap
artifact:
  request: { status: done }
  result: { status: todo, criteria: Trial rendering has been verified. }
---
request >> verify -> result
```

この例は `Roadmap-Trial.md` とする。
Web編集で入力したハイフンはU+2010のファイル名として保存されたため、Git側でASCIIの `Roadmap-Trial.md` へ揃えた。
既存の `Home.md` は保持した。
実公開用のアダプタはまだ用意しておらず、上記ローカル試作の固定ファイル名を運用設定と取り違えない。

### 確認した実環境の範囲

- 公開ページ: [Roadmap Trial](https://github.com/takasek/pfdsl/wiki/Roadmap-Trial)。試験用であり、本体repoのroadmapが正本である旨を表示している。
- Wiki固定版: `a82d10b4e520665e09dc5219deccfb6c20a8e9be`。Webで初期ページを保存した後、実Wikiをcloneし、指定ファイル名への変更とSVG追加を通常pushした。
- 送信前: SVG全source・title/comment/tooltip等のmetadataと実描画を確認し、正確なbytesに対する公開ガードの検査を通した。
- 再取得: 公開後に別のローカルコピーへcloneし、`Roadmap-Trial.md` と `Roadmap-Trial.svg` が準備したbytesと完全一致すること、`Home.md` が保持されていることを確認した。
- 原稿hash（SHA256）: `df52499cd96a8f8ac35a385c0a0d4072df06d7a09869f9fa6cea91fd42b380ed`。
- SVG hash（SHA256）: `0be2e2b20152e65bb679cabca99461ba48073e41669bf0c810c8494ac89ea80d`。
- 検証: 同じ取得版のPFDを抽出して現行ローカルCLIでstrict checkが成功し、readyは `verify`、blockedは空だった。再描画したSVGも公開したSVGと完全一致した。
- 表示: Wikiページ内の相対画像リンク `Roadmap-Trial.svg` が読み込まれ、`request → verify → result` の図を目視した。画像の読み込み完了と自然寸法381×81もブラウザーで確認した。

この試験はファイル参照を持たない小さなPFDを使う。
モデル既定・artifact上書きの参照解決、本体repoの成果物の受入、consumer切替、共有doneの更新時点を実証したものではない。
Webからの新規保存と現在のローカルGit認証による通常pushは確認したが、Webでの既存ページ更新・実環境の二者編集競合・複数ページpushのイベント配送・SVG更新の自動化は未確認である。
Wiki編集者の権限設定の受入も別途確認する。

### 残るイベント・認証・運用の確認

`gollum` は本体repoのdefault branchにworkflowがある場合に発火するため、feature branchだけでは検証を完結できない。
イベント試験には別途レビュー可能なworkflowのPRと、人間によるdefault branchへの統合が必要である。
`GITHUB_TOKEN` のWiki書込可否、`contents: write`で足りるか、bot更新時のイベント抑止は採用環境で実測し、PAT必須とも不要とも決めない。
この段階で認証情報の追加や権限拡張は行っていない。
Issueに残る旧 `agent-operation-guard.mjs` への言及は現行ツリーに対応しないため、実際のharness権限とGit hookに従って試験する。

一次資料:

- [Wikiの追加・編集](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages)
- [Wikiの編集権限](https://docs.github.com/en/communities/documenting-your-project-with-wikis/changing-access-permissions-for-wikis)
- [gollumイベント](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#gollum)
- [tokenとworkflow再起動](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)

## 第2段階の切替・復帰とconsumer

切替時は更新を一時停止し、移行元本体commitとWiki候補commitを記録する。
両方を検証し、グラフ・ready/blocked・参照解決を比較してから正本の宣言を切り替える。
本体の旧roadmapを編集可能な第二正本として残さず、履歴から回収できる状態にする。
companionと採用設定は本体repoに残す案を推奨するが、保存先解決のL2契約として正式に確定する。
rollbackでは更新を停止し、最終Wiki版を取得・検証して本体側へ回収してから宣言を戻す。
移行前の古いファイルを単に復活させると、Wiki側の更新を失うため不可。
取得不能時は最後に確認できた版と未回収の可能性を示し、空の計画で復帰しない。

| consumer | 切替案と残る検証 |
| --- | --- |
| `audit-issues-flow` / `roadmap-registration` | #1497の共通location契約に取得snapshotを渡す。本体PRへの登録待ちだけを補うadvisoryは再評価 |
| `cycle-status*` | 選択・ready・wip更新を同じ取得版へ接続。現在のローカル更新コマンド生成を置換 |
| `gate-check*` | 本体Gitの前後diffから状態更新を推測する検査を、Wiki版と完了根拠へ変更 |
| `release-runner` | 公開後のroadmap同期PR案内を新しい正本への更新案内に変更 |
| `roadmap-publish-guard` | ローカルEdit hookはWikiに効かない。更新経路側の検証へ移すか廃止 |
| `pfdsl-sweep-completed-chains.yml` | 切替時に旧正本への自動PRを停止。Wiki上の自動削除は初期範囲に含めない |
| workflow / pipelineのroadmap入力、`render_previews` | 正本の所在と取得snapshotへの入力を明示。旧ファイルを読ませない |
| `retro-reminder-check` / `managed-issue-reminder` | staged diffからのdone検出と旧正本への案内を見直し、採用した更新経路へ接続 |

`done` はcriteriaと、後続が必要とする場所・版で利用できる根拠に結び付ける。
main実装が必要な成果物はmerge後、公開物が必要なら公開後、検収が必要なら検収記録後に更新する。
Issue closeはdoneの根拠にも契機にもしない。
merge済み実装とWiki上のwipの差を検出する監査は、第2段階の受入条件として残す。
#1519全体の受入条件は未達であり、roadmapでは準備成果物 `wiki_roadmap_ready_for_cutover` をwip、切替出力 `wiki_roadmap_integration` をtodoとする。切替は準備の完了と、#1542の参照先解決実装がWiki運用の採用版に含まれることを待つ。
