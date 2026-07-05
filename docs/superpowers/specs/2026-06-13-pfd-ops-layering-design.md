# pfd-ops 層分離 設計

## 背景・問題

現 `.claude/skills/pfd-ops/SKILL.md` は2つの異質な関心を混在させている。

1. **汎用 PFD 運用プロトコル** — 着手判断・依存レビュー・進捗更新・終端監査・ワークサイクル。PFD を使う任意のリポジトリに適用できる。
2. **このリポ固有の運用バインディング** — issue バックエンドが GitHub Issues であること、`scripts/audit-issues-flow.mjs` による同期監査、`iN_` prefix / `flow:managed` ラベル規約、payoff_log への効果収集、pfdsl 品質ガイド改訂経路、ラウンド比較計測。

混在のため、このスキルを他リポへ配布できない。固有事項を剥がし、汎用層を配布可能にする。

## 層の定義

成果物を生成元/消費局面で見る既存の `ecosystem.pfdsl` の発想に沿い、運用知を4層に分ける。

### L1: 汎用・無条件（配布スキル本文に直接書ける）

PFD という概念だけから導ける手順。固有名詞ゼロ。

- 着手判断: 入力 artifact が全て done のプロセス = 着手可能。並列着手集合を status から機械的に列挙する
- 新規作業の受け入れ: 依存グラフに1チェーン追加 → 並列性・接点・合流点を確定してから着手
- 依存レビュー: 相互依存（決定が往復で形成される関係）を見つけたら分割せず統合する。判定テスト = 上流方針の合否基準を下流作業なしで書けるか（ADR-0004 基準(3)「分割不能: 相互依存は1プロセスに」の判定テスト文言を SKILL.md 本文に蒸留する。配布先は ADR を読めないため。現 SKILL.md:28 行に同文言が既にある）
- 進捗更新: 完了 = 出力 artifact の status 更新、コミットと同時。done の根拠が言えなければ成果物定義を疑う
- 終端監査: 消費者を書けない成果物は作らない。新種成果物は `ecosystem.pfdsl` に producer/consumer を登録してから作る
- ワークサイクル骨格: 選択 → 実行 → 反映 → 報告。範囲規則 = 1サイクル1プロセス
- 終端ゲートの汎用項目: 出力 status 更新 / 変更した全 .pfdsl が `check` 通過 / 論理単位コミット / 変更束を PR に集約
- retro 起動条件: 設計対話が長引いた後 / ADR が数本溜まった時 / 同一 PFD に連続修正 / セッション締め際

### L2: 汎用パターン・実装スロット（形は汎用、宛先はリポが供給）

汎用スキルは「ここに従え」とディスパッチするだけで、具体を持たない。宛先は移行後の最終形では `.pfdsl` の sibling `.md` companion（次節の規約で統一）。

- **作業項目の一次情報と同期手段**: 「`roadmap.pfdsl` とその sibling `roadmap.md` に従え。一次情報の所在と同期手段は `roadmap.md` に書かれている」
- **知見の振り分け**: 「実践・レビューで得た知見は記録先成果物へ振り分けよ。宛先候補 = `ecosystem.pfdsl` の知識系成果物（ノード）と、振り分け手続きは sibling `ecosystem.md`」
- **終端ゲートの追加項目**: 汎用項目に、リポ固有チェック（issue クローズ等）を合成する。固有項目の出所は対応する `.md` companion

注: 移行前の現状は規約散文が `roadmap.pfdsl` frontmatter description に同居している。移行（後述 §3）でこれを `roadmap.md` へ移し、description はノード事実に絞る。L2 のディスパッチ先は移行後の最終形（`.md` companion）で記述する。

### L3: バックエンド・プリセット（汎用ではないがベストプラクティスとして配布可能）

「PFD の作業項目を GitHub Issues で管理する」流儀。pfdsl 固有ではなく、採用したいリポが選べる再利用可能パターン。pfd-ops に同梱し、採用リポだけが参照する。

- issue が一次情報、`roadmap.pfdsl` は依存構造のみ
- `iN_` prefix（N = issue 番号）/ `flow:managed`・`flow:exempt` ラベル
- close 時の降格規則（終端はチェーンごと削除、下流入力が残るものは prefix を外し一般 done artifact へ）
- `audit-issues-flow.mjs` による同期監査（`--fix` 機械修復、ラベル・updatedAt・priority 突合）
- 採用手順: スクリプト設置、ラベル作成、`roadmap.pfdsl` への規約 description 記載

### L4: このリポ純粋固有（配布対象外。pfdsl 開発リポだから存在）

- payoff_log: PFD の効果を収集する動機ごと固有（pfdsl の効果実証が目的）
- pfdsl 品質ガイド改訂経路: このリポが pfdsl スキルの上流だから成立
- ADR 改訂規約 / review-perspectives.md
- 学習ループのラウンド比較・残存ミスの lint 要件送り（ツールチェーン開発固有）
- implementation_flow ロードマップ
- L3 のインスタンス化（採用バックエンド = GitHub、監査スクリプトの実パス、リポ URL）— `roadmap.md` がこの L4 ホスト

L4 のホストは2つに分かれる。ノード単体の同一性事実（パス・直接の producer/consumer）は `.pfdsl` の `description` に1行で残す。複数ノードをまたぐ手続き・根拠・プロトコル（学習ループ、知見振り分け、ゲート項目の根拠、L3 インスタンス化）は、後述の `.md` companion に置く。`roadmap.md` / `ecosystem.md` の中身はいずれも L4（リポ固有）。

### `.md` companion 規約

companion の**機構**（仕組み）は L2 に属し SKILL.md に記載、companion の**中身**は L4（リポ固有）に属す — この2層を混同しないこと。各運用 `.pfdsl` ファイルに、同名 sibling の Markdown を任意で対にできる。

- `ecosystem.pfdsl` ↔ `ecosystem.md`: グラフが運べない散文（学習ループ手続き、知見振り分けプロトコル、終端ゲートの根拠）
- `roadmap.pfdsl` ↔ `roadmap.md`: このリポの issue 管理バインディング（採用バックエンド、監査スクリプトの実パス、L3 reference へのポインタ）

境界規則:
- `.pfdsl` description = ノード単体の同一性。何で・どこにあり・直接の producer/consumer。1行の事実
- `.md` companion = 複数ノードをまたぐ手続き・根拠・単一ノードに紐づかないプロトコル

規約自体（「skill は `<file>.pfdsl` とその sibling `<file>.md` を読め」）は汎用（L1/L2）で SKILL.md に記載する。`.md` の中身は L4（リポ固有）。`.md` は任意 — 散文が必要な `.pfdsl` にだけ作る（例: `impl_flow.md` は不要なら作らない）。

この規約により、以前の「固有層ホスト = ecosystem + description」案で description に詰め込めなかった手続き知に、グラフと対になる明示的な置き場ができる。単一の汎用 ops ファイルと違い、各 `.md` は対応するグラフにスコープされるため雑多な寄せ集めにならない。

## 配布物の構造（移行後の想定図）

```
.claude/skills/pfd-ops/          ← 原本（このリポで開発・dogfood）
  SKILL.md                       ← L1 + L2 のみ。固有名詞ゼロ
  references/
    github-issues-backend.md     ← L3 プリセット規約と採用手順
  scripts/                       ← スクリプト原本の置き場は下記の通り未決
    audit-issues-flow.mjs        ← L3 同梱
    lib/
      issues-flow-audit.mjs
      yaml-require.mjs
```

これは移行後の想定形であり、現状のパスとは異なる。スクリプトは現在 `scripts/audit-issues-flow.mjs` + `scripts/lib/`（`issues-flow-audit.mjs`, `yaml-require.mjs`, `issues-flow-audit.test.mjs`）にある。

**先送り事項（実装計画で詰める）**:
- 原本の置き場: リポ `scripts/` 残置 + 配布時コピー vs スキル `scripts/` へ移動。lib 依存とこのリポ内パス参照（roadmap.pfdsl / roadmap.md など）への影響を見て決める
- テスト `issues-flow-audit.test.mjs` の扱い: 配布物に同梱 / 除外 / スキル外（リポ `scripts/`）に残置のいずれか

## このリポの移行

移行は終端監査ルール（消費者を書けない成果物は作らない）を順序で守る — `.md` 成果物の登録を、その新設より先に行う。

1. **成果物登録を先行**: `ecosystem.md` / `roadmap.md` を `ecosystem.pfdsl` に artifact 登録する（consumer = pfd-ops skill が読む。producer = 対応する `.pfdsl` を整備する process）。登録を済ませてから以降の新設に進む
2. **現 SKILL.md の固有事項を棚卸し**し、移転先と移転する具体内容を確定する。現 SKILL.md の記述を正本とし、移転先 description が現状その内容を持っていない場合は description も更新する（「既出」と仮定しない）:
   - payoff_log 追記条件（日付・局面・効果・参照の形式、効果体感時に追記）→ 運用手続きとして `ecosystem.md`。`payoff_log` description（ecosystem.pfdsl:84）は現状「効果を体感した時に追記」までで形式に言及がないため、必要なら1行追補
   - 品質ガイド改訂経路（知見・ADR を品質ガイドのどこへ反映するか）→ 手続きは `ecosystem.md`。`skill_template`(:38) / `maintain_template`(:154) description はプロセス定義のみで経路の手続きを持たないため、ノード事実は description・流れは `ecosystem.md` に分離
   - 学習ループ（ラウンド比較・残存ミス→lint 要件送り）→ `ecosystem.md`（ADR-0006「ルール＋ツールの二層構造」を根拠参照）
   - 知見振り分けプロトコル（3経路の運用手順）→ `ecosystem.md`
   - 終端ゲートの issue 固有項目（issue クローズ等）→ `roadmap.md`（L3 reference を指す）
3. `ecosystem.md` を新設。手順2で `ecosystem.md` 行きとした手続き知を集約。グラフと対になる散文ホスト
4. `roadmap.md` を新設。このリポの issue 管理バインディング（採用バックエンド = GitHub、監査スクリプト実パス、L3 reference へのポインタ）。現 `roadmap.pfdsl` frontmatter の規約散文をここへ移し、description はノード事実に絞る
5. L3 規約を `references/github-issues-backend.md` に新設。現 SKILL.md と `roadmap.pfdsl` description の issue 規約のうち**再利用可能な部分**（iN_ prefix・ラベル・close 降格・監査スクリプト運用・採用手順）をここへ集約。リポ固有のインスタンス値（実パス・URL）は `roadmap.md` 側
6. SKILL.md を L1+L2 に縮約（手順2で移転先を確定した固有事項を削除し、L2 ディスパッチへ置換）
7. `ecosystem.pfdsl` の `ops_skill` description を更新。現 description は `".claude/skills/pfd-ops/ と /pfd-cycle コマンド。…手書き（生成対象外）"`。更新案: 層構成（L1+L2 本文 / references の L3 / sibling `.md` companion）への言及を1行で加える形にし、ノード事実の粒度を保つ

**移行完了の状態定義（手順ではない）**: このリポが L3 採用リポ第1号として、L1+L2 + `.md` companion + L3 reference の合成だけで従来と同等に運用できる状態。達成判定は次の検証節による。

## pfd-cycle / pfd-retro コマンド

骨格は SKILL.md L1 に居住し、コマンドはそれを起動する薄ラッパーを保つ。ただし「薄ラッパーのまま」では済まない隠れた変更がある: 現 SKILL.md のワークサイクル §選択 は固有パス（`.pfdsl/roadmap.pfdsl`、`docs/pfdsl_implementation_flow.pfdsl`）を直書きしている。L1+L2 化でこれらが本文から消えるため、pfd-cycle の §選択 が固有パスを失う。

移行作業として、選択ステップが「運用ファイルの所在を `.md` companion / L3 reference に問い合わせて解決する」経路に書き換わることを明示する。実装計画でこの書き換え範囲を特定する。

## 検証

- 思考実験: 「GitHub Issue を使わず roadmap.pfdsl だけで運用する架空リポ」が SKILL.md だけで1サイクル回せるか（L3 非依存の確認）。.md companion が無い `.pfdsl` でも破綻しないこと
- このリポで実際に1サイクル（/pfd-cycle）を回し、L1+L2 + `.md` companion + L3 reference の合成で従来と同等に運用できるか
- 変更した全 .pfdsl が `check` を通過
- audit-issues-flow.mjs のテストが移動後も通る

## スコープ外と #11 の関係

本設計は #11「配布可能スキル」（`roadmap.pfdsl` の `i11_portable_skill`、producer = `package_skill`、入力 = `i10_restructured_gen` / `published_cli` / `i14_dir_convention`）の一部。

- 本設計のスコープ = pfd-ops を**配布可能な構造に整える**ところまで（層分離・L3 同梱・`.md` companion・dogfood 検証）
- 配布メカニズム自体（gen-skill 系での他リポへの実配布フロー）は**含めない**
- **#11 の close 条件**: 本設計の成果物がすべて揃い、このリポで dogfood 検証が通った時点。実配布フローは #11 の範囲外とし、必要なら別 issue を起票する（close 時に判断）
- L3 以外のバックエンドプリセット（Jira 等）は作らない（YAGNI）
