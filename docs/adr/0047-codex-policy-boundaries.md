# ADR-0047: Codex の操作主体・作用先・policy 失敗を分けて保護する

- Status: Proposed（PR #1413 の実装案。実入口の残る受入を含む）
- Date: 2026-10-07
- 対象: #1398、#1404。Git 層と setup は #1403 / PR #1412。

## Context

ADR-0046 の native 所有者補正は Git の確定済み sibling に限定されていた。
cwd が対象へ移った場合、共有 ref、ファイル操作、親の merge、子の Git metadata 操作は独立した境界を必要とする。
policy のロード失敗への try/catch だけでは、同期停止や終わらない stdin を打ち切れない。
個人 wrapper・trusted roots・承認設定を repo の導入要件にせず、既存入口を保ちながらこれらを実装する。

## Decision

### 所有者と作用先

Codex の linked checkout は、payload.cwd と一致していても操作時の native ownerThreadId と hook.session_id の一致を要求する。
ADR-0046 の metadata 形式・取得失敗時の拒否を維持し、cwd の移動だけで own と扱わない。
Claude の Git 補正は直接親 PID・UTC 開始時刻による限定条件を維持する。
Git の実入口で session/target roots、current branch、同一 repo の origin/HEAD による default branch の取得が失敗した変更系操作は拒否する。
detached HEAD は Git が正常に空の branch 名を返した場合と区別する。

共有 ref・stash・worktree metadata の作用先を executor の所有者から分ける。
update-ref、symbolic-ref の変更、branch の強制変更・削除・他 branch 改名、worktree の追加・保守、明示的なローカル ref 宛て fetch を確認する。
worktree add は detached・既存 branch・新規 branch のいずれも共有 metadata を変更するため、Claude では ask、Codex では deny とし、native の worktree 作成入口とは区別する。
default branch の作成・切替と、switch/checkout の分離・短縮・等号付き option を扱う。
switch の `--` 後の operand と、checkout の後続 path の無い `--` は切替先として扱い、`--ignore-other-worktrees` は他 checkout の branch へ入るため共有作用とする。
fetch の `-n` は `--no-tags` なので、免除は `--dry-run` の完全一致に限る。
refspec を stdin から読む `fetch --stdin` は境界で解決できないため拒否する。
読取以外の `git config` は、remote の refspec 等を通じて後続の通常操作の作用先を変えるため共有作用とする。
Git の parse-options は long option の一意な接頭辞を受け付けるので、危険な option の接頭辞はその option として扱い、免除と読取判定には完全一致を要求する。
branch は Git と同じく list mode を判定し、`-v`・`--format`・`--sort` だけでは一覧にならず作成になる形を区別する。
これらの分類は使い捨て fixture で Git 自身に実行させた作用を正とする検査で照合する。
非 default の隔離 branch 作成と自分の branch の非強制改名、通常の読取は維持する。
誰も checkout していない既存の非 default branch を `-B`/`-C` で付け替える形は、隔離 branch 作成として許可したままにする。
共有保守は Claude で ask、Codex で deny とし、自分の terminal に戻す。
foreign repository の既存境界と検査回避の規則は維持する。
任意スクリプト内部、Git alias、書込み済みの remote 設定が持つ特殊 refspec 全般を監視する仕組みではない。

Edit・Write・apply_patch は全 target を物理パスへ正規化する。
symlink を先に辿ってから `..` を処理し、新規ファイルは既存親を調べる。
patch の追加・変更・削除・移動元と移動先を全件確認し、一つでも拒否なら patch 全体を拒否する。
同じ repository の primary checkout への書込みを拒否し、Codex の linked checkout には上記 native 所有証拠を要求する。
不正 patch、dangling symlink、repo 内の解決不能 target は拒否する。
既知の root prefix 外でも祖先に .git marker がある probe 失敗は scratch と区別して拒否する。
Git common dir が異なる repository と repo 外の scratch は既存の管轄外として扱う。
生成 root instructions の正本案内を維持する。
生成物の保護は session と同じ Git common dir の checkout root に限定し、foreign repository と scratch の同名ファイルを生成物と誤認しない。
Git common dir は Git 自身に絶対パスで取得させ、symlink cwd の論理パスへ相対出力を結合して所有境界を誤認しない。

### 操作主体と外向き操作

Codex の hook.agent_id がある子には、Git metadata 変更と外向き書込みを拒否する。
親は stage・commit・fetch・push・PR 更新を担当する。
子の status・diff・log・branch 一覧・remote/config の読取等は明示的な読取表で許可する。
子が Codex Git routine を直接または `node` 経由で呼ぶ場合は、test・build・typecheck・node-test・node-script 以外の verb を拒否する。
Claude の issue-worker 例外を Codex の子へ引き継がない。

親を含め gh pr merge・auto-merge、REST の merge endpoint、GraphQL の merge mutation を保護する。
内容を検査できない GraphQL ファイル入力も保守的に確認対象とする。
`--help` は gh の flag 表で単独の flag と判定できた場合だけ help として除外し、値 flag に消費される形・`--` 後・未知 flag 後は merge として扱う。
GitHub MCP は既知の読取表と、未知または変更系の操作を分ける。
Codex の MCP 書込みは親を含め deny とする。
MCP の親判別を実入口で受入していないため、未知の主体を親とみなして許可しない。
親の通常の Bash 公開経路は残す。
これは MCP の書込みが親でも利用できるという互換性保証ではない。
任意 HTTP client 内部の通信全般を解析する方式ではない。

### policy の実行予算と回復

既存 7 入口それぞれに builtin のみを使う worker thread 監督を置く。
同じ process 内で policy を実行し、process.ppid の直接親条件を変えずに同期停止を監督する。
stdin を含む内部 deadline は 5 秒、payload は 1 MiB、応答・診断は各 64 KiB とする。
Git probe は合計 3 秒、一回最大 500 ms とし、timeout を正常な欠落と区別する。
ロード・同期/非同期例外、不正 payload/応答、期限超過は deny JSON・stderr・exit 2 にする。
正常な allow/deny/無出力は exit 0 とする。
Codex が表現できない ask は deny に変換し、条件の修復後に再試行する案内を出す。
policy/helper の具体的な失敗情報を stderr に残す。

roadmap の新たな公開宣言に対する Claude ask は維持する。
Codex では同じ検出を additionalContext による advisory とする。
承認済み宣言を識別する receipt がない状態で ask を恒久 deny に変換すると、正当な宣言も回復できないためである。
Codex では roadmap の公開宣言を事前拒否する保証を持たず、通常の公開承認と人間の PR レビューが境界になる。

### 既存配置の判断

dispatch の本数は受入条件にしない。
既存入口は保持し、delegation を Bash と GitHub MCP の共通 matcher に配線する。
Edit/Write matcher は Codex の apply_patch alias で実行される。
verification-tree と closes-create は、preflight/CI だけで失う事前保護を受入していないため残す。
SessionStart setup は PR #1412 の版付き shim と preflight に接続したまま残す。
個人 wrapper の撤去や trusted-root 拡張をこの実装の条件にしない。

## 対案

| 案 | 扱いと理由 |
| --- | --- |
| 既存入口と worker thread 監督 | 本実装案。既存配線と直接親を保ち、同期停止を拒否できる |
| 子 process の共通 runner | 親 PID 条件の再設計と受入を同時に必要とするため採らない |
| 同一 thread の try/catch のみ | ロード失敗には有効だが同期停止を打ち切れない |
| native 隔離へ委ね repo guard を削除 | guard を外した同一陰性入力の受入がないため保留 |
| MCP の agent_id 不在を親とみなす | 未受入の actor 信号を許可根拠にするため採らない |
| roadmap の Codex ask を deny にする | 承認済み宣言の回復経路がなく、正当な作業を恒久停止するため採らない |

## 旧 ADR から変える範囲

ADR-0044 の payload.cwd による file 所有者判断、Codex 照合の repo 外への撤去、dispatch の本数、guard 削除、SessionStart 廃止を既定とする条項を本案で置き換える。
ADR-0046 の「own 自体は補正しない」「file policy と主体別 Git policy は含めない」という適用範囲を、Codex の linked checkout・file 操作・子の責務に限って拡張する。
Claude の native lock 条件と過去の受入記録は変更しない。
旧本文は判断履歴として保持し、#1398 全体の受入をこの PR だけで完了へ読み替えない。

## 実入口の記録と限界

2026-10-07、同梱 Codex CLI 0.160.0 の通常 exec（read-only sandbox）で候補入口を呼んだ。
通常読取と gh pr merge --help は成功した。
親の merge（存在しない PR 0）、default ref 更新（同じ既存 OID）、primary package.json への no-op apply_patch は、下流コマンド実行前に hook が拒否した。
primary の HEAD・index・status は不変だった。
生入力で apply_patch の command 形式、親と子で同じ session_id、子のみ別 agent_id を観測した。
別の CLI 試行で子の add --dry-run を一度だけ要求し、router が `Codex Git metadata operations belong to the parent` を返して下流実行前に拒否した。
候補 worktree の hook-io.mjs を一時欠落させた CLI 試行では、通常の git status も具体的な missing module の案内付きで拒否した。
元の helper を完全復元した対照試行では、同じ git status が実行され exit 0 になった。
bootstrap 故障や trust skip の試行ではなく、既存 trusted 入口からの helper ロード失敗を host が拒否として尊重した証拠である。
保存資料はローカルの試行記録であり、合成 fixture の回帰試験と区別する。

hooks/list は候補 worktree を cwd にしても primary の .codex/hooks.json を sourcePath として返した。
既存の Bash/Edit 入口は候補コードを実行したが、新しい MCP matcher はその定義にない。
Codex Desktop の native managed worktree では、親の実 add/commit と clean を確認済みであり、workflow companion に記録している。
今回追加した MCP matcher は、最終設定を正式に読み込んだ Codex の実入口で、読取の通過と変更の拒否を確認する受入が残る。
Claude 側は、最終 hook を接続した Desktop の親・subagent の実 Git と、他セッションの worktree・cd 後の陰性経路が未確認である。
別生存 owner、移動先に留まる cd、再開・fork・handoff、native 隔離へ委ねる場合の陰性対照は #1398 全体の受入として残る。
Node 入口の失敗注入・再生をこれらの live 受入へ格上げしない。
bootstrap 自身の欠落・構文エラー、host timeout、trust skip は、この builtin 監督が起動しないため repo 側で保証しない。
稼働設定の通常の信頼レビューを経ずに primary・信頼 hash・metadata を手修正しない。
