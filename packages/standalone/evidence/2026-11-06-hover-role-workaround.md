# Linux hover の列見出し role 回避候補（#1513）

## 根拠と範囲

元の AppImage は `b008ba8b43e5dc35f0c5d2b9d41f8ade2187a3c4`、修正前のソース基準は `4a20f90aea9e61f8042aa9378ad0e77800a3e2c1`。
2026-11-06 の採取元 WebKitGTK 2.54.0 は Build ID `d7031d4f1e24dbf87e87b0f8cb1d1e0ef4401bc2`、ライブラリ SHA-256 `ea9fbeccfe53a285391bfdafc9021149bd369e6823adc25a588688d8b948c3d6`。
実アプリの停止スタックは AT-SPI `GetRoleName` → `AccessibilityObjectAtspi::effectiveRoleName()` → 1288行の assertion → abort に対応した。
採取元 ELF の `.text` 全体と該当命令を公式パッケージに照合した。
[該当ソース](https://github.com/WebKit/WebKit/blob/webkitgtk-2.54.0/Source/WebCore/accessibility/atspi/AccessibilityObjectAtspi.cpp#L1176)には ColumnHeader / RowHeader の未処理分岐がある。

同じ採取元ライブラリを使う静的 HTML の各1回比較では、通常 td は数値role 56で空文字応答後約60秒生存、native列 th（10）と行 th（47）は同じ assertion で SIGABRT、明示 columnheader（10）と rowheader（47）は空文字応答後5秒生存した。
D-Busの各要求1件と対象Web子の所有PIDを照合した。
通常 td の予定5秒記録は採取スクリプトのエラーで欠測し、後から同一起動の生存を確認した。
非公開の返却ZIPの SHA-256 は `8894844bc4eb14fcdb85a30cd007caf32e535d2713255c52139dde88dc4378a4`。
生ログやホスト固有情報はリポジトリへ転載しない。

元アプリの失敗したDOM要素は未特定であり、最小比較から製品の完全修復とは判断しない。
空文字応答は、role名・読み上げ・見出し関連付けの正しさを保証しない。

## 実装の境界

standalone の Monaco 0.57.0 の既定 Markdown renderer に委譲し、返却DOMの `thead > tr > th` に `role="columnheader"` を同期付与する。
hoverへの挿入前に処理し、初回model作成より前にserviceを登録する。
共有hover文字列生成器とVSCode側は変更しない。
生成metadataとGFM表の列見出しが対象で、tbody / tfoot の th は分類しない。
任意の著者HTMLの行見出しや複合表に対する全面的な回避ではない。
Monacoがrole/scopeをsanitizeする既存の挙動を前提とするため、任意HTMLの意味保存も保証しない。
既定のリンク処理・command許可リスト・code block renderer・disposeを維持する。
Monacoの内部service APIへの依存は局所化し、更新時は実モジュールの結合検査で確認する。

文字列にroleを追加する案はMonacoのsanitizerで除去されるため不十分。
表をリストへ変更する案は表示変更を伴い、著者の表も別に残る。
MutationObserverによる後付けは公開前の付与を保証しない。
今回は既定rendererの局所ラップを採用し、任意thの独自分類は追加しない。

## Linux 製品版での再試験

対象はGUI-27 / GUI-44。
元AppImageを保持し、修正版のcommit・配布物SHA-256と、実際にロードしたWebKitの版・Build ID・SHA-256を別に記録する。
元377バイトfixtureのSHA-256を照合し、既存の[採取手順](2026-10-26-linux-hover-summary/NEXT-LINUX-RUN.md)で同一PID/start tickの観測を開始する。

1. 14行目のpackage_manifestでShow Hoverし、実際のhover DOMに2つの列thと明示columnheaderがあること、criteriaとgroupを読めることを採取する。
2. DOM確認を加えた試行と、元手順の撮影→Escape→編集の試行は区別する。
3. AT-SPI照会を加える試行は対象object path・数値role・Web子のowner PID・要求時刻・実応答を保存する。
4. 撮影、Escape、本文編集と同一Web子の生存を対応付け、既存の180秒観測窓まで確認する。
5. artifact / process / group、複数タブ、比較表示後でもhoverを表示し、URL・場所・定義移動・Find all・明示Run操作を確認する。
6. 著者のcommandリンクは実行不能のままであること、通常GFM表の値と見出し関連付け、読み上げを確認する。
7. tbodyの行thを含む著者HTMLは未対応の対照として別試行にし、既知の回避範囲と混同しない。

異常が出たら以降の入力を止め、対象PID/start tick、signal、スタック、stderrを保全する。
修正前後は同じWebKit・入力・操作条件で比較する。
短い非再現だけで解消にせず、対象版・ホスト別の結果を既存受入記録へ残す。

## ローカル検証

実Monaco結合検査は修正前にrole欠落で失敗し、修正後は成功した。
表示前DOM、通常GFM表の値・リンク、未対応のtbody th、著者commandリンクの除去、生成actionのURLを検査する。
Chromiumでは元fixtureの実hover DOMの2列role、撮影、Escape、後続編集とpage errorなしを確認した。
Linux製品版の再試験とアクセシビリティ受入は未実施。
