# pfd-retro バインディング

A・B・C カタログ（監査観点の枠組み）: `docs/review-perspectives.md`（配布レンズ）。当リポの具体例・機構は `.pfdsl/review-perspectives.md`（instance）に蓄積する。

C 系の対象仕様: `docs/spec/spec.md`。実行手順: `/spec-stress-test`（リポローカル）。

設計決定記録: `docs/adr/`（ADR。一覧・改訂規約は `docs/adr/README.md`）。pfd-ops 定期監査トリガーの「設計決定記録」はこれを指す。

PFD 採用状況: roadmap（`.pfdsl/roadmap.pfdsl`）・workflow（`.pfdsl/workflow.pfdsl`）・runtime-pipeline（`.pfdsl/runtime-pipeline.pfdsl`）を採用。

出力宛先は `.pfdsl/workflow.md`「知見の振り分け（3経路）」セクションに従う。companion への書き分け（どの companion に書くか）は `.claude/skills/pfd-ops/references/architecture.md` の「companion への書き分けルール」表が一次情報。

## 監査の追加パターン（このリポで検出）

- **並行委譲の接合部**: 複数 subagent へ並行委譲した成果物同士の整合は、各委譲の受け入れ基準では検証されない。
  検収では成果物ペアの接合部（一方が定める規約 × 他方が生成する内容）を突合する。
  問いの形: 「委譲 A の出力は、委譲 B が実装した検査・規約の除外条件に収まっているか」。
  具体例: ADR の構文例引用（double-backtick span）と lint の inline-code 除外（当時 single-backtick のみ対応）の組で、構文例が実マーカーとして検出され、定義例と参照例が相互解決して lint が偶然 PASS した（#328。除外は #398 で backtick run 対応に修正済み）。
  検査 PASS は接合部の健全性を保証しない — 例示が実データ化していないかを実マッチ列挙（検出関数の直接実行）で確認する。

- **検査の自己参照 trap**: 「生成器を再実行し出力を既存生成物と diff する」形の drift 検査は、生成器の入力（ビルド成果物・キャッシュ等）自体が古い場合、古い入力から再生成した出力を古い生成物と比較するため一致してしまい、検査が自己無矛盾のまま PASS する。
  問いの形: 「この検査の『再生成』は、検査対象と同じ古い入力を使っていないか」。
  具体例: pre-commit の `check_drift`（regenerate-then-diff 方式）が dist ファイルの**存在**のみを前提条件にしており鮮度を見ていなかったため、worktree に残った stale な CLI dist から `gen-plugin` を再生成すると、stale dist 由来の誤った内容同士が一致して PASS した。CI は fresh checkout から都度ビルドするため唯一そこでだけ drift が検出された（#450）。`scripts/lib/dist-freshness.mjs` で dist の mtime を sibling `src/` の最新 mtime と比較し、存在しないときと同様に古いときも検査を skip する形に修正（#452）。
  対策: 「存在すれば検査可能」でなく「入力より新しければ検査可能」を前提条件にする。

- **フラグの意味範囲 trap**: フラグ名が示唆する狭い意味範囲（「今触っている検査の厳格版」）を信じて未検証のまま既存ゲートに組み込むと、そのフラグが実際に束ねる無関係な検査群が一斉に error 化し、意図しない大量破壊を CI で初めて知ることになる。
  問いの形: 「このフラグは名前が示す範囲だけを制御しているか、他の無関係な検査も同時に束ねていないか」。
  具体例: `--strict` は V011（feedback 到達性）のみを制御すると読める名前だが、実装は W002/W005 の warning→error 昇格も同時に束ねていた（#480 派生作業）。既存リポ資産（`docs/*.pfdsl`・`.pfdsl/*.pfdsl`）に対して素の `--strict` を先に検証せず CI 設定へ組み込もうとし、無関係な既存 W002/V011 所見 170 件超が一斉 FAIL するところだった。
  対策: 新しいフラグを既存ゲートに組み込む前に、そのフラグを対象コーパス全体に対して単体実行し、意図した検査以外の所見件数を数えてから採否を判断する。

## 配布物への finding 反映

配布 bundle（plugin 同梱の pfd-* スキル本文・reference）は上流リポ（takasek/pfdsl）の生成・同梱物であり、採用リポ側のコピーは編集対象にならない（ADR-0028。plugin cache 内のファイルはインストール更新で消える）。
finding を配布物に反映したい場合は、出力表の宛先（companion 等）に記録した上で、上流リポへの変更提案として起票する。
本スキル本文（SKILL.md）に取り込めるのは L1（固有名詞ゼロの汎用プロトコル — 層定義は `pfd-ops/references/architecture.md`）に一般化できる記述のみ: リポ固有の固有名詞・issue 番号・ファイルパス・ADR 番号は禁止、配布 bundle 内のスキル・reference への相互参照は可。
一般化できない具体例は companion に残す。
このリポは pfd-retro スキルの上流であるため、この変更提案をその場での編集として実施してよい（採用リポにこの経路は無い）。
