# 統合版の受入引継ぎ — 2026-10-16

現在の対象・担当・進捗・既知の問題の正本は[#1445](https://github.com/takasek/pfdsl/issues/1445)、操作と期待結果は[ACCEPTANCE-PLAN.md](ACCEPTANCE-PLAN.md)、実機結果は[ACCEPTANCE.md](ACCEPTANCE.md)とevidenceとする。
本書はこの候補の実装照合・取得情報と実行索引であり、今後の進捗台帳ではない。
[移管記録](ACCEPTANCE-MAPPING.md)は更新していない。

## 版と証拠の再利用範囲

着手時のfetch済みmainは`48ae121c643da65199f185f13713315141065936`。
PR #1448の最終`a8dc14be`を含み、PR #1450のmerge `b4600a9f`も祖先にある。
Open PRは#1451（完了chain回収）、#361（記事計画）、#122（公開自動化）。
#1451のroadmap編集との競合可能性は残すが、その回収をここへ取り込まない。

以下の実装・自動検証・レビューは統合履歴で再利用する。
成功証拠を現候補の実機合格へ転写しない。

- [PR #1448](https://github.com/takasek/pfdsl/pull/1448)：`9c6188c5`で統合済み共有editor 371件、拡張189件、standalone 4399件、root Node 8281成功／1skip／失敗0、型・lint等成功。
  Connections pendingの移動・close/reopen修正後に独立probe10ケース、別文脈シナリオ、VS Code 1.132.1 smokeが成功した。
  `a8dc14be`は正規化パネル幅CSSと計画の追加分を既存6検査・build・lint・Chromeで確認した版であり、全体testの版とは区別する。
- [PR #1450](https://github.com/takasek/pfdsl/pull/1450)：全体test・型検査、non-file URI修正後adapter41件、共有hover／巡回24件、Monaco31件、独立11シナリオ、native出力24件を確認済み。
  最終のhover共通化は938ケースの出力一致、共有hover4件・adapter41件・build・限定独立レビューを再利用する。
  native Rust 51件とnative buildは当該PRの前段の証拠であり、この候補でRust全件を再実行した証拠ではない。
- [PR #488](https://github.com/takasek/pfdsl/pull/488)、merge `9fac657f`：editor connectorコマンド、role別方向、既存／新規ID、取消、共有挿入計算を実装。
  当時の109テスト（共有connector23件を含む）、型・build・独立レビューを保持する。
  実Extension HostのQuickPickは当時未実施で、#482のcloseだけでは実機確認済みと判断できない。

## preview_editing_usabilityとeditor_connectorの照合

分類Aは実装・自動検証・レビュー・試験計画の証拠が揃った条件、Bは実装済みで検証／計画補完が必要だった条件、Cは実装不足、Dは手動実機だけが残る条件を表す。
同じ機能の実装Aと実機Dは両立する。

| 現行条件 | 統合実装・自動根拠 | 判断／今回の補完 | 実機引継ぎ |
| --- | --- | --- | --- |
| #1284 H01/H02：直接近隣、方向、feedback、孤立 | `editor/src/connections-panel.ts`、共有`computeNeighbors`、`preview-graph.test.ts`、`connections-panel.test.ts`、#1448レビュー | A。旧hover SVGを再実装しない | D：GUI-09/10 |
| H03：定義/locationなし、metadata | 共有snapshot／text hover、#1450のschema metadataとnon-file URI回帰 | A。schema外の任意キー表示は要求しない | D：GUI-09/10/27 |
| H04/H05：移動とhover非競合 | Connections中心更新、主図維持、text hover、#1448の実V smokeと独立シナリオ | A。旧hover pointer方式は仕様置換 | D：GUI-09/11/17/20/22 |
| H06/H07：editor／Connections共通cue | `editor/src/preview.ts`、`preview-actions.test.ts` | A | D：GUI-11 |
| H08/H09：寿命、再描画非再発火、view／色、reduced-motion | 同cue test、CSS reduced-motion、revision/disposeとpending requestId、#1448の成功／拒否probe | A | D：GUI-11/16 |
| #1352 P01/P02：全文error、minimap排除と正常回復 | `preview-ux.test.ts`のparse/renderer例外、主図とminimap同時commit、hidden tab復帰 | A。制御例外をnative実測としない | D：GUI-18 |
| P03/P04：初回Fit、100%、倍率、Help、view保持 | `preview-ux.test.ts`、共有toolbar、両README、#1448 browser／V smoke | A | D：GUI-17 |
| P05：定義labelと次metadata、W002、Undo | 共有`edit-navigation-contract.test.ts`、Monaco／VS Code adapter、#1450レビュー | A | D：GUI-19/28 |
| P06：cloneからbuild／起動 | root／拡張README、`.vscode/launch.json`、`tasks.json`はworkspace rootから`make vscode-build`、正しいpackage `pfdsl` | B→A：本worktreeのsetup／workspace buildで対象空振りなしを確認。実F5は既存#1448 smokeと区別 | D：GUI-37 |
| P07/P08：端hover、巡回、既存gesture、作成非競合 | #1448と#1450の共有／host test、既存#1282/#1283/#483 | A | D：GUI-09/11/19/20 |
| P09/P10：回復、連続移動、live/Problems/subflow/Undo/SVG、証拠分離 | #1448全体test・V smoke、#1450 export／言語基盤検査、GUI-16/18/20/34の計画 | A。V smokeをMや全受入へ一般化しない | D：対応IDをM/V別に記録 |
| #482 editor connector | PR #488と現行`vscode-extension/src/connector.ts`、共有`editor/src/connector-logic.ts` | B→A：旧criteriaの実Host条件をGUI-20へ移管し実装完了と分離。今回connector5件と共有回帰を再確認 | D：GUI-20 Vのeditor QuickPick変種 |
| Normalized edgesのClose（GUI-01/21/25） | #1448最終CSS | C→修正：代表幅800/900pxでも文字欠けを再現し、paddingと文字折返しだけを変更。48ケースChrome probe、うち代表幅36ケースで修正前6失敗→修正後0失敗 | M実機D。極小幅の既知不合格は保持 |

この照合に基づき#1284・#1352とpreview_editing_usabilityは実装完了対象、editor_connectorも実装完了対象とする。
実機条件を撤去しておらず、#1445へ移管した。
変更をmainへ届けるのは人間がマージするPRであり、本作業でIssueを即時closeしない。

## 今回の追加検証

共有preview／近隣／cue／connector／作成位置の限定135件、拡張connector／controller13件、正規化と分割6件が成功した。
Chrome probeは本番CSSと本番正規化部品を使い、800/900/1280/320px、sidebarなし／227px相当、本文100/200%、source10/50/90%の48ケースで文字領域・幅・Close／Escapeとfocus復帰を測った。
代表幅36ケースが検収対象で、320pxの12ケースは限界の記録であり任意の極小幅への保証ではない。
テストは`test/normalized-width-probe.mjs`を明示実行し、Chromeの場所は`PFDSL_PROBE_BROWSER`で指定できる。
OS全体や個人設定は変更していない。

## 候補登録

source commitと計画版はともに`3c1ceed33e4d0f118e1939e66aa6877a5ab97d57`。
このcommitの未コミット差分なしを確認してworkspace build、Tauri app build、既存`vsce package --no-dependencies`を実行した。
生成後の変更は候補登録・証拠・roadmapのみで、製品sourceと計画は同commitのまま固定する。
計画SHA-256は`1ad9722c94a0dcc8cd35ebad8666233cf7e07eecf43217b4af486747f2592f5f`。
取得場所はこの作業checkoutを起点とする`packages/standalone/src-tauri/target/acceptance-1445/`であり、外部公開URLではない。
公開用ログとmanifestのpathも同じcheckout相対表記とし、機械の私的rootを含む原ログはローカルに保持する。
別の担当Macへの転送・公開は本作業では行っていない。

| 候補file | SHA-256 |
| --- | --- |
| `pfdsl-0.0.18-3c1ceed3.vsix` | `f9208119b96f0464f6072680b3f002a787d3bc3093fbd78355a7bdee254ca5f6` |
| `PFDSL-0.1.0-3c1ceed3-adhoc.app.zip` | `f446664dc8453f81dd4eabb974a534251c263133f0730725e91bfc75d8eb0dc2` |

実行file・frontend全assets・拡張3bundleのhashは[evidenceのcandidate.json](evidence/2026-10-16-integrated-handoff/candidate.json)、build/packageログとcodesign読戻しも同directoryにある。
Mac実行fileのSHA-256は`157cc5a2086b8067334d6f741840edb62e3a61bdaf2fb343709a27a1b09c9307`。
build環境はmacOS 27.0.1（26A434）／arm64、現在のVS Code CLIは1.138.0で、再利用した実V smokeの1.132.1とは異なる。
受入記録には実行するhost版を別途記入する。

このMacでの先行起動は、候補zipのSHA-256を表と照合してから、新規runへ展開したappの通常LaunchServices経路を使う。
build出力の可変pathを受入対象にせず、展開後の実行fileも上記SHA-256と一致することを確認する。
以下はkitを新規runへ生成した後の例で、`mac-candidate`が既存なら別runを使う。
本作業では手動起動・実機受入はしていない。

```sh
shasum -a 256 packages/standalone/src-tauri/target/acceptance-1445/PFDSL-0.1.0-3c1ceed3-adhoc.app.zip
mkdir /tmp/pfdsl-gui-1445-my-run/mac-candidate
ditto -x -k packages/standalone/src-tauri/target/acceptance-1445/PFDSL-0.1.0-3c1ceed3-adhoc.app.zip /tmp/pfdsl-gui-1445-my-run/mac-candidate
shasum -a 256 /tmp/pfdsl-gui-1445-my-run/mac-candidate/PFDSL.app/Contents/MacOS/pfdsl-desktop
open /tmp/pfdsl-gui-1445-my-run/mac-candidate/PFDSL.app
```

Vは個人環境へ上書きせず、新規run内のuser-data／extensions directoryへ候補を入れる。
以下はkitを`/tmp/pfdsl-gui-1445-my-run`へ生成した後の実行例であり、今回installはしていない。

```sh
code --user-data-dir /tmp/pfdsl-gui-1445-my-run/vscode-user --extensions-dir /tmp/pfdsl-gui-1445-my-run/vscode-extensions --install-extension packages/standalone/src-tauri/target/acceptance-1445/pfdsl-0.0.18-3c1ceed3.vsix
code --new-window --user-data-dir /tmp/pfdsl-gui-1445-my-run/vscode-user --extensions-dir /tmp/pfdsl-gui-1445-my-run/vscode-extensions /tmp/pfdsl-gui-1445-my-run
```

そのwindowでPFDを開き、`PFDSL: Open Preview to the Side`を実行する。
GUI-37はpackage起動とは別にroot／拡張READMEのclone→build→F5経路を検査する。
候補VSIXのzip内3bundleをbuild済みdistとhash照合し、すべて一致した。
VのGUI-26〜29は既存language configuration／grammar／hover／jump／definition／normalize／sort、GUI-30/31はdocument-link／diff、GUI-34/35はexportの実装と検査を確認した。
これらは#1448統合全体検査と#1450の追加adapter検査・レビューの対象であり、今回Vの製品sourceは変更していない。
VSIXのpackage versionは既存`0.0.18`を維持し、同番号のMarketplace公開物とhashで区別する。
Macアプリのversionは既存`0.1.0`で、開発／ad-hoc署名の先行確認用。
正式署名・公証DMG、gui_mac_acceptanceの完成、公開完了を意味しない。

## 残件と今すぐできる範囲

1. #1445担当（受入実施者はIssue未割当）：版固定VSIXのV対象GUI-09〜31/34/35/37/38と、開発用Macアプリの機能部分を実行できる。
   最初に候補hashを照合し、[kit](acceptance-kit/README.md)を新規ディレクトリへ生成して`one/same.pfdsl`を開き、GUI-10/11のp→a→rとGUI-17のFit／100%から始める。
2. #1262担当（配布準備者はIssue未割当）：正式署名・公証、DMG、最低OSの決定と実測、関連付け、手動更新案内、GUI-39〜41の導入環境が残る。
   現設定`minimumSystemVersion: 11.0`は対応実測の証拠ではない。
   公開後GUI-42と長時間GUI-43も未実施であり、この作業では実装し始めない。
3. #1448の既知症状：320px・source90%のClose文字欠け、sidebar相当併用時のpanel26px対diagram10.406px／sourceへ9.594px重なりを不合格履歴として保持する。
   今回の代表幅修正後も極小幅・nativeの合格にはしない。再試験先GUI-01/21/25。
4. #1448の`preview.createDefinition()`公開API直接呼出しは非同期consumerの共通排他を保証しない。
   現行consumerは同期standalone、非同期Vに当該UI入口なしとレビューで確認済みで、現行UIの不具合判定は撤回されている。
   将来consumer追加時の制限を現在のhost不合格と混同しない。pending UIはGUI-14/16へ残す。
5. #1450のPNG日本語glyph目視、外部viewer・実terminal／browser到達、OS権限、IME／読上げ、最低OS、配布物は未実施（GUI-23/24/30/33〜36/39〜43）。
   PDFKitの日本語抽出・描画と、Adobe-Japan1 mapping不足のPoppler観測は区別する。
6. 旧版のeditor/minimap不一致、hover/scroll/cue等の成否はACCEPTANCE.mdの当時の版へ保持する。
   後続の同期修正の自動証拠は再利用できるが、新しい統合UIのM/V実機合格へ転写しない（GUI-11/17/18/38）。

V候補準備はMac署名や受入を待たない。
Mac／Vの実機合格artifactと公開artifactは未完了のままとする。
