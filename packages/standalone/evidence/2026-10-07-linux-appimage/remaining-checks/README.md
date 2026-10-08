# Fixed-source remaining checks — 2026-10-08 UTC

このページは指定 production AppImage の受入判定を保持する。
後続の[別 Inspector binary の診断結果](inspector-results/README.md)では、class / computed と captured presentation の不一致、実 model の CRLF 保持、現在 baseline の設定復元を確認したが、このページの399セルを変更していない。

所有者から dot の残件報告と4分割の証拠 ZIP を受領した。
製品 source は `8261f877d5cae8aa653a5310edfbd9e387acb116`、指定 AppImage / inner executable は前段と同じ指紋である。
新しい専用 checkout / workspace / VS Code profile で検査し、親は証拠を照合したが、Linux GUI を自ら再実行してはいない。

## 親の照合と累積判定

4つの ZIP の path / symlink / duplicate / CRC を確認し、各内側 part の size / SHA256 と結合 ZIP の size / SHA256 を manifest に照合した。
結合 ZIP は48,137,199 bytes、SHA256 `0bc1630f20e528ca374afb8c769f329037686cf276ed7f6b0749e3414e1738a4`。
再構成用の添付 script は実行せず、親が part bytes を結合した。
結合 ZIP の238 entries を検査し、最上位 SHA256SUMS の237ファイルを全照合した。
同梱の元検収 ZIP `25624580…` と前追補 ZIP `7fd50997…` も既知の size / SHA256 / CRC / entries / manifests 1,133件・68件に一致した。
前追補の全量 JSON が戻ったため、今回と前追補の133行 / 399 host cells を全値で比較できた。
変更は **I1283-019 / VS Code の1セルだけ**であり、それ以外398セルは history を含む全値が不変である。
原本・前追補の判定を上書きせず、[今回の累積 CSV](cumulative-matrix.csv)と[親の照合記録](parent-audit.json)を追加した。

| host | 成功 | 旧失敗履歴 | 未確認 | 対象外 |
| --- | ---: | ---: | ---: | ---: |
| native | 72 | 1 | 6 | 54 |
| VS Code | 107 | 1 | 1 | 24 |
| CLI | 23 | 1 | 0 | 109 |
| 全体 | 202 | 3 | 7 | 187 |

旧失敗3セルは F-001 のコメント位置厳格保持の履歴であり、現行仕様違反が確定した3製品不具合ではない。
仕様整理だけで成功へ変更せず、O-001 の semantic-invalid 候補の要求範囲も未決として保持する。
束全体と関連 issue の完了は認定しない。

## VS Code I1283-019

通常 setup / build 後、公式 Code 1.140.0 へ専用 user-data-dir / extensions-dir / extensionDevelopmentPath を渡した実 Extension Development Host を操作した。
README の F5 / preLaunchTask と同じ入口とは記載しない。
Code hash、拡張と editor の5 payload、standalone frontend 10件は前段の固定版と一致した。
所有者が許可した今回の workspace だけを UI で trust し、`alt` と `ctrlCmd` の両設定で PFDSL location / multi-cursor / 巡回 chord / context menu と組込 JS 定義移動 / Peek を対照した。
親は定義先、Peek pane、link 上の複数 cursor 等の画像を操作記録と照合し、成功へ更新した。
終了時は trust の entries が空、Restricted Mode へ復帰し、modifier 設定と settings.json は元の不存在へ戻っている。

## 未確認7セルと診断の境界

| 条件 | 今回の観測と残る証明 |
| --- | --- |
| I1284-014〜017 / native | 通常 AppRun の連続録画で移動・選択・意味を変えない編集は見えるが、対象の outline / drop-shadow は観測できなかった。最初の cue が見えないため、期限・旧 cue 解除・通常 render の非反復まで成功とは扱わない |
| I1284-021 / native | 共有 preview 31件 / 実 host adapter 1件の自動検査と、通常 GUI の既存隔離・再起動を別層に保持。実 Monaco / Tauri 上の同 process dispose 成功へ置換しない |
| I1284-022 / 両 GUI | OS setting command の成功後も fresh GTK の gtk-enable-animations は true、VS Code の実 PFDSL webview media query は false。reduce が実効になった試験ではない |

native 録画は目標60 fps、115.067秒 / encoded 6,899 frames。
4操作窓の2,325 frames の解析・原寸 crop・拡大で主図 cue を確証できず、親も対象 node の crop を確認した。
encoded frame cadence は実アプリの paint 完了時刻ではない。
意味を変えない編集による raster 差は、新 SVG の採用を直接証明するものではない。
この負の観測は保持するが、native WebView の class / computed style / media query が取れないため根本原因を確定していない。
production artifact の通常 Inspector が開かなかったことが、次の診断上の具体的な阻害点である。
[固定版の診断用 Inspector 手順](inspector-diagnosis.md)に、別 binary の来歴検査と読み取り対象をまとめた。
通常 Inspector を利用できる別 Linux binary の診断では、同じ source / lock / frontend と build 条件、変更箇所、外側・内側 hash を記録し、指定 artifact の合格へ混ぜない。
この production artifact 試行では native raw CRLF は399セル外の未確認だった。
後続の診断 binary では実 model の4状態を読み CRLF 保持を確認したが、元 binary の保存 bytes 成功へ転写しない。

## 設定復元の未完了

workspace trust / modifier / 今回作った xfconf property は元の状態へ復元した。
GNOME `enable-animations` は実効 true / 型 b に戻したが、変更前の明示 user override の有無を取得していない。
この試行の終了時は明示 override true があり、元も存在したか、元は不存在だったかを復元できた証拠はない。
これは許可された「存在・型・値まで元どおりにする」復元条件の未充足であり、設定復元完了とは報告しない。
元 DB snapshot / backup はなく、unknown baseline を推測して reset する操作もしない。
後続の診断では現在の状態を値・型・user override の有無を含めて記録し、その現在 baseline への厳密な復元が成功した。
後続開始時の GNOME override は不存在であり、前試行終了時との差がいつ・なぜ生じたかは断定しない。
この記録は次回の baseline であり、失われた前回の状態を復元したことにはならない。
XSettings の selection owner は存在するが、xfconf / gsettings と実効 GTK の不一致の原因は未確定。
正規の manager 設定経路を識別してから実効値を確認し、manager の差替えや property blob 直接書換えで検査を成立させない。

## 全量証拠の解決先

全量は結合 ZIP の `pfdsl-1411-8261-remaining-checks/` に保持する。
今回の証拠は `evidence/`、前段の全量 ZIP は `evidence/prior-archives/`、今回・前追補の JSON は `evidence/cumulative-checklist.json` と `evidence/prior-records/prior-cumulative-checklist.json`。
今回の CSV で `remaining-checks ZIP 0bc1630f…` は今回 ZIP の `evidence/` 起点、`addendum` は前追補 ZIP、`original ZIP 25624580…` は元 ZIP 内の path を表す。
起動・終了・実行先 artifact の14+304 manifest / fixtures 保持は dot の原ログを照合したもので、親が現地 AppImage を再実行・再照合したという主張ではない。
個人の path、profile、動画・スクリーンショットの全量を公開リポジトリへ転載しない。
