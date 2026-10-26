# Linux hover 障害の原記録回収（#1513、未解決）

2026-10-26 に所有者から `pfdsl-1513-recovery.zip` を受領した。
報告を作成した Dot が保存資料を回収したもので、回収時に再試験・設定変更はしていない。
この追補も資料の照合のみで、新しい hover 試行や製品コードの変更はない。
原因と再現を左右する条件は未特定で、GUI-27／GUI-44 の合格や #1513 の完了には更新しない。
回収後に実施した新規試行は、別の [調査要約・全量取得先](../2026-10-26-linux-hover-summary/README.md) に分ける。

## 資料の来歴と保存範囲

回収担当による詳細と確認限界は、受領したままの [LOCAL_RECOVERY_FINDINGS.txt](LOCAL_RECOVERY_FINDINGS.txt) に保存した。
そこに書かれた過去の操作時系列・環境説明と、今回直接照合したファイルの内容は区別する。
元資料は Dot クラウドの `/workspace/shared/pfdsl-evaluation/` の evidence・repro・artifact・report に保存されていた。
Session03・04・05 は同じ主操作担当の3セッションで、3人による独立再現ではない。
別担当の Session02 は hover の3件とは別である。

受領ZIPの `SHA256SUMS` が列挙する41ファイルを照合し、全件一致した。
本ディレクトリには回収説明、4起動ログ、3プロセス一覧、元fixture、2起動スクリプトの計11ファイルをバイト列を変えず収録した。
fixture と起動スクリプトは参照資料として `.txt` を付けた。
[source-files.json](source-files.json) はZIPのSHA-256、収録ファイルとZIP内パスの対応、サイズ、SHA-256を持つ。
ZIP全体、納品PDF、画像20枚の全量、配布物のビルド記録等は収録していない。
重要画像3点は下記リンクから直接確認できるPNGを選択収録した。
JPEGの復号RGB画素を変更せずPNGへ変換し、出典・原JPEG／PNGのhashを [image-sources.json](image-sources.json) に記録した。
回収説明の「AppDir全304件一致」「PDF全13頁の抽出テキストと埋込画像12点が一致」は回収担当の照合結果であり、今回それらの比較を再実行したものではない。

## 障害時の観測と証拠の強さ

| セッション | 操作時刻（UTC、回収担当の実施記録による） | 障害後の一次資料 | 確認範囲 |
| --- | --- | --- | --- |
| Session03 | 10月20日20:54:16 に rich hover、20:54:27 付近に Find all 操作と応答不能 | `native-session-02b.log`、`s03-native-processes.txt`、[広いps検索画像](s03_webkit_memory_check.png) | 本体1749、画像の広い検索にnetwork1774。WebKitWebProcessは表示されない。最初のpsはnetworkを検索対象に含めていない |
| Session04 | 21:01〜21:03 のlabel-onlyでFind allが2回成功した後、21:04〜21:06 に別文書のrich hover／Find all付近で応答不能 | `native-session-04.log`、`s04-native-processes.txt` | 本体2216、network2241。WebKitWebProcessは表示されない。ps本文に時刻なし |
| Session05 | 21:10:20 頃に単独ファイルの14行目でCtrl+K→Ctrl+I→撮影→Escape→AX取得 | `native-session-05.log`、`s05-native-processes.txt`、[ps画像](s05_ps.png) と [hover画面](s05_hover_escape_1.png) | 21:11:06 UTCに本体2469、network2494。WebKitWebProcessは表示されない。Find allクリックもhover表示中のAX取得もしていない |

今回、表の起動ログとpsテキスト、Session03の広い検索画像、Session05のps画像を直接確認した。
Session03の `native-session-03.log` は先行起動のPID1567で、障害対象PID1749のログではない。
起動ログはstdoutとstderrを合流したもの。
Gdk／Gtkのassertionはあるが、WebKitWebProcessの終了行・signal・backtraceはない。
ログの時刻は日付・timezoneを含まないため、表のUTC時刻へ推測で変換しない。

障害前のWebKitWebProcess PID、終了瞬間、exit status、core、kernel OOM記録はない。
psで見えないことは、特定PIDの終了をwaitpid等で捕捉した証拠とは異なる。
画像の `/proc` とcgroupメモリ情報の取得は `No such file or directory` で失敗しており、OOMを否定できない。
Find all、metadata表、GPU、特定WebKit版を原因と決めない。
3件とも自動操作と撮影を含み、人間の手操作のみ／撮影なしの対照ではない。
未保存編集が新規起動で戻らなかった確認は前2件だけで、Session05では消失試験をしていない。

## 環境とfixtureの比較

配布物はsource `b008ba8b43e5dc35f0c5d2b9d41f8ade2187a3c4`、Actions run `39477198995` のAppImage。
回収担当が報告したAppImage SHA-256 `ce92083a00e8a494976205c35d0b23647de8064cb7b3582e9d76c4033309d268` は、[10月23日の別環境試験](../2026-10-23-standalone-followups/README.md)と一致する。
元の実行は展開AppDirのAppRunであり、AppImageのFUSE起動ではない。
保存されたGTK hookは `GDK_BACKEND=x11` を指定し、当時のps画像にはX0ソケットとbubblewrapによる名前空間分離がある。
基盤の物理／VM／コンテナの別、CPU・エミュレーション、GPU・renderer、Xvfbの有無、実ロードされたWebKit版・絶対パスは不明。
ビルド記録の2.54.0／Debian u2や事前lddを、障害時の実ロード確認として扱わない。
元の稼働環境はリセット済みで、同じ配布物を使った新規試験も「原環境と同条件」とは保証できない。

元fixture [hover-rich.pfdsl.txt](hover-rich.pfdsl.txt) は377バイト、SHA-256 `1a3457175367b886fff0de6d304f490be891d7dfe43f15c7df726ab3184e5933`。
10月23日のコピー `fixture.pfdsl.txt` は378バイト、SHA-256 `e396c5a5e4fd42657cb066be09f18a8ab695afceb6a653019816f31b35a7264c`。
今回バイト比較し、差は末尾の改行1個だけと確認した。
元fixtureは14行目の末尾にLFが1個、10月23日のコピーは2個ある。
この差を原因とは断定せず、以前の2試行を厳密に同一入力の再試験とも呼ばない。

## 次の試験と修正判断

既存の #1513 の調査方針を維持し、元fixtureのバイト列を固定して採取を先行させる。
手順の正本は [GUI-27／GUI-44の受入計画](../../ACCEPTANCE-PLAN.md) とする。
撮影・自動操作・AX取得の有無と時点を分け、障害前からPID・実ロード・終了理由・描画環境を採取する。
履歴上のUI凍結とps不在を裏づける資料が増えた段階であり、原因や条件を特定する完了条件は残る。
rich hover一律無効化と描画API除去は、既存のIssue判断どおり、原因との対応が未確認のため保留する。
例えば描画を外してもWebKit側の別経路で終了するなら停止は残り、hoverを無効にすれば既存のナビゲーションも失う。
終了前後の証拠で対象経路と停止の対応が得られた時点で、修正・回避の採否を再検討する。
