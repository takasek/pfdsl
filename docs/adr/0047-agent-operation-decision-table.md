# ADR-0047: agent 操作を有限の判定表で決める

## 目的

Status: Accepted（実装契約。live の受入は未完了）。

通常の agent（Claude の親・subagent、Codex の親・子）が、操作先と責務を取り違えることを防ぐ。
敵対者、shell と Git の全構文の網羅、script・alias・eval の内部は対象外とする。
通常の作業動線を止めないことを、保護と同じ重さで守る。

単一入口は scripts/agent-operation-guard.mjs とし、Bash、GitHub MCP、Edit・Write・apply_patch を受ける。
分類器と判定表は純関数とし、Git・fs・native 所有証拠の観測は入口側に置く。
ADR-0044 の「変更系 Git の target・default branch・sibling 判定を削除する」方針と、検査回避・委譲先の外向き操作・作用先・merge の hook 責務を、この表と性質へ置き換える。
Git の pre-commit と共有 shim、内容を検査する guard の責務は維持する。
ADR-0046 の native 所有証拠の照合条件は維持し、補正を Git だけに限定する条項、所有未確認時の Claude ask、復旧系 ask、file policy を別責務とする条項を置き換える。
同じ native 所有証拠を Git と file の対象判定へ使い、other-live・other-unowned の変更は全主体 deny とする。
PR #1413 の旧 ADR-0047 が採った「Git が起こす共有作用の全防止」は継承しない。

## 入力の軸

| 軸 | 値 |
|---|---|
| 主体 | claude-parent、claude-subagent、codex-parent、codex-child |
| policy の健全性 | healthy、failed（policy・parser のロード失敗、timeout、不正な応答） |
| 対象 | own、primary、other-live、other-unowned、foreign、scratch、unresolved |
| 操作クラス | 下表 |
| 操作の種別 | file 書込み（Edit・Write・絶対パスの apply_patch）、Git、gh・MCP |
| 設定のスコープ | repository、外部（`--global`・`--system`・`--file`） |

操作の種別と設定のスコープは、主体・対象による上書きが参照する有限の判定材料である。

対象は次の順に判定し、最初に当たったものを採る。

1. foreign: Git common dir が異なる repository。scratch: repository の外。
2. primary: 同じ repository の main worktree。branch 名を問わず、起動 root が primary でも primary とする。
3. other-live: 別の生存 session の native 所有証拠がある linked worktree。
4. own: session の起動 root である linked worktree、または native の所有証拠（Claude の lock、Codex の ownerThreadId）が自分と一致する linked worktree。
5. other-unowned: 同じ repository の linked worktree で、上のどれにも当たらないもの。
6. unresolved: 実行先を確定できないもの。

所有と実行先は分けて扱う。
所有・割当の判定には session の起点と native の所有証拠を使い、実行先は起点で代用せず各操作の明示的な対象から決める。
通常の Git 操作は `-C` または harness の作業ディレクトリ、`git worktree remove` は削除対象、file 書込みは書込み先の物理パスを実行先とする。

性質7の「書込み先」は、次の有限の実行先表に列挙した形だけを指す。

| 入力 | 実行先 |
| --- | --- |
| literal な git -C | 指定した path |
| 先頭の literal な cd の AND-list、harness の cwd | 解決した作業ディレクトリ |
| worktree remove | 削除対象 |
| Edit・Write・apply_patch | 書込み先の物理パス |
| init・clone | 作成先の位置引数 |
| archive・format-patch の -o | 出力先 |
| bundle create | file の位置引数 |
| worktree add | 作成先。作成元の B・D と合成し、own 以外の既存 linked worktree の内部への入れ子だけを拒否する。primary 配下の .claude/worktrees と scratch への作成を許可する |

この表にない option の出力先、shell のリダイレクト、Git 以外のプログラムの書込み先は保証外とする。
列挙を追加するかは所有者が決める。
worktree add の開始点 main は -b topic や --detach と併用できるが、既存の default branch を checkout する形は D とする。

実行先の解決: 命令の先頭から `&&` でつながる literal な `cd <path> &&`（絶対・相対）と、literal な `git -C` を解決する。
subshell 内の `cd`、`;` や `||` の後の `cd`、条件分岐の中の `cd`、動的な値を含む `cd`・`-C` は、実行先を一意に決められないので unresolved とする。
これは変更系操作の実行先の判定に使う。R は全対象で allow のため、読取の実行先を解決できなくても R のままとする。
shell の状態機械は持たない。
同じ命令文字列に pushd・popd、または Git の実行先を変える環境変数と CDPATH の literal な名前への代入・export・readonly・declare・typeset・read・printf -v があれば、変更系 Git の実行先を unresolved にする。
対象の変数は GIT_DIR、GIT_WORK_TREE、GIT_INDEX_FILE、GIT_COMMON_DIR、GIT_OBJECT_DIRECTORY、GIT_ALTERNATE_OBJECT_DIRECTORIES、GIT_NAMESPACE とする。
値や前後関係を解釈せず、hook process の環境にある Git target の上書きも unresolved とする。
bash・sh・zsh の -c と eval の literal な文字列は、内側を同じ規則で分類し、解析できなければ unresolved にする。
source・dot の file の中身は保証外のままとする。

agent が手動で追加した worktree は other-unowned であり、変更を伴う作業には native の worktree 作成を使う。
軸の外の入力や空のクラス集合は例外とし、表を拡張して受け入れない。

## 判定表

| クラス | 例 | own | primary | other-live / other-unowned | foreign・scratch |
|---|---|---|---|---|---|
| R 読取 | `git status/log/diff`、`gh pr view`、Read | allow | allow | allow | allow |
| W 作業ツリーの変更 | Edit/Write、`git add/commit/restore/reset`、own branch の rebase・merge、`git stash`（push・pop・apply・drop）、`git worktree remove`（対象の worktree を実行先とみなす） | allow | deny | deny | allow |
| B 自由な branch の操作 | default 以外で、他の worktree が checkout していない branch の作成・切替・改名・削除、`fetch … pull/N/head:pr-N`、新しい path への `git worktree add` | allow | deny | deny | allow |
| D default branch の変更 | default 上の commit、`branch -f main`、`update-ref refs/heads/main`、`fetch origin main:main`、linked worktree での `git switch main` | deny | deny | deny | allow |
| S 共有状態の全消去 | `git stash clear` | deny | deny | deny | allow |
| C repository 設定の書込み | `git config <key> <value>`、`git remote add/set-url/set-head` | Claude 親 ask、それ以外 deny | deny | deny | allow |
| X 検査回避 | `--no-verify`、`-c core.hooksPath=…`、`git config --global/--system/--file` の書込み | deny | deny | deny | `--global` 等の書込みのみ deny |
| O 外向き書込み | `git push`、`gh pr create/edit/comment`、変更系 `gh api`、MCP 書込み | allow | deny | deny | allow |
| P PR の統合 | `gh pr merge`、auto-merge、REST merge・merge-async、GraphQL merge・enqueue | deny | deny | deny | deny |
| U 未解決 | 動的な実行名、動的な `cd`・`-C`、Codex の `-C` 無し変更系 Git | 書換え案内付き deny | 同左 | 同左 | 同左 |

対象の列は checkout を実行先に持つ操作（Git、file）に適用する。`gh` と MCP の操作は checkout を持たないので、own の列で判定する。

クラスの決め方と合成:

- 実行されない形（`--help`、`--version`、`gh help`）は、実行される操作より先に R と判定する。
- 一つの操作が複数のクラスに当たるとき（`git config core.hooksPath …` は C と X、`git push --no-verify` は O と X、`gh pr merge` は O と P）は、禁止のクラス（P、X、D、S）を一般のクラスより優先する。表の行の並び順には意味を持たせない。
- 複数の命令は、各命令の判定を deny ＞ ask ＞ allow で合成する。

主体による上書き:

- codex-child は R と、own への file 書込み（Edit・Write・絶対パスの apply_patch。`.git` 管理ファイルを除く）だけを allow とする。Git と gh・MCP の W・B・O は「親へ返す」案内付き deny。
- codex-child の個人の codex-git-routine.mjs の呼出しは、検証 verb（build・test・typecheck・node-test・node-script）以外を W と同じく親へ返す。routine をリポの依存にせず、親の呼出しはこの表で判定しない。
- claude-subagent は親と同じ表に従う。ただし ask のセルは「親へ返す」案内付き deny とする。background の subagent は ask に人間が応答するまで停止するためである。
- claude-subagent の O（外向き書込み）は「親へ返す」案内付き deny とする。レビューと公開は呼び出し元が持つという既存の責務境界（#932、main の agent-operation-guard）を維持する。例外は、PR 作成までを役割に持つ agent 種別（現行は `issue-worker`）だけで、`agent_type` の許可表で判定する。
- Codex は ask を表現できないので、ask のセルは「人間の terminal で実行する」案内付き deny になる。

健全性による上書き:

- failed のとき、R を含む全クラスを修復案内付き deny とする。
- 故障を2種類に分ける。parser の欠落は agent が回復できるので、回復コマンドの完全一致だけを allow とする。policy・helper のロード失敗や実行時例外は agent が直せないので、人間へ返す案内を出す。
- 回復コマンドは、修復対象の root を固定した形にする。hook を実行している checkout（hook script の位置から決まる root）へ導入し、`process.cwd()` や Codex の `workdir` に依存させない。
- policy 自身がロードできない状態ではこの例外を評価できないので、例外の判定は bootstrap（supervisor の手前）に置き、文字列の完全一致で行う。
- 前提: bootstrap 自体が動くこと、parser の導入元（固定版の公式 release）に到達できること。どちらかが欠ければ人間が回復する。

例外として、force 無しの worktree remove は other-unowned でも allow とする。
試行用 worktree の片付けを止めず、未 commit の変更の拒否は Git 自身に任せる。
force 付きは own 以外で deny、other-live は force の有無を問わず deny とする。
force を止める案内は、other-unowned の試行なら force 無しで片付けられることを示す。
stash の push・pop・apply・drop は W、clear だけを S とする。
試行用の merge-tree --write-tree は own から行う W とし、checkout と ref を変えずに object を書く。
merge-tree の2引数の既定モードも W、明示した --trivial-merge の読取モードだけを R とする。
Git metadata の書込みを子へ渡さず、Codex の子は親へ返す。
検査回避の短い形 -n は commit・am だけとし、push の -n は dry-run とする。--config-env は core.hooksPath を指定する形を扱う。
純粋な読取は R、pull は W とし、default branch へ書く refspec や default 上での変更は D とする。
tag の作成は B、list は R。init・clone・archive・format-patch・bundle create の実行先は、上の有限の実行先表に従う。
worktree prune・bisect・submodule update は W。reflog は verb 無し・show・list・exists を R、それ以外を U とする。
symbolic-ref は読取を R、default branch を指す書込みを D、それ以外の書込みを U とする。
R だけの命令の判定では、Git roots・worktree 一覧・branch・所有証拠の観測を省く。混在した命令の変更側の観測と、policy・parser の健全性による上書きは維持する。

次の guard は、操作先と責務ではなく内容を検査するもので、この表の外に置く: closes-create（PR 本文のクローズ参照）、roadmap-publish、generated-root-instructions（生成物の正本案内）、command-usage（advisory）、verification-tree（検証を走らせる tree）。
shell の解析失敗による deny は1つの入口だけが出す。表の外の guard は、解析失敗では止めず、自分の検査対象が解析できた場合だけ判定する。

## 性質

1. 正常コーパスの各ケースは allow になる。
2. 取り違えコーパスの各ケースは、期待どおり deny または ask になる。deny と ask を区別して照合する。

コーパスの各ケースは、コマンドだけでなく、主体、健全性、session の起点、実行先、必要な所有証拠と branch の状態、期待値を持つ。
複数の操作からなる短い遷移（worktree を作ってそこで作業する、故障から回復する）は、一つのケースとして扱う。
3. Codex の主体には ask を出さない。
4. すべての deny に回復先がある。回復先は、同じ agent の書換え、親への返却、人間の terminal のいずれか。
5. 判定は単調である。未解決や別の命令を付け足しても、確定した deny は deny のまま弱まらない。
6. 所有者の一致で、子を親の権限へ昇格させない。codex-child の判定は、同じ対象・クラスの codex-parent より緩くならない。
7. 所有・割当の判定には session の起点と所有証拠を使うが、実行先は起点で代用しない。実行先は上の有限の実行先表に列挙した対象から決め、「書込み先」もその列挙を指す。
8. 回復の遷移が成立する。parser の欠落について「failed → 回復コマンドが allow → 再検査で healthy → 正常コーパスが allow」を検査する。回復コマンドが allow になるだけでは成功としない。

受入例と実 transcript の入力は scripts/lib/agent-operation-corpus.mjs、旧保護の採用ケースは scripts/lib/agent-operation-legacy-corpus.mjs に置く。
表の性質3〜6は有限軸の直積全セル、性質8は欠落から修復・healthy・通常 allow までの遷移で検査する。

## 観測契約

| 項目 | Claude | Codex |
|---|---|---|
| session の起点 | `CLAUDE_PROJECT_DIR`（起動時のまま） | hook の `cwd`（会話を始めたディレクトリ） |
| 実行先 | hook の `cwd` は worktree への進入と cd に追従する。命令中の literal な `cd <絶対パス>` と `git -C` も解決する | `exec_command.workdir` は hook に届かない。変更系 Git は `git -C <絶対パス>` を必須とし、AGENTS.md でも既定の書き方として指示する。apply_patch は絶対パスを必須とする |
| 主体 | hook の `agent_id` の有無で親と subagent を区別する（既存の agent-operation-guard と同じ根拠） | hook の `agent_id` の有無で親と子を区別する |
| own の根拠 | 起動 root、または EnterWorktree の lock（PID と UTC 開始時刻が hook の直接の親と一致） | 起動 root、または managed worktree の ownerThreadId と `session_id` の一致 |
| ask | 使える（人間への割込み） | 使えない（deny になる） |

各項目は、検証した harness の版と起動方式とともに記録する。

分類器が対応する入力の形は scripts/lib/agent-operation-option-table.json に subcommand ごとに宣言する。
既知 option は値の有無とともに持ち、初期値は実 transcript で3回以上使われた option と、分類に必要な option とする。
Git help から生成せず、コミットする観測値には option 名と件数だけを含める。
未知の option、判定に使う引数が stdin・file・動的な値から来る形は U とする。
判定に使う引数を、クラスを決める selector と、変更の実行先を決める target に分ける。
selector はすべてのクラスで必要だが、target は R だけと確定した操作では必要ない。
たとえば refspec・mode・設定 key・API method のように R か変更か、または P・X・D・S かを決める値は selector である。
Git の `-C`・`cd` の実行先は target であり、R の読取では間接・動的な値でも未解決の理由にしない。
API method が literal な GET と確定する場合（明示指定、または method・field・input の指定が無い既定形）は R とし、endpoint は判定に使わない。
変更の method、field による既定 POST、または method を確定できない場合は endpoint を selector として判定する。
GraphQL の query 内容からクラスを決める場合も selector の検査を要する。
本文・title 等、判定に使わない値はこの規則の対象外とする。
既に確定した P・X・D・S は U を付加しても弱めない。
通常の形の追加は所有者が決め、宣言の外へ分類器が自動で広がらないようにする。

U による deny は Git common directory の pfdsl/agent-operation-unresolved.jsonl に、時刻・主体・subcommand・理由の分類・未知 option 名だけを追記する。
命令全文や path は含めず、記録の書込みに失敗しても判定を変えない。
scripts/agent-operation-unresolved-report.mjs は理由と option の件数を集計する。
所有の比較では起点を含む worktree の root を使い、subdirectory での起動も同じ linked worktree の割当とする。
primary と other-live の判定を先に適用し、各操作の実行先は明示した対象から決める。

shfmt の1回の解析 timeout は3000ms、policy supervisor の内部 deadline は8000msとし、scripts/lib/agent-operation-timeouts.mjs にまとめる。
両 harness の PreToolUse hook timeout の10秒より短くする。
複数命令や literal な内側の解析を含む処理全体は supervisor が止めるため、各解析の時間を合計して待ち続けない。
高負荷時の成功を保証する値ではなく、通常の並列 session の遅延を許容しつつ同期停止を監督する上限である。
parser の timeout は欠落やロード故障と区別し、一時的な遅延として同じ命令の再試行を案内する deny とする。
回復先は同じ agent の書換え（再試行）であり、欠落時だけの root 固定 installer の allow 例外は変えない。

判定表の合成入力、実 Git の代表例、live hook、設定の正式な読込みを別の証拠段階として記録する。
合成入力と子プロセスの入口検査を live harness の成功へ格上げしない。
Codex version 1 の他者 ownerThreadId だけでは生存を証明しない。
別の生存 session の肯定証拠が無い linked worktree は other-unowned として扱う。

## 保証外と回復先

- source・dot で読む script file、その他の script file・Git alias の内部。literal な -c・eval の文字列は上の分類の対象とする。
- 保存済みの remote 設定（mirror、特殊な refspec、include）が引き起こす作用。
- 同じディレクトリで2つの session を同時に起動した場合（同居）。own の判定は排他的な所有を証明しない。同居の検出は harness のネイティブな隔離（Claude の lock、Codex の managed worktree）に委ねる。
- primary で実行する Git 以外の命令の副作用（例: `make build` による生成物や共有 shim の配置）。
- remote の default branch は GitHub の ruleset が保護する。この表はローカルの ref と checkout だけを扱う。

Git long option の一意接頭辞、短縮 cluster の網羅、Git help から入力を生成する oracle、default branch 名の大文字小文字の同一視、local push 先の解釈、rebase option と update-refs の追跡、reflog verb 表、GIT_CONFIG_* の文をまたぐ追跡、Windows、GHES、gh alias・extension の全 command 表は作らない。
設定 key を問わない -c の一律停止も行わない。
文をまたぐ shell 状態や pushd・popd の cwd 状態機械は持たない。
checkout されていない他 session の未 push branch の -D による削除と、stash pop が他 session の退避を取り出す残余は受け入れる。
表に無い入力はセルやクラスを足さず、未決点へ記録し、所有者が採否を決める。
回復先は同じ agent の書換え、親への返却、人間の terminal の3つとする。
parser の欠落だけは hook root 固定の完全一致コマンドで回復でき、make setup は例外にしない。
bootstrap 自体や公式 parser release の取得が故障した場合は、人間の terminal へ返す。
