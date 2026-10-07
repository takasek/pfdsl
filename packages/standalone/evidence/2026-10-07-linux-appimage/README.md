# PR #1411 固定版の Linux native・既存5件の受入記録

2026-10-07 UTC の dot 検収報告を受領し、親が添付証拠を照合した記録。
Linux GUI の実操作は dot の報告に基づき、親による GUI 再実行ではない。
検収対象は以下の固定版であり、この受入記録の追加 commit を測ったことにはしない。

## 来歴と識別情報

- Repository / PR: `takasek/pfdsl` / [#1411](https://github.com/takasek/pfdsl/pull/1411)
- HEAD / SOURCE_COMMIT: `8261f877d5cae8aa653a5310edfbd9e387acb116`
- [Desktop run 37574418253](https://github.com/takasek/pfdsl/actions/runs/37574418253)
- [Artifact 11461844652](https://github.com/takasek/pfdsl/actions/runs/37574418253/artifacts/11461844652)
- Artifact name: `pfdsl-linux-appimage-x64-8261f877d5cae8aa653a5310edfbd9e387acb116`
- Artifact ZIP SHA256: `5da075978ae820742941c1295f00b2ac89ba69addb49b8388d09813b64159545`
- AppImage SHA256: `d86140eab278f84b29441117e86ead0a9f5be956e0cda2ce97ed29e8a8bdcc60`
- Inner native SHA256: `10fdeff86b2a48e11948f40cbf99a7207e70c91e7c19f1f064c61bb38f441495`
- Runtime: dot cloud Debian 13.6 / x86_64、Linux 6.18.44、glibc 2.41、uid 1000、Xfce、DISPLAY `:0`
- JS build / CLI: Node.js 24.19.0、pnpm 10.33.2、CLI 0.1.0、固定 checkout の `node packages/cli/dist/cli.js`
- VS Code: 1.140.0 / `07f806f999227108933c2e30515b26eecc1fda74` / x64、拡張0.0.18、隔離 profile の実 Extension Development Host
- CI builder: Debian 13.7 x86_64、Node.js 24.21.0、pnpm 10.33.2、Rust/Cargo 1.99.0、GTK 3.24.49、WebKitGTK 2.54.0

元の検収証拠 ZIP は所有者が添付した `pfdsl-1411-8261-acceptance-evidence.zip`。
受領 ZIP は20,814,786 bytes、SHA256 `25624580ce027951aa08e6eb912cdaf26f7f9f324f2d1a50224f5f46bb7ea2c6`。
親は path / link / duplicate entry と CRC を確認して新規ディレクトリへ展開し、SHA256SUMS の1,133ファイルすべてを照合した。
このディレクトリへは [元の host matrix](host-matrix.csv)、[前段の native 報告](dot-native-report.txt)、[native corpus report 原本](native-report-original.txt)を改変せず複写した。
[機械可読 report](native-report.json)は原本から書式だけを整え、JSON の全値が原本と一致することを照合した。
画像・source snapshots・コマンドログ・crosswalk 等の全量は元の ZIP に保持し、matrix の evidence 列はその ZIP 内の相対パスである。
添付証拠の保管記録と GitHub Actions の期限付き artifact は別の来歴として識別する。

## #1408 の native 受入

通常の `./AppRun` で window・editor・日本語図・minimap を表示。
Open folder → Escape でキャンセル → 再度 Open folder を使用し、使い捨てフォルダの文書を Rust reader 経由で読み、source と図を表示した。
title を `Native folder check 826` から `Native folder check 826x` へ編集し、dirty 印と図更新を確認した。
window close → Keep Editing で編集・dirty・図を保持 → 再 close → Discard で window が閉じ、process exit 0。
原本の前後 hash は一致し、通常起動 stderr は空。
GTK picker の Recent では path の Return だけで遷移しなかったが、Home から location 入力する通常操作で選択できた。

artifact の外側 SHA256SUMS は14/14、AppDir は304/304一致し、native と GLES の ldd は missing / version error なし。
同 HEAD の `make build` が成功し、artifact frontend と standalone dist は集合・hash とも10/10一致。
同じ内側 executable で corpus を準備し、同じ AppRun で実行した [report](native-report.json)は reference・execution SHA256 が上記対象と一致する。
documentCount 23、全23文書 passed、全体 passed、failures / errors は空。
corpus window の通常 close は exit 0、stderr は空。
入力23文書と payload の実行後保持も dot が確認している。
親は添付された report の reference・execution SHA256・件数・合否を照合した。
desktop CI の linux-native / linux-appimage-runtime / macos-app も同 source HEAD で成功している。

## 既存5件の元集計と範囲

133条件 × 3 hosts = 399セル。
対象212セルは成功200・失敗3・未実施9、対象外187。
未実施は試行済みの部分確認を含み、pending は0。
親と独立 reviewer が JSON / CSV の全件、原 issue の28 checkboxと #483 の2 prose 条件、ユーザーの53 feature bullets の対応、証拠参照の存在を照合した。
画像の全量審査と Linux GUI の再実行は行っていない。

| Issue | Native 成功 / 失敗 / 未実施 | VS Code 成功 / 失敗 / 未実施 | CLI 成功 / 失敗 / 未実施 |
| --- | --- | --- | --- |
| #1352 | 17 / 0 / 0 | 27 / 0 / 0 | 対象外 |
| #1282 | 9 / 1 / 0 | 9 / 1 / 0 | 23 / 1 / 0 |
| #1283 | 対象外 | 19 / 0 / 1 | 対象外 |
| #1284 | 15 / 0 / 7 | 21 / 0 / 1 | 対象外 |
| #483 | 30 / 0 / 0 | 30 / 0 / 0 | 対象外 |

#1352 の直接操作条件が成功しても、原 issue が要求する関連 issue の全条件や、必要な検査追加・更新までを一括認定しない。
#483 は両 hosts の6通りの接続と Undo/Redo・キャンセル・stale・tab 等が成功した範囲として扱う。
全 issue の完了と束全体の完了、macOS 固有操作、正式配布や他 distro を認定するものではない。

## F-001 の観測と既存契約

未定義 process の作成で、無関係な mapping key の inline comment が次行へ移った。
以下の同じ変更を native / VS Code / CLI で観測し、元の matrix は3セルを失敗として保持している。

```yaml
# Before
artifact:
  input: # Keep here
    label: Input

# After
artifact:
  input:
    # Keep here
    label: Input
```

CLI は exit 0、stderr 空、created / written は成功。
最小文書の前後 SHA256 は `2149fe393cdc2acd86545314a518ae2e6148d3dac0a4caf8a6d7ca7b9677bb88` / `44713a25f5231f5c032b7765e529e2e23e783799552c426e0f0fc9736208fb56`。
定義・コメント内容・quoted 値・本文の保持と、UI / CLI の生成結果一致はこの位置変更と区別する。

親は導入済み yaml 2.8.3 の CLI へ元の YAML を渡し、定義追加を行わない parse / serialize だけでも同じ位置変更を再現した。
製品側は [renderFrontmatterCst](../../../../packages/core/src/frontmatter-cst.ts) の `doc.toString({ lineWidth: 0 })` で frontmatter を再出力する。
[ADR-0034](../../../../docs/adr/0034-pfdsl-owns-frontmatter-format.md)は全文再整形を採用し、[既存テスト](../../../../packages/core/src/insert-definition.test.ts)も trailing comment の位置変更を明示的に許容している。
この経路は PR #1411 の Linux bundle 変更で導入したものではない。

先の検査プロンプトが追加した「無関係なコメント位置まで固定」という厳格条件は既存契約と整合していなかった。
所有者の了承に基づき、現行仕様の受入では内容・無関係な値・本文・改行の保持と、許容された再整形を分ける。
元の観測・失敗判定・集計を書き換えず、3セルを現行仕様違反が確定した製品不具合とも、自動的な成功とも扱わない。
厳密なコメント位置保存を新しい契約にする場合は別途判断が必要。
この記録更新は formatter / CST writer / CLI / UI の実装や仕様を変更しない。

## 初回検収時の残る確認と仕様判断

| Row / host | 残る条件 |
| --- | --- |
| I1283-019 / VS Code | Restricted Mode により未確認だった組込 JS definition / Peek との対照。隔離 profile の link / multi-cursor 操作成功とは別 |
| I1284-012 / native | 狭い右端へ物理 pointer で入り hover へ移動して click。keyboard focus の別入口成功で代替しない |
| I1284-014〜017 / native | 対象のみの一時 cue、両移動経路、旧 cue 解除、通常再描画時の非反復を時間分解能のある実画面記録で確認 |
| I1284-021 / native | 同 process の document / preview dispose 後の旧結果隔離。現 UI にない入口を追加・合成して代替しない |
| I1284-022 / 両 GUI | 実効 reduced-motion 設定が確認できる環境でアニメーション抑制を確認 |

上表は初回検収時の未確認9セルであり、追補結果は次節に分けて保持する。
追加で native の raw CRLF bytes は clipboard / Mousepad / AX の正規化により未確認で、テキスト比較から保存 bytes を認定しない。
O-001 は既に producer を持つ既存 output を選んだ際の V001 と Undo/Redo による復帰・再現の観測であり、semantic-invalid な全候補の事前除外を求めるかは未決。
有効な既存 target の6ケース成功と混同せず、仕様判断をせずに新たな確定不具合へ転写しない。

## 同じ固定版の追補検収

所有者から `pfdsl-1411-8261-supplement-report.md` と `pfdsl-1411-8261-supplement-evidence.zip` を受領した。
追補 ZIP は1,620,351 bytes、SHA256 `7fd509974e7aa87b7e315a9d17ed12f67c499a469170b8b77b63adaee900b5bc`。
親は ZIP の69 entries の path / link / duplicate / CRC と、最上位 SHA256SUMS の68ファイルを照合した。
内側の artifact-identification にある manifests は検証先の payload の記録であり、追補 ZIP に同梱していない AppImage の再検証としては扱わない。
実行 source は引き続き `8261f877d5cae8aa653a5310edfbd9e387acb116`、文書だけの参照は `d297e0d38cc7f3160b9a0fb217dc53d288e1cfa6`。
native executable と AppImage は上記と同じ指紋で、dot は通常の同じ AppRun を用い、manifest・frontend・入力保持・exit 0 と空の launch log を再確認した。

I1284-012 / native は、右端 input node から物理 pointer で tooltip 内へ入り、build を click して主図へ移動する入口を確認し、成功へ更新した。
description 全文と status done が右端の内側へ折り返され、pointer が tooltip 内へ入った後も表示を保持した。
親は `native/limitrightpointer.png`、`native/limitinside.png`、`native/limithoverframe0.png` の画面と操作記録を照合した。
これにより、今回9セルは1成功・8未確認、[累積399セル](supplement/cumulative-matrix.csv)は成功201・旧失敗履歴3・未確認8・対象外187となる。
native は72成功 / 1旧失敗 / 6未確認、VS Code は106 / 1 / 2、CLI は23 / 1 / 0。
未変更390セルの元 CSV の値、旧失敗3セル、対象セルの元結果 history を親が照合し、唯一の status 変更が I1284-012 / native であることを確認した。
元 CSV の2 review notes は累積 JSON の history に保持されている。
元の全量 JSON と ZIP は今回の親環境には残っていないため、dot が報告した原本1,133ファイルの再照合と全 JSON 値の不変は、今回の親による独立な全量再照合とは区別する。

残る8セルは I1283-019 / VS Code、I1284-014〜017 / native、I1284-021 / native、I1284-022 / 両 GUI。
native cue は click 後18〜435 ms の8画像と181 ms 間隔の連続選択でも明瞭に確証できず、主図移動を成功の代替にせず、不具合とも断定しない。
同 process dispose と通常 Save は現 native UI に入口がなく、CRLF 保存 bytes は399セル外の未確認として維持する。
native の OS 読取は xfconf property 不在・gsettings 不在のため実効 reduced-motion 値を確証できなかった。
VS Code は前回の8261実行 payload と隔離 profile が残っておらず、許可済み trusted workspace を確認できないため、GUI 起動前に停止した。
Code binary と復元 source の指紋一致だけで前回の Host や今回の2条件成功を認定しない。

累積 CSV の `evidence_origin` が `original ZIP 25624580…` の参照は元 ZIP、`addendum` の参照は追補 ZIP 内の相対 path である。
原本と追補を混ぜず、画像・時刻・詳細 JSON と実行ログは追補 ZIP に保持する。
F-001 の契約整理と旧失敗履歴、O-001 の仕様判断、全 issue の未完了を維持し、製品 source・runner・設定は変更しない。

## CI と履歴の境界

[Test run 37574418226](https://github.com/takasek/pfdsl/actions/runs/37574418226) の実 checkout は synthetic merge `96a306ac87951d6b050d83aed9770875025deaa9`。
固定 source HEAD との差は `packages/vscode-extension/smoke/harness.test.mjs` と `packages/vscode-extension/smoke/run.mjs` の2ファイル。
同じ product / unit source の補助証拠として再利用したが、別 runner の vscode-smoke 成功を `8261f877` 固定 runner の成功へ読み替えない。
今回の VS Code GUI 成功は実 Extension Development Host の独立操作に基づく。

旧 `c42367f8` の WebKit 不足、旧 `07f541ff` の GLES 不足、旧 `99cf6664` の CLI / VS Code 成功を今回の記録で書き換えない。
macOS native CI build は実施済みだが、新しい macOS 実機 GUI / IME / shortcuts は未確認。
検証先での OS package 導入、system / sandbox / 描画 flag 変更、source / runner 修正は dot の検査に含まれない。
この記録の追加だけで Linux 製品機能・配布保証・未確認条件の合否を変更しない。
