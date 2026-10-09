# Remaining lifecycle contract verification

本書の集計と実操作残件は、自動検査を追加した2026-10-07 UTC 時点の記録。
その後の[2026-10-08 UTC の追補](remaining-checks/README.md)で VS Code の対照が成功し、最新は202成功・旧失敗履歴3・未確認7。
本書の自動検査結果を通常 native GUI の成功へ置換してはいない。

## 対象と判定の層

既存5件の実操作検収を続けるため、I1284-021 の dispose / 旧結果隔離を共有 DOM と standalone host adapter で直接検査した。
製品基準は `8261f877d5cae8aa653a5310edfbd9e387acb116`。
今回、関連する製品 source の `preview.ts` / `preview-shell.ts` / `document-tab.ts` / `processing.ts` / `main.ts` は変更していない。
新しい検査は本 PR の追加テストであり、8261 の元 runner で実行したという主張はしない。

共有 preview の関連2ファイルは31/31成功、standalone host adapter の追加検査は1/1成功。
これらは自動検査の成功であり、累積399セルの通常 native GUI 判定を変更しない。
成功201・旧失敗履歴3・未確認8・対象外187を保持し、束の一括成功も認定しない。

## 入力・期待・実結果

| 境界 | 入力と操作 | 期待と実結果 |
| --- | --- | --- |
| 共有 hover の完了順序 | a の局所描画を保留し、p の局所描画を先に完了、最後に a を解放 | p の SVG 一件を保持し、古い a の結果を採用しない |
| 同 container 再利用 | cue と未完了 hover を持つ mount を dispose、同じ container に次の mount を作り、古い hover を完了 | 古い tooltip は非表示で SVG なし、次の主図と cue を保持 |
| cue timer | a の cue 開始後1000 msで pへ移動、さらに600 ms経過 | a の元の満了時刻を越えても pのcueを保持し、旧timerが新cueを消さない |
| standalone host lifecycle | 実 createDocumentTab の通常描画後、preset readを保留したrefreshとeditor再描画を予約し、同期disposeして次文書を作成、旧readを解放 | 実 snapshot の完了を観測後、旧model markerとeditor render回数が増えず、次文書DOMが不変 |

検査入口は [共有 preview actions](../../../editor/src/preview-actions.test.ts)、[既存 main render / listener lifecycle](../../../editor/src/preview.test.ts)、[standalone host lifecycle](../../test/document-tab-lifecycle.test.mjs)。
host検査は実 `createDocumentTab`、実 `processSnapshot`、実 `mountPreview` を実行する。
snapshot observer は実計算へ委譲し、完了を記録するだけで計算結果を作らない。
Monaco は制御用 seam、DOM は jsdomである。
未完了であることをdispose前に確認し、実snapshot完了まで待ってから不変を照合するため、固定待機時間の短さによる成功とは区別できる。

## 実操作の残件

原要求は mount / host の隔離契約を持つが、新しい個別 tab-close UI を要求していない。
通常native UIには個別tab-closeがないため、存在しない入口の実操作を要求することで確認を停止しない。
共有 DOM、host adapter、通常window再起動の既存証拠を分けて評価する。
実Monaco disposalやTauri/WebKit上の同process disposeを、この自動検査で実測したとは扱わない。

可視cue4条件、両GUIのOS reduced-motion、VS Codeの組込定義 / Peek対照には引き続き実環境の証拠が必要。
通常再描画の検査は、cueを一度確証してから、意味を変えない編集による実renderを確認する。
window resizeのみでは新SVGの採用を証明しない。
nativeのCRLFは保存UI追加の要求ではなく、実modelへの編集とUndo/Redo時の改行保持として検査する。
clipboard / AX のLF正規化やdisk原本hashから編集後modelのCRLFを推定しない。

前回のVS Code検査は、固定版payload/profile不在と既存trusted workspace未確認で停止した。
今回は新しい専用checkout/profileのsetup/buildを環境準備として行う手順を準備し、workspace trustとOS設定切替の許可が必要な操作は、その対象と復元手順を先に具体化する。
OS設定の読取command不在から実効reduced-motion値を推定しない。

独立reviewは原要求・最終テスト差分・実行ログを照合し、共有契約とhost adapterの自動検査として未解消の指摘なし。
実画面の未確認範囲を自動検査成功へ昇格しないことも確認した。
