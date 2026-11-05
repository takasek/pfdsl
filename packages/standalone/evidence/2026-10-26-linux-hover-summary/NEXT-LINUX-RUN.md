# 次のLinux環境での終了情報の採取

元Dot環境はリセット済み。次に自然停止を観測できるLinuxホストで、試行ごとに以下の記録を取る。
[原記録](../2026-10-26-linux-hover-recovery/README.md)と[これまでの追試・較正](README.md)を比較に使う。

## 起動前に試行を識別する

Linuxデスクトップ上のBashで、この手順書のあるディレクトリを起点にする。AppImageとそこから展開したAppDirの絶対パス、および再起動や試験VMの破棄後も読める非公開の保管ディレクトリ（作成済み）の絶対パスを指定する。
通常起動と観測library付き起動は別の試行として、毎回この節から新しい対話Bashで始める。採取中は欠測が起きても後続の記録を取るため、`set -e` は使わない。

```bash
read -r -p 'AppImage path: ' image
read -r -p 'Extracted AppDir path: ' appdir
umask 077
read -r -p 'Persistent evidence directory: ' archive
run=$(mktemp -d -- "${archive:?}/pfdsl-1513.XXXXXXXX") || exit 1
printf 'Evidence directory: %s\n' "$run"
mark() { printf '%s %s\n' "$(date -u +%FT%T.%NZ)" "$*" >> "$run/timeline"; }
since=$(date -u '+%F %T UTC')
mark "start"
cp ../2026-10-26-linux-hover-recovery/hover-rich.pfdsl.txt "$run/hover-rich.pfdsl"
sha256sum -- "$image" "$run/hover-rich.pfdsl" | tee "$run/inputs.sha256"
{
  uname -srm
  cat /etc/os-release
  printf 'session=%s display=%s wayland=%s\n' "$XDG_SESSION_TYPE" "$DISPLAY" "$WAYLAND_DISPLAY"
  command -v systemd-detect-virt && systemd-detect-virt
  command -v glxinfo && glxinfo -B
  printf 'core limit: '; ulimit -c
  cat /proc/sys/kernel/core_pattern
} > "$run/host" 2>&1
```

元配布物は source `b008ba8b`、AppImage SHA-256 `ce92083a00e8a494976205c35d0b23647de8064cb7b3582e9d76c4033309d268`、元fixtureは377バイトでSHA-256 `1a3457175367b886fff0de6d304f490be891d7dfe43f15c7df726ab3184e5933`。異なる入力は別条件として記録する。
実ホスト／VM／エミュレーション、Xvfbの有無、GPU・renderer、起動方法と実際の表示backendを分かる範囲で `host` に追記する。未確認と取得失敗は理由を残す。

## 起動して対象プロセスを特定する

通常群は下の1行だけで起動する。以降は同じシェルを使う。

```bash
"$appdir/AppRun" > "$run/app.stdout" 2> "$run/app.stderr" & launcher=$!
```

観測群では対象ELFの `g_object_new_with_properties` 動的参照を確認し、代わりに次を使う。
gcc・pkg-config・GLib/GObject開発用headerが必要。道具や権限が不足すればその制限を記録し、権限追加やsandbox無効化で迂回しない。

```bash
cp observer.c.txt "$run/observer.c"
gcc -shared -fPIC -Wall -Wextra -Werror -o "$run/observer.so" "$run/observer.c" $(pkg-config --cflags --libs gobject-2.0) -ldl &&
  { LD_PRELOAD="$run/observer.so" "$appdir/AppRun" > "$run/app.stdout" 2> "$run/app.stderr" & launcher=$!; }
```

起動したアプリの1タブだけで `$run/hover-rich.pfdsl` を開き、本文の全行と照合方法を記録する。
`pstree -p "$launcher"` または `ps -eo pid,ppid,comm --forest` で今回起動した本体とそのnetwork子・Web子を選ぶ。ラッパーや同名の別セッションを区別し、対象を特定してから進む。

```bash
read -r -p 'PID of app, network and Web (space-separated): ' app net web
snapshot() {
  local dest="$run/$1" p
  mkdir "$dest" || return
  for p in "$app" "$net" "$web"; do
    {
      date -u +%FT%T.%NZ
      readlink "/proc/$p/exe"
      cat "/proc/$p/stat" "/proc/$p/cgroup"
      grep -E '^(Name|State|PPid|NSpid):' "/proc/$p/status"
      readlink "/proc/$p/ns/pid"
    } > "$dest/$p.identity" 2>&1
    cat "/proc/$p/maps" > "$dest/$p.maps" 2> "$dest/$p.maps.err"
  done
}
snapshot before
```

操作前にexe・親子・PID名前空間と `stat` の起動tick（第22欄）を照合する。Web子のmapsにあるWebKitGTKの実パスを選び、読めるうちに `sha256sum "/proc/$web/root$lib"` の結果を `$run/webkit.sha256` に保存する（`lib` はmapsの絶対パス）。そのファイルの版を示す配布物の記録等を添え、ホストのインストール版とは分ける。
観測群では `app.stderr` の `pfdsl_observer=connected` に相当するJSON行のpidが実appと一致することを確認し、viewも控える。loadedのみなら終了通知は未接続として記録する。

Web子の `/proc/$web/cgroup` の `0::` 行とcgroup2のmount（`findmnt -t cgroup2`）から、このシェルで読める同じcgroupのディレクトリを特定する。
その `memory.events` を操作前に `$run/memory.before` にコピーし、パスを控える。v1、別名前空間、権限不足等で対応を確認できなければその旨を残す。

## 操作と消失時刻を対応付ける

次のサンプル採取を操作前に開始する。元の3 PIDの存在・state・起動tickを約1秒ごとに記録する。
`ps` の表示間隔から分かるのは最後に存在した時刻と最初に不在だった時刻の間までで、正確な終了時刻はAPI通知等と区別する。

```bash
while :; do
  date -u +%FT%T.%NZ
  for p in "$app" "$net" "$web"; do cat "/proc/$p/stat" || :; done
  sleep 1
done > "$run/process.timeline" 2>&1 & sampler=$!
```

元Session05の操作順は14行目の `package_manifest` でCtrl+K → Ctrl+I → rich hoverの表示確認 → hoverを撮影 → Escape → 外部AX取得である。画面を撮る試行は画像を `$run` に保存する。応答が続けば本文を編集し、結果を記録する。
`mark "hover shown"`、`mark "Escape"` などでキー・表示・撮影・編集の結果と外部AX取得の時点をUTCで残す。手動／自動、撮影やAX取得を省いた場合も明記する。記録操作がフォーカスを変える場合は別の担当者や操作ログの時刻を利用する。
Escape後は最低60秒観測し、実際の観測終了時刻を残す。これは元記録の約46秒を含める窓である。

## 異常が出たら、ウィンドウを閉じる前に回収する

Web消失・応答不能・AX timeoutを観測した時点で操作を止め、本体とnetworkを生かしたまま次を実行する。非再現でも観測窓の終わりに同じ前後比較を残す。

```bash
mark "collecting end-of-observation evidence"
snapshot after
until_time=$(date -u '+%F %T UTC' -d '+1 second')
journalctl -k -b --since "$since" --until "$until_time" --utc --no-pager > "$run/kernel.log" 2>&1
coredumpctl --since "$since" --until "$until_time" --no-pager info "$web" > "$run/web.core-info" 2>&1
```

同じcgroupの `memory.events` を `$run/memory.after` にコピーする。`oom`／`oom_kill` の増分はcgroup単位なので、時刻・対象PIDのkernel記録と照合する。
core情報は時刻・exe・PID名前空間を照合し、一致したsignal・stack・保全先を控える。coreの登録が遅れた場合は検索の終端時刻を延ばす。権限不足・保存無効・該当記録なしを区別する。
`app.stderr` の同じapp PID・viewの `web-process-terminated` を探し、API区分と実signal／Web子のwait-statusは別々に記録する。起動シェルが待てる本体の終了値をWeb子に転記しない。
`before` と `after` で起動tickも比較し、Web子が入れ替わった場合は新PID・親子関係も採る。再起動やCtrl+Cの前に採取を終え、`mark "collection complete; teardown"` で試験終了と後片付けを区切る。
`kill "$sampler"; wait "$sampler"` でこのシェルの採取ループを止め、アプリは通常終了する。個別終了が必要なら今回起動したPID・起動識別を再照合する。同名processの一括終了と異常時にも終了する旧driverは使わない。

試行ごとに対象版・ホスト・通常／観測群、操作条件、症状と時刻、取得できたファイル、未取得項目と理由をまとめ、GUI-27／GUI-44の版別記録から辿れるようにする。共有前にログ中の個人パス等を確認し、core本体はローカルに保全する。
別起動で較正する場合だけ、実行ファイル・親子・起動識別・PID名前空間を照合できたWeb子へ既知signalを送り、対象・送信時刻・API通知・本体／networkの状態を対応付ける。故障注入は自然再現と分け、非再現も修正済み・受入合格とは扱わない。
