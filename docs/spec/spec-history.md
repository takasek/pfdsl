# PFDSL仕様書 変更履歴

本ファイルはバージョンごとの変更履歴を記す。現行バージョンは `docs/spec/spec.md` のタイトル行（`# PFDSL仕様書 vX.Y.Z`）が唯一の権威であり、本ファイルでは版番号を重複記載しない。

**エントリの形式**: 新しいものを先頭に追加する（新しい順）。各エントリは行頭から次の見出しで始まる:

`vOLD からの主な変更点（vNEW）：<変更点の要約>`

`vOLD` は直前のバージョン、`vNEW` はこのエントリが導入したバージョン（＝そのエントリを書いた時点の spec.md タイトル行と一致）。先頭エントリの `vNEW` は常に spec.md の現行バージョンと一致していなければならない（`scripts/check-spec-history.mjs` が release 前に機械検査する）。エントリは maintain_spec（統合フェーズ）でタイトル行 bump と同じ作業の中で書く（`.pfdsl/workflow.md`）ので、release 時点で複数バージョン分がまとまって欠けている状態は本来生じない。生じていた場合は書き忘れであり、欠けているエントリを追記する（`spec-history-finalize` スキル）。エントリは version ごとに永続する記録であり、release 単位でまとめたり削除したりしない。v0.0.2 以前のエントリは旧形式（丸括弧なし）のまま残す — 過去の記録は書き換えない。

v0.0.18 からの主な変更点（v0.0.19）：`roadmap` 以外の種別を明示したファイルの artifact に `status:` が設定されていることを検出する W007 を追加した（#787）。**破壊的変更**を含む — `pfdsl meta set <flow ファイル> <id> status <値>` は従来 exit 0 で書き込みに成功していたが、exit 2 で拒否するようになる（§2.10 / §15.14 が既に規定していた挙動に実装を合わせるもの、#923）。既存の flow ファイルが `status:` を持っている場合は新たに warning（strict では error）が出る。

* §15.16「非 roadmap ファイルの status 禁止」を新設し、W007 を規範として定義（W005 の鏡像。produced / source を区別せず、`type:` 省略ファイルは対象外）
* §16 エラー表に W007 の行を追加
* `packages/core/src/rules/status.ts` に `flowStatusAbsence` を追加し `validator.ts` へ配線
* `pfdsl meta set` の status 書き込みに type ガードを追加（§2.10 / §15.14 の既定に実装を追随させた）

v0.0.17 からの主な変更点（v0.0.18）：`pfdsl graph io` の終端監査を2列に分割した（#686）。`externalStakeholders` を宣言した audit-terminal は、従来どおり `terminals` からは除外されるが、新設の `externalTerminals`（テキスト出力では `external-stakeholder terminals:`）へ引き続き列挙される。破壊的変更ではない（追加のみ。`terminals` の内容・意味論は不変）。

* §2.3 externalStakeholders の記述に、`graph io` が2列に分けて報告する旨を追記
* §3.3 audit-terminal の記述に、externalStakeholders 宣言時の分岐先を追記
* `packages/core/src/audit.ts` の `auditGraph` に `externalTerminals: string[]` を追加
* `pfdsl graph io` の `--json` 出力・テキスト出力・ヘルプに `externalTerminals` を追加

v0.0.16 からの主な変更点（v0.0.17）：CLI コマンド体系を再編し、フラットな17コマンドを操作対象の種類で分類し直した（graph/meta/status グループ導入）。外部ユーザーが不在の段階のため後方互換は取らず、旧コマンド名は一括で廃止する（**破壊的変更**、旧名は exit 2、ADR-0030）。

* `pfdsl graph <file>`（DOT/SVG/PDF/PNG描画）を `pfdsl render <file>` に改名
* `pfdsl normalize` を `pfdsl graph edges` に改名
* `pfdsl neighbors|impact|depends-on|path|stats` を `pfdsl graph neighbors|impact|depends-on|path|stats` に改名
* `pfdsl check --audit` の終端監査部分を `pfdsl graph io` に分離し、consumer-asymmetry ヒント部分を `pfdsl check --hints` に改名。`check` は検証専念のコマンドになる
* `pfdsl check --summary` を `pfdsl graph summary` に改名
* `pfdsl get` を `pfdsl meta get` に改名。`--field` は省略可能になり、指定フィールドの生値に加えて `location.resolved` / `command.cwd` 等の派生フィールドを返す
* `pfdsl sort-meta` を `pfdsl meta sort` に改名
* `pfdsl reindex` を `pfdsl meta reindex` に改名
* `pfdsl status-set <file> <id> <status>` を `pfdsl meta set <file> <id> status <status>` に改名し、任意のスカラーフィールド・カンマ区切り複数 id 指定へ汎用化
* `pfdsl ready` を `pfdsl status ready` に改名
* `pfdsl audit-sync` を `pfdsl status gaps` に改名（roadmap とは同期しないコマンドのため audit-sync の名を廃した）
* `pfdsl fmt --mode flat|flows` を廃止し、fmt は常に flows 形式で出力する

v0.0.15 からの主な変更点（v0.0.16）：V020/V002/V003 を非 strict（デフォルト）では warning に降格し、`--strict` で従来どおり error とする（#480）。書き途中グラフ（孤立宣言 process・入出力未接続の process）を非 strict の `check` で許容するための変更。**破壊的変更**: 該当条件のみを持つファイルは非 strict の `check` で exit code が 1 から 0 に変わる。CI 等で完全性を強制したい利用者は `--strict` を明示する必要がある。

* §15.2 プロセス完全性制約（V002/V003）の severity を非 strict では warning、strict では error に変更
* §15.10 孤立宣言プロセス制約（V020）の severity を非 strict では warning、strict では error に変更
* §16 診断表の V002/V003/V020 の severity 列を更新

v0.0.14 からの主な変更点（v0.0.15）：v0.0.11 全体レビューおよび extends プローブの残余 findings を反映した編集整備パス（#300）。破壊的変更ではない（valid/invalid 判定は不変。既存挙動の明文化・文書整理のみ）。

* §3.3 「終端成果物」を audit-terminal（監査対象・フィードバック消費を無視）と boundary-terminal（subflow 境界対象・フィードバック消費を除外）の二述語に分離命名（F3）
* §2.9.1 status 系検査（W003 含む）がファイル単位で閉じることを明記（F21）
* §2.9.3 境界判定が edge 参加 artifact のみを対象とすること（F5）・展開プロセスが通常入力を1つ以上持つべきこと（F6）・子 terminal 過多時は親出力 edge を増やすのが正攻法であること（F12）を追記。メタデータ権威を実効対応（`boundary:` マップ ⊕ 恒等）ベースへ書き換え（F10）
* §2.9.4 `tag.<id>.style` の属性単位深マージ（F23）・`resolve()` 返り値の完全性（F25）を明記し、diamond の値衝突 worked example を追加（F24）
* §15.2 プロセス完全性の「1入力」に `>>?` を含むことを明記（F6）
* §15.3 strict feedback 検査の方向（P から順方向に到達可能）を明記（F11）
* §15.9 revises 分岐禁止の理由（最新版の一意判定）を追記（F14）
* §15.10 frontmatter のみ宣言 artifact が V020 と非対称に無検査である理由を明記（F7）
* §4.1 bare-id 禁止文字に `,` と空白区切りを追記（F9）
* §2.7.1 status gloss を git 固有表現から一般語へ（git は例として括弧書き）（F13）
* §14 タイトルを「正準順序（fmt が従う規範）」に改め normative 位置づけを明記（F18）
* §2.3 basePath を document-level 小節として ID メタデータより前へ移し、`subflow:` / `extends:` の解決基準に影響しないことを追記（F16 / F22）。subflow / boundary の規範散文を §2.9.3 / §15.11 へ一本化（F16 / F19）
* §13 subflow 切り出しが構造 diff 上は全張り替えになる帰結を注記（レビュー §6-4）

v0.0.13 からの主な変更点（v0.0.14）：

* §16 エラー方針を「コード / severity / 定義節 / 条件」の表に改める（#299）
  * P 系（パースエラー）コード族を含む全診断コード（FM/P/V/W）を表に列挙する
  * `location:` ファイルパス不在の dead link 検出と重複 edge は診断コード未実装の任意ポリシーとして表外に注記する
* §15.5 に W001（parts メンバーが edge に不参加）の定義を移す。従来 §16 の散文にのみ存在していた
* §15.6 に W003（status 非単調）の定義を移す。従来 §16 の散文にのみ存在していた
* §15.11 に `subflow:` の絶対パス・URL 禁止（error, V021）を追記し、extends 側（§15.12-4）と対称化する
* core パッケージから `DIAGNOSTIC_REGISTRY` をエクスポートし、この表との一致を CI（`check-diag-registry.mjs`）が検査する
* 破壊的変更ではない（従来 valid/invalid だったファイルの判定は変わらない — ドキュメント整備とツール化のみ）

v0.0.12 からの主な変更点（v0.0.13）：

* §2.3 / §15.8 / §16 `location:` を Process にも許可（#310）
  * §2.3 artifact 専用フィールドから artifact/process 共有フィールドへ移動
  * §15.8 「`location:` を Process に指定した場合は error」制約を撤廃（`command:` を Artifact に指定は引き続き error）
  * 破壊的変更ではない（従来 valid だったファイルは引き続き valid — 検証の緩和のみ）

v0.0.11 からの主な変更点（v0.0.12）：

* §2.9.3 / §15.11 subflow 境界の open input 定義を terminal と対称化（#298）
  * open input artifact = 生成元プロセスを持たず、**かつ通常入力（`>>`）で1回以上消費される** artifact
  * 生成元を持たずフィードバック入力（`>>?`）でのみ消費される artifact は横断的ループの要素であり境界照合から除外する
  * フィードバックループを跨ぐプロセスの subflow 階層化が可能になる（従来 valid だったファイルは引き続き valid — 検証の緩和のみ）

v0.0.10 からの主な変更点（v0.0.11）：

* **破壊的変更**: `status: blocked` を廃止し `waiting` と `suspended` の 2 値に分割（§2.7.1）
  * `waiting` — 外部要因待ち（locus of control: 他者）
  * `suspended` — 自主的な一時中断・再開予定あり（locus of control: 自分たち）
  * `blocked` は V007 error（deprecated 期間なし）
  * `statusStyles` の `blocked:` キーも V008 error
* §15.7 W002 criteria 制約を改訂: source artifact（プロセスの出力でない入力専用 artifact）を W002 対象外に変更
* §2.10 `type:` フィールドを追加（roadmap | workflow | runtime-pipeline）
  * 列挙外の値は V031 error
  * `pfdsl ready` は `type: roadmap` 以外を明示指定した場合 error。省略時は `roadmap` として扱い許可
* §15.15 W005 status 制約を追加: `type: roadmap` ファイルの produced artifact（`->` で生成される artifact）に `status:` が未設定の場合 warning（strict mode では error）。source artifact と非 roadmap ファイルは対象外

v0.0.9 からの主な変更点（v0.0.10）：

* `basePath:` フィールドを追加（§2.3 / §15.8）。`location:` ファイルパス解決と `command:` 実行ディレクトリの基準を変更する。省略時は `.pfdsl` ファイルのディレクトリ（後方互換）

v0.0.8 からの主な変更点（v0.0.9）：

* §2.3 `index:` を artifact / process の共有フィールドに追加（省略可能な正整数。pfd-tools 等の外部ツールが `P{index}` / `D{index}` として解釈するための採番フィールド）
* §15.13 index 制約を追加（正整数必須・名前空間独立・重複 warning・グラフ意味論に影響しない）
* `pfdsl reindex` コマンドを追加（トポロジカルソート順に `index:` を採番。既定は未採番ノードのみ補完・`--renumber` で全振り直し）

v0.0.7 からの主な変更点（v0.0.8）：

* §2.9 マルチファイル意味論を新設（複数 `.pfdsl` ファイルにまたがる参照の共通前提）
* §2.9.1 ファイルローカル ID スコープを規定（各ファイルが独立 ID 名前空間。V001/V002/V003 はファイル単位で成立）
* §2.9.2 ファイル間参照規則を規定（常に相対パス・基準は含むファイルの位置。絶対パス・URL 不可）
* §2.3 Process に `subflow:` フィールドを追加（子フローへの階層展開ビューリンク。#5）
* §2.9.3 subflow 意味論を規定（ビューリンク・境界 ID 協定・V001 非侵犯）
* §2.2 `extends:` トップレベルキーを追加（プリセット継承。#6）
* §2.9.4 extends 継承解決を規定（対象は statusStyles / `tag`（§2.7.4）/ group のみ。ローカル prevail。マージ規則の詳細は後掲の深マージ・決定的解決を参照）
* §2.9.5 プリセットファイル形式を新設（許容キー・`artifact`/`process` 混入禁止・多段 extends）
* §15.11 subflow 境界整合制約を追加（open input / terminal 境界一致・パス存在・循環禁止・Artifact 指定禁止）
* §2.9.3 / §15.11 subflow 境界整合を全単射（ID 集合一致・双方向）に強化。フィードバック入力（`>>?`）を境界照合対象外と明記
* §2.9.3 境界 artifact のメタデータ権威規則を追加（食い違い時は親ファイル優先）
* §2.3 / §2.9.3 / §15.11 subflow に任意の `boundary:` リネームマップ（親ID↔子ID の 1:1 全単射）を追加。独立命名された子フローの再利用を可能化（旧「1 親 : 1 子」制約を解消）。粒度差は子フロー内部の分割で扱い N:M 対応は不可と明記
* §15.11 循環 subflow の検出範囲を「自己参照および多段循環を含む subflow グラフ全体の任意の循環」に一般化
* §13 正規形に subflow の非展開を明記（normalize は subflow を展開も保持もしない）
* §15.12 extends 制約を追加（パス存在・循環禁止・プリセット汚染禁止・相対パスのみ）
* §2.9.4 extends マージを属性レベル深マージと明記（兄弟属性を保持。`statusStyles.<status>.<attr>` / `tag.<id>.<field>` / `group.<id>.<field>` に再帰適用）
* §2.9.4 多段・複数 extends の解決を決定的アルゴリズムとして明記（深さ優先・後勝ち・ローカル最優先。diamond の解決順を確定）
* §2.9.4 共有対象外キー（`layout` / `title` / `dslVersion` 等）の非継承を明記
* §2.9.5 / §15.12 プリセットの許容トップレベルキーをホワイトリスト化（許容外キー混入は error）
* §15.12 循環 extends の検出範囲を「自己参照および多段循環を含む extends グラフ全体の任意の循環」に一般化
* §2.3 / §15.8 `location:` フィールドをスカラーまたは文字列配列で指定可能に拡張（後方互換。スカラーは単一要素配列と等価）。href 出力条件を単一 URL の場合のみに限定（#182）
* §2.8.1 `group` に `parent:` フィールドを追加（省略可）。指定した場合、Graphviz 出力でサブグループを親クラスタ内にネスト描画する。V025（循環 parent chain: error）を追加（#183）

v0.0.6 からの主な変更点（v0.0.7）：

* §2.3 `status` が Artifact 専用フィールドであることを明記（§2.7 参照）
* §2.7.2 `tags` を Artifact / Process の両方に許可（`group` §2.8 と対称）。`tag` の style を Process node にも適用する（status は Artifact 専用のまま）
* §2.7.4 `tag` 定義ブロックを新設（`label` / `description` / `style` をタグごとに宣言。`artifact` / `process` / `group` と同階層）
* `tagStyles` トップレベルキーを廃止し `tag.<id>.style` に統合（v0.0.6 互換性のない変更。タグ定義を一元化）
* §2.3 Artifact に `criteria:` フィールドを追加（完了条件の自己文書化）
* §2.3 Artifact に `location:` フィールドを追加（実体ファイル/URL へのポインタ）
* §2.3 Artifact に `revises:` フィールドを追加（バージョン系列の明示）
* §2.3 Process に `command:` フィールドを追加（実行手順の記述）
* §15.7 criteria 制約を追加（`status: done` + `criteria:` 欠如 → warning）
* §15.7 criteria 制約を拡張（全 status の `criteria:` 欠如 → warning）
* §15.8 location 妥当性制約を追加（ファイルパス存在検証、任意実装）
* §15.9 revises 制約を追加（参照先存在・自己参照禁止・線形性・循環禁止）
* §15.10 孤立宣言プロセス制約を追加（フロントマター宣言 Process が edge 不参加 → error、V020）
* §15.2 プロセス完全性制約を補足（node-decl の孤立は対象外、フロントマター宣言は §15.10 対象と明記）
* §17.5 / §17.6 例を追加
* §19 条件分岐の不在を新設（設計判断の明文化）

v0.0.5 からの主な変更点（v0.0.6）：

* §2.2 `dsl_version` キーを `dslVersion` に改名（camelCase 統一）
* §2.3 Artifact / Process メタデータに `description` フィールドを追加（可視化時ツールチップ）
* §2.6 `layout.maxWidth` フィールドを追加（ラベル折り返し幅、px単位）

v0.0.4 からの主な変更点（v0.0.5）：

* §2.2 front matter キー一覧に `group` を追加
* §2.3 IDメタデータに `group` 参照を追記
* §2.8 Group 定義を新設（グループ宣言・ノード所属・Graphviz cluster 出力）
* Artifact / Process メタデータに `group` フィールドを追加
* §2.3 / §2.4 / §2.5 Artifact / Process メタデータの `title` フィールドを `label` に改名

v0.0.3 からの主な変更点（v0.0.4）：

* §8 構文に node-decl（孤立 node 宣言）を追加
* §3.1/§3.2 に孤立 node 宣言の記述を追加
* §5.1.3 の未確定ID規則に孤立宣言を含む旨を明記
* §13 正規形を「edge 集合 + 孤立 node 集合」に拡張
* §14.1 正準順序に孤立 node の出力規則を追加
* §15.2 プロセス完全性制約を「edge 参加 Process のみ対象」に緩和

v0.0.2 からの主な変更点（v0.0.3）：

* Artifact に status (enum) / tags (任意配列) を追加
* front matter に statusStyles / tagStyles マッピングを追加
* Style 適用順（tags 逆順マージ → status 最終上書き）を規定
* 制約 §15.6 / エラー方針に status / Style 検証を追加

v0.0.1 から v0.0.2 の主な変更点：

* Artifact に parts 構造を追加
* Primary / Feedback 二層グラフを明文化
* 正準順序にランク順を追加
* front matter の artifact / process 定義を整理
* lexer規則を明文化
* 表示名分離方針を明文化
