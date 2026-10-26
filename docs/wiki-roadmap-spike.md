# Wiki roadmap 連携の試作記録（#1519、第1段階）

この記録は採用判断のための内部資料であり、運用の切替宣言ではない。
第2段階の担当者が過去の試験証拠と現行生成器を参照し、実環境の未確認点を埋めてからconsumerの契約を確定するために使う。
初回の調査基準は `8b16e2a3f4620bde95cb8e1045806cc0f130214c`、GitHub状態の確認日は2026-10-24（JST）。
追加した実Wiki試験の確認日は2026-10-26（JST）であり、その固定版と結果は後段に記す。
第2段階の参照先とstatusの説明は、2026-10-25の #1519・#1542 の決定とroadmap計画に合わせて更新した。試作の観測結果は当時のものとして保持する。
対象は [#1519](https://github.com/takasek/pfdsl/issues/1519)、接続先の契約は [#1497](https://github.com/takasek/pfdsl/issues/1497) と [ADR-0048](adr/0048-responsibility-boundary-by-pfd-semantics.md)。

## 採用するファイル構成の変更（2026-10-26）

所有者の「companionもWiki本文で記述したい。ただしファイルは分かれていたほうがよい」という指示に基づき、companionはWiki本文、PFD正本は別ファイルとする。
所有者の追加指示「companionとpfdslは同名です。まとめページのほうに区別をつけたい。roadmap.index.mdとか？」に基づき、まとめページを `roadmap.index.md` に分ける。
以下は採用構成であり、小さな試験PFDでの表示確認と実運用への切替を区別する。

| Wiki内のファイル | 役割 | 更新する主体 |
| --- | --- | --- |
| `roadmap.index.md` | まとめページ。SVGを埋め込み、companionのWikiプレビューと原文を1行にまとめ、PFD原文へリンクする | 自動生成 |
| `roadmap.md` | companionの正本。既存companionの内容をWiki本文として記述する | 人間・承認された編集経路 |
| `roadmap.pfdsl` | 依存関係・進捗を持つPFDの正本 | PFDの編集経路 |
| `roadmap.svg` | PFDから生成する表示用の図 | 自動生成 |

companionとPFDは同じbasenameの `roadmap.md` / `roadmap.pfdsl` とし、まとめページだけ `.index.md` で区別する。
図とリンクはまとめページで閲覧し、companionのプレビューは独立したWikiページで開く。保存上はMarkdown2ファイル・PFD・SVGの4ファイルに分かれる。
所有者判断により、この分離構成のファイル名は小文字の `roadmap` に揃える。
Wiki本文のコードブロックをPFDの第二正本として維持しない。
生成するindexにはPFDのtitle・description、図、companionのpreview/source、PFD原文、最後に検証成功した入力Wiki版・生成時刻・toolchain digest・Actionsへのリンクを載せる。
SVG単独へのリンクは置かない。
companionも本体repoから移す方向とし、切替時に本体側の編集可能な第二正本を残さない。
採用設定・取得処理・workflow等、本体repoに属する実装と設定までWikiへ移すことは要求しない。

この判断は、当初の「Wiki本文の単一PFDフェンスを正本にする」「companionは本体repoに残す」という案を置換する。
companion本文に図とプレビューの自己リンクを置いた途中案も置換する。
単一フェンス抽出・更新候補コマンドはGit履歴に退避し、`Roadmap-Trial.md` の公開結果とともに旧候補の試作証拠として残す。
分離ファイル方式は独立PFDを扱う生成器で検証し、実Wikiでの自動更新・表示の受入とは区別する。
companionはWiki本文として編集できるが、独立PFDファイルのWeb編集可否はまだ確認していない。
正式に対応する編集経路は、その確認とGit編集の受入に基づいて決める。
取得側は同じWiki固定版からcompanionとPFDを取り、SVGはそのPFDと参照先の固定版に対応付ける。
同時更新の検査は、PFDとcompanionの変更を同じcommitへ一律に束ねるためでなく、各編集が基にしたファイルを別の内容へ上書きしないために行う。

試験用のまとめページは [roadmap.index](https://github.com/takasek/pfdsl/wiki/roadmap.index)、companionプレビューは [roadmap](https://github.com/takasek/pfdsl/wiki/roadmap) で公開した。
Wiki版 `584c688185fe965debdb1e769c47f32b075a6dfe` で、まとめページからcompanionへの遷移と図の表示を確認した。
このcompanionは試験用の説明であり、本体repoにある運用companionの移行完了を表さない。

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

## 旧単一フェンス試作の記録

初期試作ではMarkdown内の単一PFDフェンスを抽出し、原稿を保って更新候補を作る方式を検証した。
ファイル分離方式の採用により、この方式のCLI・取得・編集・公開処理と専用19テストは現行ツリーから削除した。
旧方式を提供するための互換経路は残さず、必要だったbuild内容の識別処理だけを現行生成器へ移した。

過去の検証は当時の固定版の証拠として参照し、現行方式の受入根拠にはしない。
再調査が必要な場合の一次資料は、削除前の固定commitに残っている。

- [取得・検証・公開の旧試作と9テスト](https://github.com/takasek/pfdsl/blob/cdaaa9be15ea98f50b00dc14f9eaf7f0cb9b7239/scripts/lib/wiki-roadmap-spike.test.mjs)
- [原稿更新候補の旧実装](https://github.com/takasek/pfdsl/blob/cdaaa9be15ea98f50b00dc14f9eaf7f0cb9b7239/scripts/lib/wiki-roadmap-edit.mjs)と[10テスト](https://github.com/takasek/pfdsl/blob/cdaaa9be15ea98f50b00dc14f9eaf7f0cb9b7239/scripts/lib/wiki-roadmap-edit.test.mjs)

現行生成器の9テストは、原稿保持、無変更時の再利用、生成物の修復、検証失敗時の前回表示保持、未対応参照の拒否、公開先と競合を対象とする。
修復は戻り値だけでなく実ファイルと検証記録のhashを照合し、公開はremote上のcommitと4ファイルのbytesを直接比較する。
GitHub固有の認証・gollum・ブラウザ表示の受入は、このローカル検証とは区別する。

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
companionは上の所有者判断に従いWikiのMarkdown本文へ移し、独立したPFDファイルと同じWiki版から取得する。
採用設定と取得・更新の実装は本体repoに残す。
保存先解決のL2契約と、独立PFDファイルを読み書きする入口は後続の準備実装で具体化する。
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

## 分離構成のindex・SVG自動生成

### 既存エディタからの正式な公開経路

所有者はPFDの日常編集を既存エディタで行い、公開コマンド1回で検証・Wiki反映・図更新まで済ませる方式を選択した。
Wikiのdefault branchをcheckoutし、`roadmap.pfdsl` または `roadmap.md` を編集する。
専用コマンドは未commit・未stageの変更を受け取るので、原稿だけのcommitやpushを先に行わない。
変更できるのはこの2ファイルであり、ほかのページ・生成物・新しい依存ファイルの追加は、この初期の公開経路に含めない。
コマンドを実行する本体repoのbuild、Wikiへの通常Git書込権限、Gitのuser.nameとuser.emailが必要である。
この初期コマンドは、fetch/push両方のorigin URLが `https://github.com/<owner>/<repo>.wiki.git` のcloneを対象にする。
SSHやURL書換えを設定した既存cloneを変更せず、下のHTTPS cloneを別に用意する。

```bash
git clone https://github.com/takasek/pfdsl.wiki.git /path/to/wiki
# Edit roadmap.pfdsl or roadmap.md in your editor before publishing.
node scripts/wiki-roadmap-publish.mjs --wiki /path/to/wiki --repository takasek/pfdsl
```

取得済みのWiki版を基に、編集した原文を作業用cloneへコピーし、未公開の原稿commitを作る。
既存generateで検証・描画して生成物commitを作り、両commitを1回の通常pushで公開する。
receiptの入力版は、その公開履歴に残る原稿commitを指す。
Gitの改行正規化がある場合も、検証・描画・receiptの入力hashは公開する原稿commitの内容を使い、編集中の変更検出には手元の元bytesを使う。
過去の検証済み内容へ戻して既存のindex・SVGを再利用できる場合は、原稿commitだけを公開し、receiptには再利用した生成物の入力版を保持する。
gollum配送やActionsの追加起動に依存せず、原稿だけが公開される中間状態を作らない。
remoteへの通信は元のcloneから行い、そのcloneだけに設定したGit認証・通信設定を再利用する。
認証情報を準備cloneへコピーしたりreceiptへ記録したりしない。
PFDとcompanionの両方を必ず編集する必要はない。

不正入力ではremoteを変えず、元の編集を手元に保持する。
古い版からの編集やremoteの競合では、自動merge・force-pushを行わず停止する。
公開処理が失敗した場合は準備済みcloneの場所・編集前の版・原稿版を返し、調査・復旧まで保持する。
特に通信切断などで公開結果が不明な場合は、再実行前にremoteの版と準備済みの版を照合する。

成功後、手元の状態が開始時と同じなら、原稿をstageして公開版へfast-forwardし、続けて編集できる状態にする。
公開中に別の編集を加えていた場合や手元の同期に失敗した場合は、その編集を残し、`status: published` と `localUpdated: false` を返す。
この場合は公開済みなので同じ編集を再公開せず、保持した編集を新しい公開版へ移してから次の作業を続ける。
まず元のcheckoutの2ファイルを退避し、公開版のfresh cloneを別の場所に取得する。

```bash
backup="$(mktemp -d)"
cp /path/to/wiki/roadmap.pfdsl /path/to/wiki/roadmap.md "$backup/"
git clone https://github.com/takasek/pfdsl.wiki.git /path/to/wiki-next
```

`recoveryPath` は公開準備時の原稿を含むcloneである。
エディタでその2ファイルと退避した2ファイルを比較すると、公開後に追加した編集を区別できる。
その差分だけをwiki-nextの最新原稿へ手で反映し、先行した他者の変更を保持したうえで、新しいcloneを公開コマンドへ渡す。
退避ファイルの全文を新しいcloneへ無条件に上書きしない。
公開前のremote競合で停止した場合は、元のcheckoutのHEADが編集開始時の原稿なので、その版と退避ファイルとの差分を同様に最新cloneへ移す。
準備cloneの削除だけに失敗した場合は公開成功を維持し、`cleanupWarning` と `cleanupPath` に残存場所を返す。

単に原稿をpushしてからActionsを起動する別案には、原稿公開後に検証が失敗する余地がある。
定期取得は通常Git pushを扱えるが、図の更新が遅延し、不正原稿の公開前検証にはならない。
今回は所有者がローカル編集と公開コマンドを選択したため、サーバー側だけで検証する経路、ブラウザ専用のPFD編集面、別の計画repoは採用しない。
それぞれの経路が必要な採用先では再検討し、このコマンドがその入力を包含するとは扱わない。

### 生成物だけを更新する経路

`scripts/wiki-roadmap-generate.mjs` は、単一フェンスを使う旧試作とは別に、同じWiki commitの `roadmap.pfdsl` と `roadmap.md` を入力にする。
生成先は `roadmap.index.md` と `roadmap.svg` だけで、手書きの2ファイルは変更しない。
indexの本文を手で変更しても次の生成で置換するため、説明の正本はcompanionに書く。
この段階では生成したindexにも試験用・本体repoが正本という表示を残す。

ローカルでCLIをbuildした後、cleanなWiki cloneを指定する。
通常実行は出力をローカルへ書くだけで、`--publish` を付けた場合だけcommit・pushする。
以下の2コマンドは用途別の選択肢であり、順番に実行する手順ではない。
ローカル生成の出力は未commitのため、そのまま再実行すると `Wiki checkout must be clean` で停止する。
ローカルで繰り返し試す場合は生成物を確認してcommitしてから再実行し、公開を選ぶ場合は元のcleanなcloneで最初から `--publish` を指定する。
`--expected-revision` を省略した場合は実行開始時のHEADを固定する。

```bash
node scripts/wiki-roadmap-generate.mjs --wiki /path/to/wiki --repository takasek/pfdsl --expected-revision <full-wiki-commit>
node scripts/wiki-roadmap-generate.mjs --wiki /path/to/wiki --repository takasek/pfdsl --publish
```

PFDのtitleとdescriptionをMarkdownの文字としてescapeして表示し、固定したWiki snapshotを複製して `check --strict`、`meta check-links`、SVG描画を行う。
PFDのcommandは実行しない。
snapshot全体のGit tree（生成先2ファイル以外）、CLI/core/exporter/preview-engineのbuild内容、lockfile、Node版、生成器自身を入力キーに含める。
extends・subflow・ローカルlinkの変更を見落とさないため、無関係なページ変更でも保守的に再生成する。
出力だけのcommitではキーが変わらず、index本文とSVGのhashが一致すれば再生成しない。
生成時刻・入力版・入力と出力のhashはindexのHTML commentに記録し、余分なmanifestファイルは作らない。

検証失敗・開始後のHEAD変更・未commit変更では公開しない。
公開直前に入力と生成物の一致、stage済み変更がないこと、originのfetch先とpush先、remoteの版を確認する。
生成物2ファイルだけを同一commitで送り、fetch後の競合は通常のnon-fast-forward拒否へ委ねる。
検証失敗時には前回のindex・SVGを保持し、indexは「最後に検証成功したsnapshot」と入力版・時刻を示す。
最新入力の成功を保証する表示ではなく、失敗はActionsの実行結果で確認する。

`.github/workflows/wiki-roadmap-generate.yml` はgollumと手動実行を入口とし、本体repoのbuildから生成器を実行する。
gollumはworkflowがdefault branchに存在する場合に発火する（[GitHub公式仕様](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#gollum)）。
ActionsのGITHUB_TOKENをcontents: writeで利用する提案であり、このPRのローカル試験は実Wikiへのtoken書込権限、gollum発火、Web編集後の自動更新を証明しない。
権限不足ならジョブを失敗として止め、認証方式を無断で追加しない。
Gitで更新する場合の発火も未確認のため、手動実行を併設する。

現在のCLIは #1542 の参照先解決をまだ実装していない。
coreの依存closureを使い、entry・extends・subflowの実際の読み込み対象を拡張子に依存せず調べる。
そのいずれかにbaseRefまたはartifact.refがある場合は、無視して成功扱いにせず生成を拒否する。
依存文書がWiki snapshotの外へ出る場合も生成を拒否する。
この制限を外し、本体repoのartifact参照を同一の採用実装で解決・検証することが切替前の残件である。
既存consumerとpipelineの正本入力は変更せず、準備はwip、切替はtodoを維持する。

## マージ後の実環境受入（2026-10-26）

上記の認証・イベント未確認という記述はPR #1547時点の境界であり、以下はmerge後の固定版で追加した実測である。
実行した本体版は `254ff066f36c9fe4ecd89c3017c10a602cfc909c`、試験対象は既存のWiki trialだけである。
正本・consumer・編集権限・認証方式は切り替えていない。

| 試験 | 実測 |
| --- | --- |
| [手動実行](https://github.com/takasek/pfdsl/actions/runs/40276950372) | 成功。既定のGITHUB_TOKENとcontents: writeでclone・検証・通常pushできた。Wiki出力版は `52599f40936f51fb67ceee86bf77e4d9fc05900a` |
| [Web編集からの自動起動](https://github.com/takasek/pfdsl/actions/runs/40277183097) | companionをGitHubの編集画面で保存するとgollumで起動し、indexを更新した。入力版は `d94df97c2b4b620a9c21535a536c3c5c84fac583`、出力版は `21524a68eee7031877925a784c2b70b2b05186e4` |
| [不正入力の拒否](https://github.com/takasek/pfdsl/actions/runs/40277406411) | 試験PFDを一時的に循環グラフにし、手動実行がV010・V035で期待どおり失敗した。indexとSVGは前回成功時のbytesを保持した |
| [元のモデルへの復旧](https://github.com/takasek/pfdsl/actions/runs/40277520734) | 原文を元のbytesに戻して通常pushした。手動実行はunchangedで成功し、既存の成功receiptと図を再利用した。新たな公開commitは作っていない |
| 実remoteの競合 | Wiki版 `84a3a790bc860b35bbf1b8941f3d32bf240abefb` からローカル公開候補を準備後、別のWeb編集を保存した。候補のpublishはfetch後に `Wiki remote conflict` で拒否され、local HEADは動かず、先行編集を上書きしなかった |
| [先行Web編集の自動生成](https://github.com/takasek/pfdsl/actions/runs/40277642304) | gollumからの生成が成功。最終Wiki出力版は `d6bf5adc681e9eaac96ac8a49bcae13969ca838f`、入力版は `f4465e08c885a3a63780320c3d3e16c8b00e0abd` |

最終出力を再取得し、indexのreceiptが持つsourceHash・companionHash・svgHashを実ファイルのSHA256と照合した。
PFDは試験前の原文とbyte一致し、SVG hashは `0be2e2b20152e65bb679cabca99461ba48073e41669bf0c810c8494ac89ea80d` だった。
ブラウザでindexの図の読込完了と自然寸法381×81、原文・companion preview/sourceへのリンク、入力版・最終成功の表示を確認した。
companionに残っていた「自動更新しない」という旧説明は、Web編集試験で現行workflowの説明へ更新し、Actionsへの証拠リンクも残した。

GitでpushしたPFD変更では、この試験中のrun一覧にgollum起動を観測せず、明示的な手動実行で不正入力と復旧を確認した。
Webでのcompanion編集による自動起動と、GitからのPFD更新の自動配送を同じ受入にしない。
この実測時点ではPFDの日常編集経路と自動生成への接続は未受入であり、試験中のGit更新には手動実行を併用した。
後続の公開コマンドは上節のとおりGit更新イベントに依存せず、編集から検証・図生成・公開までを一つの操作にする。
fetch後からpush直前の狭い競合窓、共有done、本体repoの参照解決、consumer移行、正本切替も今回の実測範囲には含めない。

### 公開コマンドの実Wiki試験（2026-10-26）

既存の試験PFDのtitleとresultのlabelだけを変更し、公開コマンドを1回実行した。
statusとグラフ構造、companion、本体repoの正本は変更していない。
実行結果はpublished・localUpdated=trueであり、原稿版 `ca500917e272011f9249e992e9876effe141c043` と生成物版 `dfccf24ff8877841c992587bd96086dd86c9d640` が、編集前の版 `d6bf5adc681e9eaac96ac8a49bcae13969ca838f` に続く2つのcommitとして公開された。
公開コマンドはActions起動や手動の生成コマンドを併用せず、手元のcloneもcleanに同期した。

別のcloneで再取得し、receiptのsourceHash・companionHash・svgHashが各ファイルのSHA256と一致することと、receiptが指す原稿版が公開履歴の直前の祖先であることを確認した。
SVG hashは `b19d84acb11be4da9862f36d12de9e4bf241ae7182952ea63b974611bc58ef9d` で、事前にsource・metadata・描画を確認したSVGとbyte一致した。
ブラウザでもRoadmap publishing trialの見出し、Trial resultの図、原稿版の表示、画像の読込完了と自然寸法413×121を確認した。
これはこの版の公開コマンドを使う経路の受入であり、任意のGit pushの自動配送や、本体repoの成果物の参照解決・正本切替の受入ではない。
