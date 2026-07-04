# subflow 仕様の agent 実書きプローブ（sonnet 被験者実験）

ADR-0020 の付随資料（第3弾）。`boundary-validation-log.md` の手トレース・
`spec-v0011-review.md` の机上レビューに対し、本ログは**読者実験**を記録する:
spec v0.0.11 だけを読ませた sonnet subagent 3体に subflow の実タスクを課し、
CLI `check` を正解器として採点した。狙いは「仕様が論理的に完結しているか」ではなく
「初見の読者が仕様のどこで迷い・誤読し・回避行動を取るか」の検出。

**実験プロトコル**（再現用）:

- 被験者: sonnet subagent（general-purpose、各タスク独立コンテキスト）
- 入力制限: `docs/spec/spec.md` のみ読可。docs/adr・samples・packages・skills の参照禁止。CLI 実行禁止
- 出力: `.pfdsl` ファイル + notes.md（参照節・境界の手トレース・曖昧と感じた点・確信度の自己申告）
- 採点: 実 CLI（`node packages/cli/dist/cli.js check`）で答え合わせ

---

## 実験A: feedback を跨ぐ階層化（実書き）

**課題**: フラットなフローの `impl` を `subflow:` で子フロー（2工程以上）へ展開せよ。
`bug_report >>? impl` の還流を含め意味を保存せよ。

```pfdsl
req >> design -> spec_doc
spec_doc >> impl -> code
code >> qa -> bug_report
bug_report >>? impl
code >> package -> release_pkg
```

**結果**: check **PASS**（W002 のみ）。被験者の戦略は
「`bug_report >>? impl` を親に残し、**子フローには bug_report を一切登場させない**」。
理由も正確: 子で `bug_report` に触れると（生成元が無いため）open input 集合に混入し
全単射が崩れることを §2.9.3 の字義から読み取った。

**被験者が申告した曖昧点**:

1. feedback 対象 artifact を子フロー内で参照する**合法な手段が仕様上見当たらない**
   （node-decl として置くだけでも open input 定義に混入して境界を壊しうる、と推論 — 実際には孤立 node-decl は実装上境界に数えられない。spec-v0011-review F5 の未規定ゾーンに突入していた）
2. W003（status 非単調）が subflow 境界を跨いで評価されるのか未規定
3. 確信度: 中〜高（境界ロジックは高、グレーゾーン解釈で減点）

**反例としての読み**: check は通ったが、**課題の「意味を保存せよ」は満たせていない**。
フラット版では bug_report が実装工程に還流することが図に描けていたのに、
階層化後の子フロー（write_code → self_review）には「どの工程が bug_report を受けて直すのか」を
書く合法手段が無い。つまり現行仕様では、feedback ループに触れるプロセスを subflow 化すると
**エラーになるか、情報を捨てるかの二択**になる。これは spec-v0011-review **F1**
（open input 定義の feedback 除外漏れ）の利用者側から見た症状であり、
F1 修正（open input = 生成元なし **かつ** `>>` で消費）により
「子で `bug_report >>? write_code` と書ける」が成立して解消する。

---

## 実験B: 変更禁止の共有子フローを boundary で再利用（実書き）

**課題**: 共有ライブラリ `fulfillment_lib.pfdsl`（変更禁止・独立命名・副産物 terminal 付き）を
親の `order >> fulfill -> shipment` に `subflow:` で接続せよ。親側 ID は `order` / `shipment` を使いたい。

```pfdsl
incoming_order >> validate -> valid_order
valid_order >> pick -> picked_items
picked_items >> pack -> [outgoing_parcel, packing_slip]
```

仕掛けた罠: 子の terminal が `{outgoing_parcel, packing_slip}` の2件あるため、
課題文の「出力は shipment のみ」の形のままでは全単射が成立しない。
N:M マップ（禁止）に走るか、親の出力 edge を増やすか、諦めて子を改変するかの分岐点。

**結果**: check **PASS**。被験者は罠を正しく検知し、
親を `order >> fulfill -> [shipment, delivery_slip]` に広げ、
3組の完全な `boundary:` マップ（`order:incoming_order, shipment:outgoing_parcel,
delivery_slip:packing_slip`）を書いた。N:M 濫用にも子の改変にも走らなかった。
side 整合・全単射の手トレースも正確。

**被験者が申告した曖昧点**: N:M 禁止の理由は書いてあるが、
「子の terminal 数 > 親の出力 edge 数」という単純なカーディナリティ不一致に対して
**「親側の edge を増やして全 terminal を露出させるのが正攻法」という例が仕様に無い**。
実装者が boundary の N:M 濫用に走るリスクを指摘（= spec-v0011-review **F12** の提案と同内容が
初見読者から独立に出た。誘導の1文と例を §2.9.3 に足す価値の傍証）。

---

## 実験C: 5ケースの合否予測（オラクル）

**課題**: parent/child ペア5件について `check` の pass/error を spec のみから予測。
正解は事前に CLI で確定済み。

| Case | 内容 | CLI 正解 | 予測 | 確信度 | 正否 |
|---|---|---|---|---|---|
| 1 | rename マップの happy path | pass | pass | 高 | ✅ |
| 2 | 子に生成元なし・`>>?` のみ消費の `lint_report` | error | error | **中** | ✅ |
| 3 | 子に孤立 node-decl `memo` | pass | pass | **中** | ✅ |
| 4 | 入力→terminal への side 越境マップ | error | error | 高 | ✅ |
| 5 | swap マップ `{a:b, b:a}` | pass | pass | 高 | ✅ |

**5/5 正解**。ただし内訳が重要:

- Case 2 は「open input の定義に terminal 側のような feedback 除外規定が**無い**こと」を字義通りに適用して error と当てた。被験者自身が「terminal 側は2段構えの規定、open input 側は一文のみで除外の有無が読み取れない」と非対称を名指しした（= **F1** を初見読者が独立に再発見）
- Case 3 は §13 / §15.2 の孤立 node の扱いから**類推**して pass を当てた。
  「文字通り適用すれば error になる対立読みも残る」と明記（= **F5** の未規定を独立に再発見）

---

## 総合所見

1. **sonnet 級の精読者なら現行 spec で正しい成果物に到達できる**（3体とも check 通過、オラクル全問正解）。
   v0.0.8 での全単射・boundary マップの硬化は「注意深い読者」には学習可能な水準にある。
2. ただし正答の一部は**仕様の字義でなく類推・回避行動で得られている**:
   - A は feedback を子から**捨てる**ことで通した（仕様の欠陥 F1 の回避行動。図の情報量が落ちる）
   - C の Case 2/3 は確信度「中」の推測（F1 の非対称の字義読み・F5 の類推）
3. 3体が独立に申告した曖昧点は机上レビューの **F1 / F5 / F12** と完全に重なり、さらに新規の視点（**W003 の subflow 跨ぎ評価が未規定** — F21）を1件追加した。
   手トレース（ADR-0020 本編）が「規則の穴」を、agent プローブが「読者の躓き」を検出する、という補完関係が確認できた。

**spec 改善の優先順位（本実験の証拠に基づく）**:

1. **F1 修正**（open input 定義に feedback 除外を追加）— 唯一の「表現不能」級。
   実験Aの情報損失を解消し、Case 2 の判定も原則（feedback は契約外）と一致する側へ倒れる
2. **F5 明文化**（境界判定は edge 参加 artifact のみ）— Case 3 の類推を字義に昇格
3. **F12 誘導**（親出力を増やすのが正攻法、の1文+例）— 実験Bの被験者提案どおり
4. **F21 明文化**（W003 はファイル内で閉じる、を明記）— 実験Aの副産物

**手法メモ**: 「spec だけ読ませた agent + CLI 正解器」は安価に再現できる
（本実験は3体・計約20万 token）。仕様の大型追加時に、手トレース（ADR-0020 Decision）の後段として
1ラウンド挟む価値がある。オラクル型（実験C）は被験者の確信度の自己申告が
「曖昧箇所の座標」をそのまま返すため、特に費用対効果が高い。
