# issue追跡idをprocess側へ移す 設計

## 背景・問題

pfd-ops の GitHub Issues バックエンド規約（`github-issues-backend.md`）は「issue対応artifactのidは `iN_` prefix（N=issue番号）」と定めている。issue close時、下流入力が残るartifactは `iN_` prefixを剥がし `status: done` へ「降格」される（`scripts/lib/issues-flow-audit.mjs` の `applyClosedInFlowFixes` Case B）。

`location:` を process にも許可した変更（#310）の副作用で、この規約の歪みが顕在化した。issue/PRの追跡URLは「この作業がどこで追跡されているか」＝process（動作）の付帯情報であり、成果物実体を指すartifactのものではない。`iN_` prefixも同様に「この作業はissue #Nで追跡されている」という**作業（process）の属性**であって、成果物（artifact）の属性ではない。

現状の設計では、この属性がartifact側に載っているため、issue closeという「作業側」のイベントでartifactのid自体が変わる。同一成果物を指すノードのidがclose前後で不安定になり、それを参照する他のedge・ドキュメント・コミットメッセージの記述が追従を要する。

## 新規約

`iN_` prefixはprocess idへ移す。**恒久**（issue closeで剥がさない）。processは「この作業を issue #N が発注した」という不変の来歴を表すため、状態遷移で変わる理由がない。

- 旧: `i310_location_on_process`（artifact） + `relax_location_on_process`（process）
- 新: `location_on_process`（artifact、最初から plain id） + `i310_relax_location_on_process`（process）

変換規則: process id は既存の動詞的id にそのまま `iN_` を前置。artifact id は現行の `iN_` を単に除去（既存の「降格後」名と同じになる）。

既存 `.pfdsl/roadmap.pfdsl` の現存オープン10チェーンで機械変換を検証済み — artifact側・process側とも既存idとの衝突なし。

## close時の挙動変更

### terminal（hasDownstream=false）— 変更なし

成果物に下流消費者がいなければ、chain（process + artifact + 生成edge）を丸ごと削除する。判定基準は同じ（対応する出力artifactに下流edgeがあるか）。判定の起点だけ「`iN_`付きartifactを起点に」から「`iN_`付きprocessを起点に、edge逆引きで出力artifactを特定して」に変わる。

### 非terminal — 「降格」を縮小

現行の降格（`iN_`剥がし + `status: done`強制 + `tags`/`updated_at`削除）のうち、prefix剥がしとstatus強制は不要になる（prefixはprocess側で恒久、statusは既存プロトコル通りマージ時に人力更新される）。

status強制は元々冗長だった: プロトコル4により出力artifactの`status: done`は作業完了コミット（PRのbranch上）で既に立つ。branch→mainへマージされればmain上でも自動的にdoneになっている。issue closeはこの完了より後（またはPRマージと同時）に起きるイベントなので、close時点で改めてdoneへ強制する操作は常に無意味な上書きだった。

`tags`（priorityラベル同期用）と `updated_at`（鮮度チェック用）は issue がopenな間だけ意味を持つデータなので、close時に削除する（issueの状態を書くたびに監視され続ける無用な鮮度チェックを避ける）。削除対象は process側の `tags`/`updated_at`。

## audit script改修

`scripts/lib/issues-flow-audit.mjs`:

- `parseIssueArtifacts` → process側 `^i(\d+)_` を走査する形に変更（関数名・返り値の意味も process 起点へ）
- `hasDownstream` / `status` の判定は、対象processの出力artifact（body中の `>> process -> output` edgeから逆引き）を見て行う。1つのprocessが複数出力を持つ場合の扱いは実装計画で詰める（現行roadmapでの実例を確認する）
- `applyClosedInFlowFixes`:
  - Case A（terminal）: 判定起点をprocessに変更する以外はロジック同じ
  - Case B（非terminal）: id rename処理を削除。`tags`/`updated_at` の削除のみ残す

## ドキュメント更新

- `.claude/skills/pfd-ops/references/github-issues-backend.md`（一次情報）: id規約節・close時降格節を書き換え
- `.claude/skills/pfd-ops/references/architecture.md`: L3サマリ節（58-63行）を新規約に合わせる
- `.github/workflows/flow-on-issue-close.yml` + `install/` 配下ミラー: 自動生成PR本文中の説明コメントを更新
- `.pfdsl/roadmap.md`: 「close時の降格規則を適用した」ゲート項目の記述が新規約と整合するか確認し、必要なら更新

install/ と配下ミラーの identity は `check-pfd-ops-sync.yml` が検証するため、変更は同一PR内で両方に反映する。

## 移行

現行 `.pfdsl/roadmap.pfdsl` の現存オープンチェーン（10件、事前調査で衝突なし確認済み）を新規則でリネームする。機械的変換のため spec化時点で確定したマッピングをそのまま適用する。

## 既存ADRとの関係

`docs/adr/` を検索した限り、旧 `iN_` on artifact 規約を導入した専用ADRは存在しない（github-issues-backend.md の記述が一次情報）。よって本変更も新規ADRは作成せず、L3 preset文書の直接書き換えで完結させる。

## スコープ判定（flow:exempt）

この変更は他作業をゲートせず、新しい製品能力も生まない自己ツーリングの是正（pfd-opsプリセット自体の規約修正）。`flow:exempt`扱いとし、issue起票・roadmapチェーン追加は行わない。

## 検証

- `scripts/lib/issues-flow-audit.test.mjs`（735行）を新契約に合わせて全面書き直す
- 既存オープン10チェーンのリネーム後、`npx @pfdsl/cli check .pfdsl/roadmap.pfdsl` / `graph` が通過する
- `diff -rq` で `install/` と配下ミラーの identity を確認する
- 思考実験: terminal issue close → chain削除がprocess起点でも同じ結果になること
- 思考実験: 非terminal issue close → tags/updated_at削除のみ行われ、process/artifact idは不変であること

## 1 processが複数出力artifactを持つ場合

現行roadmapの10チェーンには実例なし（確認済み）。将来発生しうる2パターンを解決しておく。

- **複数issueが同一processを指す**（例: `draft_multifile_specs`がissue#5/#6両方に対応）: process idは `i40_i41_do_work` のように該当issue番号を全て連結する（`^(?:i\d+_)+`で抽出）。issue番号↔特定outputの対応表は持たない — issue closeイベントごとに、そのprocessの現存する全outputに対し既存のper-output判定（hasDownstream/status）を再実行するだけでよい（べき等: 既に消えたoutputは対象から自然に外れる）
- **findingの単位**: `computeFindings`は現行同様「1 output artifact = 1 finding」のまま変えない。processのiN_からissue番号を解決し、その上で出力ごとに独立してhasDownstream/statusを見てCase A/B判定する。processレベルで単一フラグへ集約する必要はない（出力Aがdone、出力Bがwipでも、それぞれ独立にfindingが出るだけ）

**単一output・複数issue共有時の早期全削除防止**: 単一outputのprocessが複数issueに紐づく場合（上記の"複数issueが同一processを指す"パターン）、片方のissueがterminal closeしても、そのprocessに紐づく全issue番号がCLOSEDになるまでprocess/artifact/edge行は削除しない（`applyClosedInFlowFixes`が`iN_iM_..._`プレフィックスから全issue番号を抽出し、`issuesByNumber`で全件CLOSED確認してから削除する）。片方だけ閉じた状態では該当findingをスキップし、次回実行時に再評価する（べき等）。

## `flow-on-issue-close.yml`の自動PRが移行作業中に発火した場合

移行PRがマージされるまでの間、旧ロジックのまま`flow-sync/pending`ブランチへ自動PRが立つ可能性がある。特別な同期処理は設けない —  発火したPRは単にマージせず放置する。移行PR側が先にマージされれば、次にこの自動ワークフローが走ったときは新ロジックで実行され、放置PRの内容は自然に陳腐化・上書きされる。
