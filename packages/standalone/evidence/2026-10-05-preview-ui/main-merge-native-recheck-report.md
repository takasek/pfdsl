# 統合後 native UI の短い blind 追試

2026-10-05 に対象 .app を通常起動し、指定した短い整合確認、長い文書の Cmd+Up 直後、別タブとの往復だけを観測した。
source、diff、design、過去 report は読んでいない。

## 観測結果

短い fixture は、可視 editor の title と raw/refine/final、AX の同じ source/3 node controls、主図とミニマップの title と3ノードが一致した。
証拠は 01-short の PNG と AX 本文に保存した。

長い fixture を同じ Welcome 文書へそのまま貼付し、Cmd+Down で末尾へ移動した。
02-large-end の PNG は41行目のカーソルを示す。
続く Cmd+Up と直後の AX/スクリーンショット採取の間には、タブ切替、Raise、前面化、editor の再クリックなどの修復操作を挟んでいない。
03-large-cmd-up の PNG は1行目、先頭文字の前のカーソル、title と source の先頭を示す。
AX は Large native pan exercise の source 先頭と71個の node controls を示し、主図は seed → step_01 → artifact_01 → step_02 を表示した。
図、AX、可視 source に別文書の identity との不一致は観測しなかった。

自分の起動時に作成された 日本語 タブへ切り替え、AX で同タブの選択、日本語のフロー、input/build/output を確認してから Welcome へ戻した。
04-large-return は長い source の先頭、同じ主図の先頭、細いミニマップを示す。
戻る前後の AX node controls は71個で、node ID の集合も一致した。

## 証明の範囲

長い source の AX 本文は viewport に応じた部分だけであり、タブ復帰後の全 source の byte 単位の読戻しは行っていない。
長い主図は viewport 内の先頭だけが可視で、全71ノードの identity は AX の controls による確認である。
長いミニマップは全体が極めて細い横列となり、各 label の個別読取はできなかった。
細い横列の形は観測前後で一致し、この尺度で異なる文書の図が残る兆候は見えなかった。
hover、pan、window-close、IME、folder-picker の受入全体はこの追試から認定しない。
終了操作は cleanup であり、window-close の受入検証ではない。

## 起動準備と所有範囲

起動前の process 調査は PFDSL 実行ファイルを示さず、親の PID 88331 も存在しなかった。
CUA getApp に対象 .app の絶対パスを渡した通常起動で PID 93529、PPID 1、開始時刻 2026-10-05 18:17:27 Asia/Tokyo の process が作成された。
初期画面は Welcome と 日本語 の2つの unsaved sample tabs で、日本語 が選択されていた。
初回 screenshot が背景状態だったため、準備段階だけで、観測した Window メニューの PFDSL 項目を1回使った。
File メニューには Close Window / Close All だけが見え、Escape と Cmd+N の試行では menu AX が残ったため、この試行は新規 document shortcut の挙動を判定していない。
menu が開いた状態の screenshot は unavailable となり、観測済みの Cancel secondary action で menu を閉じた。
これらの CUA 観測・menu 操作上の制限を製品バグと扱っていない。
親の追加指示により、自分の起動で作成された sample tabs を所有文書として扱い、Welcome を短い fixture、続いて長い fixture に置換した。
日本語 の本文は変えておらず、document を disk に保存していない。

CUA の Cmd+Q の後、AX 採取は App quit（error -10005）を返した。
その後の process 調査は PID 93529 の行を返さず、header のみ、exit code 1 で終了を確認した。
評価前後で実行ファイルと2つの fixture の SHA256 は一致した。

## 指紋と保存物

実行ファイル SHA256 は前後とも f6005842e1a7de061d531d09da67002b46d9c9eae89ebac1a19f04bca4451412。
short fixture SHA256 は前後とも a26577062a828e18dcde0b95e16b33b028635a60f2c631bd21e04629a1c3aeba。
large fixture SHA256 は前後とも df31c828012b30c62a503753d677497b0a3e4c0010b5d7192e49483389f06ef8。

保存先は <checkout>/packages/standalone/evidence/2026-10-05-preview-ui/ に正規化する。
01-short、02-large-end、03-large-cmd-up、04-large-return の4つの PNG と各 AX 本文、alternate-tab の AX 本文を main-merge-native-recheck- prefix で保存した。
main-merge-native-recheck-report.json に操作、判定、限界、所有 PID、指紋を記録した。
CUA screenshot の戻り bytes は JPEG だったため、自分が新規保存した4枚だけを実際の PNG に形式変換した。
縮尺変更、crop、描き直しはなく、元の JPEG と PNG を同じ decoder で BMP へ展開した raster bytes が一致した。
JSON は tab indentation、MD と AX 本文は末尾空行1つへ正規化した。
main-merge-native-recheck-manifest.json は manifest 自身を除く、この担当が保存した11ファイルの現在の bytes と SHA256 を記録する。
Git metadata、外部サービス、runtime source は変更していない。

