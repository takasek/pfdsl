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

- **並行リファクタの死角**: 同じ主題（例: edge集合からのグルーピング）を扱う複数の並行 issue/PR が、互いのスコープ外に同型の重複コードを残すことがある。各 issue は自分のスコープ内でしか重複を見ないため、相手側のリファクタが通った後も気付かれない。
  問いの形: 「このリファクタが対象にしなかった箇所に、同種のループ/パターンがもう一方の並行リファクタの後にも残っていないか」。
  検出の機会: 2つの並行ブランチを rebase/merge で合流させるとき。コンフリクトした箇所だけでなく、双方の diff で「同じ処理を別名の変数で書いている箇所」を横断 grep する。
  具体例: `computeOpenInputs`（multifile.ts）に externalInputs 計算を委譲するリファクタと、edges グルーピングを共有ヘルパーに統合するリファクタが並行して走り、audit.ts 内の produced/consumed Set 構築（前者の対象外）が後者のヘルパーからも漏れて残った（takasek/pfdsl #460）。

- **検査の自己参照 trap**: 「生成器を再実行し出力を既存生成物と diff する」形の drift 検査は、生成器の入力（ビルド成果物・キャッシュ等）自体が古い場合、古い入力から再生成した出力を古い生成物と比較するため一致してしまい、検査が自己無矛盾のまま PASS する。
  問いの形: 「この検査の『再生成』は、検査対象と同じ古い入力を使っていないか」。
  具体例: pre-commit の `check_drift`（regenerate-then-diff 方式）が dist ファイルの**存在**のみを前提条件にしており鮮度を見ていなかったため、worktree に残った stale な CLI dist から `gen-plugin` を再生成すると、stale dist 由来の誤った内容同士が一致して PASS した。CI は fresh checkout から都度ビルドするため唯一そこでだけ drift が検出された（#450）。`scripts/lib/dist-freshness.mjs` で dist の mtime を sibling `src/` の最新 mtime と比較し、存在しないときと同様に古いときも検査を skip する形に修正（#452）。
  対策: 「存在すれば検査可能」でなく「入力より新しければ検査可能」を前提条件にする。

- **フラグの意味範囲 trap**: フラグ名が示唆する狭い意味範囲（「今触っている検査の厳格版」）を信じて未検証のまま既存ゲートに組み込むと、そのフラグが実際に束ねる無関係な検査群が一斉に error 化し、意図しない大量破壊を CI で初めて知ることになる。
  問いの形: 「このフラグは名前が示す範囲だけを制御しているか、他の無関係な検査も同時に束ねていないか」。
  具体例: `--strict` は V011（feedback 到達性）のみを制御すると読める名前だが、実装は W002/W005 の warning→error 昇格も同時に束ねていた（#480 派生作業）。既存リポ資産（`docs/*.pfdsl`・`.pfdsl/*.pfdsl`）に対して素の `--strict` を先に検証せず CI 設定へ組み込もうとし、無関係な既存 W002/V011 所見 170 件超が一斉 FAIL するところだった。
  対策: 新しいフラグを既存ゲートに組み込む前に、そのフラグを対象コーパス全体に対して単体実行し、意図した検査以外の所見件数を数えてから採否を判断する。

- **実行環境の暗黙前提 trap**: リポの運用スクリプトが特定の CLI ツール（`gh` 等）の存在を暗黙の前提にしていると、そのツールを持たない実行環境（Claude Code Remote 等、GitHub 操作が MCP server 経由に限定されるセッション）では preflight/gate-check の一部〜全部がエラーで止まる。
  問いの形: 「このスクリプトが前提にしている外部 CLI は、全ての起動元セッション種別で利用可能か」。
  具体例: `scripts/cycle-status.mjs` / `scripts/gate-check.mjs`（内部の `audit-issues-flow.mjs`）が `gh` に `execSync`/`execFileSync` で依存しており、`gh` 不在の Claude Code Remote セッションで `audit-issues-flow.mjs` が `spawnSync gh ENOENT` でクラッシュし、gate-check の残り項目の出力ごと失われた（#482 セッション、#489 で追跡）。
  対策: 該当ステップは GitHub MCP のツール呼び出しで個別に代替できる（`.pfdsl/roadmap.md`「自動生成 PR」節に代替手順を記録）。恒久対策（`gh` 依存の解消・try/catch 化）は #489。

- **companion 追記手順の見落とし**: SKILL.md 本文の自己点検セクションが1つのスクリプトしか名指ししていないと、同じ契機で実行すべき binding 側の追加ステップ（companion にのみ書かれている）を読み飛ばしたまま作業を始めてしまう。
  問いの形: 「このセルフチェック手順は、binding に追記された継続ステップの存在を保証しているか、それとも読み手が binding 全文を読む前提に依存しているか」。
  具体例: `.pfdsl/bindings/pfd-ops.md` に「配置ファイルの鮮度セルフチェックに続けて `check-scaffold-sync.mjs` も実行する」という追加ステップがあったが、SKILL.md 側の該当セクションはそれへの参照を持たず、セッション開始時に見落とした（retro で気付き実行、drift は無し）。
  対策: SKILL.md のセルフチェックセクションに「同じタイミングで binding の追加ステップも確認する」という一般化した誘導文を追記した（本コミット）。

- **単一メタ項目が N 個のサブ項目を隠す trap**: 終端ゲートの MANUAL チェックリストが「companion（roadmap.md 等）が定義するリポ固有の追加ゲート項目を確認した」という1行のメタ項目であるため、companion 側に列挙された十数個の個別サブ項目（例: PR 本文の `Closes` キーワード）を実際に1つずつ確認しなくても、メタ項目1行にチェックを入れて先へ進めてしまう。特に PR 作成はサイクル序盤の companion 読了から時間が経った終盤の作業であり、序盤で読んだ内容の再確認が漏れやすい。
  問いの形: 「このメタ項目にチェックを入れた瞬間、companion の個別サブ項目を実際に1つずつ再読したか、それとも『前に読んだから大丈夫』で済ませていないか」。
  具体例: PR #497（#476）作成時に `.pfdsl/roadmap.md` の「PR 本文の `Closes` キーワード確認」項目を実行し忘れ、`Closes #476` を欠いたまま PR を作成した（pfd-retro の C 層監査で気付き、PR 本文を更新して修正）。
  対策: PR 作成・issue クローズ等、companion のサブ項目が集中するタイミングでは、メタ項目にチェックする前に companion の該当セクションを Read し直し、列挙された個別項目を上から順に照合する。

- **issue クローズ漏れ trap（別 PR 経由の偶発解決）**: あるレビュー対応 PR が別 issue のスコープを偶発的に解決すると、その別 issue 自体は誰も見ていないため open のまま残り続ける。着手前に issue 本文の再現手順を現行コードに当てて「まだ再現するか」を確認しないと、既に解決済みの issue に無駄な実装差分を積みかねない。
  問いの形: 「この issue が指す症状は、現行コードでまだ再現するか（既存の別 PR が偶発的に解決していないか）」。
  具体例: #494（def-insertion.ts のフルドキュメント置換問題）は、#491 のレビュー対応コミット 31b16c1（fix(core,vscode-extension): use a minimal insert edit ...）で既に解決済みだったが、issue 自体は open のまま1日残った。#490/#493/#498 のバッチ処理着手前に現行コードを確認したことで発覚し、実装差分なしでクローズできた。
  対策: 着手前の issue 本文再読（work-cycle 手順1）に「本文の再現手順・コード引用を現行の該当ファイルと突合する」を含める。

- **部分実装 fallback trap**: 外部 CLI 不在に備えた互換 fallback（REST 直叩き等）が、エラーを出さず「成功したように見えて」本来の実装より劣化・切り詰められた結果を返すと、それを消費する検査は健全に PASS/実行したように見えて判定が信頼できない。
  「実行環境の暗黙前提 trap」（crash on absence — fallback 不在でクラッシュし可視）とは逆に、fallback 在りゆえに沈黙で誤った結果が通る（不可視でより危険）。
  問いの形: 「この fallback は本来の実装と同じ完全性を返すか、成功したように見えて結果が劣化・切り詰められていないか」。
  具体例: `gh` 不在環境の `audit-issues-flow` REST fallback（`fetchAllIssues`）が、短いページで早期 break しページングし切れず新しい 175 件（最小 issue #43）しか返さなかったため、実在する古い open issue #3 / #12 に false な `unknown_issue` finding を出した（#543）。`gh` 実体のある CI では `--limit 500` が全件返し再現しないため、fallback がまさに使われる Remote/web 環境でのみ audit が不正確になる。
  対策: fallback 経路の網羅性を実データで確認する（返却件数・最小/最大キーの範囲を本来値と突合）。fallback が返す集合を「完全」と仮定した下流判定は、集合の完全性が別途保証されない限り信用しない。

## 配布物への finding 反映

配布 bundle（plugin 同梱の pfd-* スキル本文・reference）は上流リポ（takasek/pfdsl）の生成・同梱物であり、採用リポ側のコピーは編集対象にならない（ADR-0028。plugin cache 内のファイルはインストール更新で消える）。
finding を配布物に反映したい場合は、出力表の宛先（companion 等）に記録した上で、上流リポへの変更提案として起票する。
本スキル本文（SKILL.md）に取り込めるのは L1（固有名詞ゼロの汎用プロトコル — 層定義は `pfd-ops/references/architecture.md`）に一般化できる記述のみ: リポ固有の固有名詞・issue 番号・ファイルパス・ADR 番号は禁止、配布 bundle 内のスキル・reference への相互参照は可。
一般化できない具体例は companion に残す。
このリポは pfd-retro スキルの上流であるため、この変更提案をその場での編集として実施してよい（採用リポにこの経路は無い）。
