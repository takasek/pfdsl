# PFD 効果局面ログ

PFD が効果を発揮した局面の事例ログ。体感した時点で追記する。公開記事（issue #12）の具体エピソード素材であり、消費者は .pfdsl/ecosystem.pfdsl の write_article プロセス。

追記の判定（ADR-0014）: 反実仮想テスト「依存グラフ／プロセス分解がなければこの判断・作業は違っていたか」を満たし、違いを1行で引用できる時のみ書く。引用できなければ書かない（後付けの捏造を排除する）。

## 2026-06-15 仕様統合に外部レビューを組み込む
- 局面: spec v0.0.7 の `integrate_spec`（4提案統合）で Opus を外部レビュアーとして3ラウンド呼んだ
- 効果: 15件の指摘のうち最重要は「cross-proposal constraints」— 個別提案では見えない制約（`command:` を Artifact に指定禁止、`strict mode` 定義の矛盾、分類規則のエッジケース）が統合時に表面化した。単一プロポーザルのレビューでは発見できない型の欠陥であり、統合 = 複数提案の相互参照フェーズでこそ外部読者視点が機能する
- 学習: `integrate_spec` は「貼り合わせ」でなく「cross-validation」が主仕事。Opus review を maintain_spec の推奨手順として description に記録
- 参照: PR #51、commit 7d0685a〜a018823、docs/spec/proposals/

## 2026-06-11 着手可能集合の機械導出
- 局面: オープン issue 8件の優先順位づけ
- 効果: issue を PFD 化すると「入力が全部 done のプロセス」列挙 = 並列着手リストが status から機械的に導出できた（9本並列を即答）
- 参照: .pfdsl/roadmap.pfdsl

## 2026-06-11 新提案の受け入れコストの低減
- 局面: location/command メタデータ提案（#13）の受け入れ判断
- 効果: 既存グラフに1チェーン追加するだけで、並列性（criteria/revises と同列）・接点（パス解決規則のみ multifile 方針と接触）・合流点（integrate_spec）が確定。文章ロードマップなら毎回頭の中でやり直す判断
- 参照: issue #13、commit 6d3b1b9

## 2026-06-11 暗黙依存のレビュー可能化
- 局面: 仕様 issue 群の「並列起草できる」という直感の検証
- 効果: 図に書いた途端、依存の主張がレビュー対象になり、指摘を受けて並列→上流方針→共同起草と3段階で収束。相互依存ルール（ADR-0004 基準3）の発見につながった
- 参照: .pfdsl/roadmap.pfdsl の履歴（a33dba4, 4b4ea3c）

## 2026-06-11 形骸化検出の構造化
- 局面: リポジトリ内成果物（ADR・examples・ロードマップ等）の用途が曖昧になる懸念
- 効果: 終端監査ルールをリポジトリ自身に適用し、全成果物に消費者と利用局面を強制。「消費者を書けない成果物は作らない」が運用規約になった
- 参照: .pfdsl/ecosystem.pfdsl、CLAUDE.md

## 2026-06-11 方法論の効果測定装置
- 局面: 品質ガイド整備の効果検証
- 効果: 実践ラウンド1→2 の比較で「ルールで消えたミス／残ったミス」を分離計測でき、lint 要件（#4）が実証データから導出された
- 参照: docs/adr/0006-rules-plus-tooling.md

## 2026-06-11 進捗管理の一元化（dogfooding）
- 局面: ツールチェーン実装の進捗管理
- 効果: 作業完了 = artifact の status 更新に還元され、進捗報告と依存把握が1ファイルに集約
- 参照: docs/pfdsl_implementation_flow.pfdsl

## 2026-06-11 スキーマ設計判断への原則適用
- 局面: location メタデータ（#13）を単数にするか辞書（locations）にするかの設計分岐
- 効果: 「複数 location 需要」が PFD 原則の適用だけで3分割即決 — 派生物=生成プロセスの隠蔽（暗黙依存と同型）、公開先=別 artifact（本質成果物ルール）、WIP の所在=プロセス属性。方法論が言語スキーマの設計判断器として機能した
- 参照: issue #13 コメント、docs/adr/0001

## 2026-06-12 図の代数的レビュー
- 局面: 生態系図への連続指摘（README の依存・issue 管理ループ・起票の駆動源・対話のプロセス化・出力の型付け）
- 効果: 各指摘が独立でなく連鎖した — 駆動源の修正が位相を変えて別エッジの通常入力昇格を合法化し、粒度ルールが統合を命じる。複数指摘が1つの整合解に収束する「代数的」レビューが成立した
- 参照: commit fc4c1c7〜28187ac、docs/adr/0009

## 2026-06-12 監査質問による滞留検出と監査の構造化
- 局面: ユーザーの監査質問2連発（「ADR 増えたら見落とさない？」「lint 候補漏れなく拾える？」）
- 効果: どちらも実滞留を検出（ADR-0008/0011 のガイド未蒸留、lint 候補の issue 未同期）— ゲート整備以前の在庫は問い直しでしか露出しない。この監査パターン自体を17介入から蒸留して pfd-retro スキル化し、気付き依存を構造に移管した
- 参照: .claude/skills/pfd-retro/、commit fe9e7ea、issue #4 コメント

## 2026-06-12 粒度判断は観測で更新される
- 局面: 知見外化プロセスの統合（入力集合が対話と同一）→ ADR 一括起草の委譲失敗を経て再分離
- 効果: 統合も再分離も同じ粒度ルールが導いた — 委譲・差し戻し・突合検証の発生が「隠れた独立プロセス」の検出器になり、判断は観測された依存に応じて更新される。ID 捏造という失敗様式が入力不足（参照先の図）の発見だった
- 参照: docs/adr/0009 の4段階変遷、commit 28187ac / b17f7cb

## 2026-06-15 code-review による PR スコープ外の既存バグ検出

- 局面: issue #10 実装 PR (#61) に対し `/code-review`（high effort, 7 angle）を適用
- 効果: 10件の指摘のうち3件が PR diff 非対象の pre-existing バグ — gen-samples.mjs の existsSync 欠落（TSV 参照ファイルが存在しない場合クラッシュ）、push Makefile の pre-guard と auto-commit スコープの非対称（pfdsl_implementation_flow.* が auto-commit 対象だが guard 対象外）、TSV silent omission（.pfdsl ファイルが TSV に未登録でも警告なし）。Angle C（cross-file tracer）が gen-skill.mjs と gen-samples.mjs の非対称を発見した。
- 学習: cross-file tracer は「同一パターンを複数ファイルに対称適用したか」を問う。実装時の diff は1ファイルを中心に見るが、reviewer は並列ファイルを横断して見る。PR 作成前の自己 review でも同観点を適用できる。
- 参照: PR #61、commits on chore/retro-findings-post-pr51

## 2026-06-15 PR 作者自身による code-review が導入バグを捕捉

- 局面: issue #11 実装 PR (#67) を自分で `/code-review`（high effort, 7 angle）にかけた
- 効果: 4件の confirmed finding がすべてこの PR で導入したバグ — `check-docs` の build 依存欠落（外部ユーザーの `make install-skill` が壊れる）、2ディレクトリの diverge 検出なし、push auto-commit の非対称、SKILL.md の DO NOT EDIT 欠落。PRマージ前に全修正。7角度のうち Angle B（削除された振る舞いの監査）が最も多くの finding を生産した — 既存ガードの削除・緩和は invariant の消失として必ず確認すべき
- 学習: 実装完了直後の自己 code-review は「自分が壊したもの」の発見に機能する。Angle B は「削除行が持っていた契約を新コードで再確立しているか」を問う — 安全チェックの緩和・前提条件の削除のたびに適用する
- 参照: PR #67、commits 6471285〜3ed86cd

## 2026-06-14 dogfood ループによる設計盲点の検出と閉ループ修正
- 局面: 分離したばかりの pfd-ops スキル（汎用層/固有層）を、文脈ゼロの cold subagent で実タスク dogfood
- 効果: 実機能実装サイクル（#16）が設計者の見落とし2欠陥を露出 — issue クローズの timing（マージ前に確定してしまう）と「チェーン」未定義による孤児 process 残存。学習ループの3経路に振り分け（roadmap.md/references のルール改訂2件 + 孤児検出 lint を #37 起票）、改訂後に同手順を cold agent で再実行したら両欠陥が消滅。dogfood→検出→改訂→再検証の閉ループが成立し、ルールで防げない孤児検出はツール側 lint 要件（#37）へ送られた（ADR-0006 二層構造の実証）
- 参照: PR #34、issue #37、docs/superpowers/specs/2026-06-13-pfd-ops-layering-design.md

## 2026-06-16 構造化監査による忘れ物・列挙ドリフトの機械的検出

- 局面: `/pfd-retro` の3層監査（A/B 図監査、C 運用イベント監査、D 知識成果物ライフサイクル）を実行
- 効果: C層「忘れ物=構造の欠落」が #72/#15/#17 の3PR連続で `docs/pfdsl_implementation_flow.pfdsl` に artifact/process/edge が追加されていない欠落を検出 — 文章ドキュメントなら「更新忘れ」程度の指摘で終わるが、PFD では「このartifactへの入力edgeが存在しない」という構造的不在として言語化でき、3件を同型の欠落として一括検出できた。D層「列挙ドリフト」が `.pfdsl/roadmap.pfdsl` の `published_cli` description に埋め込まれたバージョン番号の陳腐化を検出、npm公開自体が #74 以降止まっていた事実も同時に発覚した
- 学習: 「忘れ物」を status 更新漏れ一般ではなく「graph上のedge欠落」として定式化すると、同型の複数件を1回の監査で束ねて発見できる。pfd-ops 終端ゲートに impl_flow 追記・npm公開確認の2項目を追加し、気付き依存から構造依存へ移管した
- 参照: .pfdsl/roadmap.md の終端ゲート追加項目、commit c6fbe92/844d6d0/aefe323、issue #84

## 2026-06-19 ADR-0006 lint 要件経路の完結 — dogfood 孤児 process が V020 で機械検出可能に

- 局面: dogfood #16 で発見した「チェーン削除後に孤児 process が残存し check に素通りされた」欠陥を、学習ループ経路（ADR-0006）で lint 要件（issue #37）に変換し、V020 として実装（PR #107）
- 効果: 依存グラフ（roadmap.pfdsl）の「ルールで防げない→ツール側 lint 要件経路」が唯一の接続経路だった。この経路がなければ孤児 process 残存は「うっかりミス」として個別対応で終わり、V020 は生まれなかった。ADR-0006 の二層構造「ルールで防げるミスと防げないミスを分類して後者を lint に送る」が 閉ループ として実証された
- 参照: PR #107、issue #37、docs/pfd_payoff_log.md の 2026-06-14 エントリ（dogfood 検出側）、ADR-0006

## 2026-06-19 retro C層が運用ルールの暗黙スコープを構造的欠落として検出

- 局面: #97 サイクル完了後の pfd-retro 実施。open PR (#111) を「サイクル開始時に open のものがあればマージ先行」ルールで先行マージしたところユーザーに指摘を受けた
- 効果: C層「忘れ物=構造の欠落」で分析すると、「open のもの」という表現が `flow-sync/*` ブランチ限定という文脈情報を持たない構造的欠落だった — ルールが意図した対象（自動生成の flow-sync PR）とテキスト上の対象（全 open PR）の乖離が暗黙知として埋め込まれていた。retro がなければ「flowsyncかどうかで判断すればよかった」という個別指摘で終わり、ルール文言は修正されなかった
- 学習: 「運用上の誤判断」は行動ログに残りにくいが、「ルールのスコープが文言に書かれていない」という構造的不在として読み替えると、retro の問いに引っかかる。C層で「忘れ物を edge 欠落として探す」アプローチをルール文言のスコープ記述にも適用できる
- 参照: roadmap.md 修正 commit（feat/external-stakeholders-spec）、pfd-retro C 層「忘れ物=構造の欠落」

## 2026-06-19 W002 拡張が自 roadmap の設計不備を即時検出

- 局面: issue #103 実装（criteria 未設定 artifact への W002 を全 status に拡張）を PR #106 でマージ前に pfd-retro 実施
- 効果: 実装した W002 拡張が、自リポの `roadmap.pfdsl` 内の `spec_v007`（wip, criteria なし）に対して警告を発するべきであることを pfd-retro A2 で検出 — 「作ったルールが自分の成果物を直撃する」という即時 dogfood。criteria 追加と入力依存矛盾（`spec_v007 wip` なのに `featured_toolchain done`）も同時に発見。反実仮想: W002 拡張前なら `status: done` 以外は警告されず、`spec_v007` の criteria 欠落は見えなかった
- 参照: PR #106、pfd-retro A1/A2、commit（roadmap.pfdsl spec_v007 criteria 追加）
