# 次のLinux環境での終了情報の採取

元Dot環境はリセット済みなので、新しいホストでの試験として扱う。
使い捨て文書を使い、AppImageと [元fixture](../2026-10-26-linux-hover-recovery/hover-rich.pfdsl.txt) のhash、OS・CPU実行方式・表示／描画環境、時刻を記録する。
通常起動と観測library付き起動を別群にし、入力全文の一致、app・network・WebのPID／親子関係／起動識別、実ロードmapsを操作前に確認する。

`observer.c.txt` を専用ディレクトリへ `observer.c` としてコピーし、gcc・pkg-config・GLib/GObject開発用headerのある環境でビルドする。
道具や権限が不足すればその制限を報告し、権限追加やsandbox無効化で迂回しない。

```sh
gcc -shared -fPIC -Wall -Wextra -Werror -o observer.so observer.c $(pkg-config --cflags --libs gobject-2.0) -ldl
```

対象ELFの `g_object_new_with_properties` 動的参照を確認し、展開AppDirのAppRunへ接続する。

```sh
LD_PRELOAD=/absolute/test-directory/observer.so ./AppRun >app.stdout 2>app.stderr
```

loadedだけでなく実app PIDのconnectedを確認し、接続できなければ採取済みと扱わない。
別ABI・別生成経路や全故障の捕捉、観測者効果の不存在は保証しない。
較正する場合は別の使い捨て起動で、実行ファイル・親子・起動識別・PID名前空間を照合できたWeb子だけへ既知signalを送り、対象・送信時刻・API通知・本体／networkの状態を対応付ける。

元fixtureの14行目でCtrl+K→Ctrl+I→rich hoverの表示を確認→Escape→本文編集を行い、キー・撮影・外部AX取得の有無と時刻を残す。
観測窓を開始前に決め、Escape後は最低60秒を確保する。
これは元記録の約46秒を含める次回の手順であり、全遅延故障を排除できる時間の保証ではない。
Web消失・応答不能・AX timeout等があれば自動終了せず、生存processを保持してstderr・API通知・利用可能なmaps／core／kernel・cgroup情報を先に回収する。
採取後に試験終了を記録し、自分が起動した同一PID／起動識別・子孫だけを再照合して終了する。
同名processの一括終了と、異常時にも終了する旧driverは使わない。

API区分、実signal、OOMの根拠は分け、未取得を原因の否定に使わない。
故障注入は原障害の再現に数えず、非再現も修正済み・受入合格とは扱わない。
