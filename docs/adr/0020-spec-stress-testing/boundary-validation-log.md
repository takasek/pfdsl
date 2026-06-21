# 境界整合・マルチファイル意味論 具体例検証ログ

ADR-0020 の付随資料。v0.0.8 の subflow/extends 仕様を具体例トレースで検証した記録。
各例は実 `.pfdsl` としてパース可能（`check` は通る — 当時 §15.11/§15.12 の意味論は未実装で、
境界・マージの検証は手トレース）。判定: ✅ 通る / ❌ error にすべき / ⚠️ 未定義 → spec 決定で解消。

検証は4ラウンド: (1) subflow/extends の穴炙り、(2) extends 深掘り + normalize 実測、
(3) 境界の粒度/名前不一致、(4) rename マップの edge ケース。

---

## ラウンド1-2: subflow / extends の未定義動作（抜粋）

### 境界が片方向検査だった（穴1/2）→ 全単射へ

当時の §15.11 は「子の open input は親入力に存在」「子の terminal は親出力に存在」の
**子→親 片方向**のみ。親の余剰 I/O が無検査だった。

```pfdsl
# h1_parent.pfdsl — 親が coupon を入力に持つ
---
process: { P: { subflow: ./h1_child.pfdsl } }
---
[order, coupon] >> P -> fulfilled_order
```
```pfdsl
# h1_child.pfdsl — 子は order しか使わない
order >> pick -> picked >> pack -> fulfilled_order
```

トレース: 子 open input {order} は親入力に存在 ✅ → **当時は通過**。だが `coupon`（親入力）に
対応する子境界が無い。ビューは「P は coupon を読む」と主張するが分解に現れない。
判定: ❌ 清水法の階層整合（親外部I/O = 子外部I/O の全単射）を破る。→ **双方向の集合等価に修正**。

### normalize が階層を落とす（N1）→ 正規形の非展開を明記

実測（当時の CLI）:
```
$ pfdsl normalize parent.pfdsl
order >> order_fulfill
order_fulfill -> fulfilled_order
```
§13 正規形はエッジ集合＋孤立ノードの**構造のみ**。subflow は frontmatter ゆえ正規形から
消え、`order_fulfill` が原子プロセスに正規化される。判定: ⚠️ subflow の扱いが未定義
（平坦化正準形が無い → `diff` は subflow 版とインライン版を別物と判定）。
→ **§13 に「正規形は subflow を展開も保持もしない・平坦化は対象外」を明記**。

### extends マージ深度が未定義（E1）→ 属性レベル深マージ

```yaml
# preset: done に fillcolor と fontcolor
statusStyles: { done: { fillcolor: "#4CAF50", fontcolor: white } }
```
```yaml
# main: done の fillcolor のみ上書き
extends: ./preset.yaml
statusStyles: { done: { fillcolor: "#2196F3" } }
```
判定: ⚠️ 「キー単位マージ」のキー階層が未定義。`done` 単位なら fontcolor 消失、
`done.fontcolor` 単位なら保持。提案の例は属性1個しか持たず分岐を判定不能。
→ **属性レベル深マージと明記**（解決結果 `done: {fillcolor: 青, fontcolor: white}`）。

> 他の穴: 境界メタデータ正本（S1）/ parts 境界（S2）/ 多段循環検出（S3）/ diamond 解決順（E2）/
> preset 非presentationキー（E3）/ 自己参照（subflow・extends）/ 子のスタイル非継承（R1）/
> tag label/description マージ（R2）。全て §2.9 / §13 / §15.11 / §15.12 の硬化で解消（PR #136）。

---

## ラウンド3: 境界の粒度・名前不一致

全単射規則は親子の名前・粒度の完全一致を要求する。これが実用上破綻しないか4シナリオで検証。

### G1: 粒度差を子の内部 split で吸収 ✅

```pfdsl
# 親: 粗い order
order >> fulfill -> shipment   # fulfill は subflow ./g1_child
```
```pfdsl
# 子: 内部で分割
order >> split -> [order_header, order_lines]
[order_header, order_lines] >> pack -> shipment
```
トレース: 子 open input = {order}（header/lines は split が生産 → open でない）、terminal = {shipment}。
親境界 in={order} out={shipment} と全単射 ✅。判定: **粒度精緻化は子の内部で起き、境界は粗いまま。
マップ不要**。「親粗・子細」の正攻法。

### G2: 1:1 名前不一致（再利用）❌ → rename マップが要る

```pfdsl
# 親
order >> fulfill -> shipment    # fulfill は subflow ./g2_child
```
```pfdsl
# 子（独立命名で再利用したい）
incoming_order >> pack -> outgoing_parcel
```
トレース: 子 open={incoming_order} terminal={outgoing_parcel}。親 {order}/{shipment} と
**不一致** ❌。独立命名された子を流用できない（再利用不能）。→ **1:1 rename マップが正当に効く**。

### G3: N:M overlap（親hoge=子{hogex,hogey,hogez}, 親fuga=子{fugaa,fugab,hogey}）❌ 構造的に不正

```pfdsl
# 親
[hoge, fuga] >> P -> result
```
```pfdsl
# 子
[hogex, hogey, hogez, fugaa, fugab] >> compute -> result
```
マップ案で `hogey` が hoge と fuga の**両方**に属す。これは親レベルで hoge と fuga が
**重複（overlap）**することを意味する。変換グラフの artifact は離散的納品物 →
重複バンドルは未定義（hogey は2回配送? 共有?）。parts で書いても hogey が2合成体に属し
parts 所有権を破る。判定: ❌ **N:M overlap はモデルの臭い**。マップで支えると不正モデルを正当化。
→ **N:M は許可しない。共有が真に必要なら hogey を両レベルの独立境界 artifact にする**。

### G4: parts で粒度表現 → 実質 G1

親 `order{parts:[header,lines]}`、子は `order` を whole で受ける。境界は composite id `order`
で一致。子が parts を扱うなら親が parts を渡す＝境界が parts になる（split 実行者が未定義）。
判定: 1:N 境界マップも「分割の実行者不在」で同じ穴。→ **粒度は内部 split で扱う**（G1 に帰着）。

**結論**: 粒度差＝内部 split（マップ不要）、1:1 名前不一致＝rename マップ、N:M＝却下。

---

## ラウンド4: rename マップ（`boundary:`）の edge ケース

提案形:
```yaml
process:
  P:
    subflow: ./child.pfdsl
    boundary: { order: incoming_order, shipment: outgoing_parcel }  # 親ID: 子ID の1:1全単射
```

### M0: happy ✅
親 in={order} out={shipment}、map で子 {incoming_order}/{outgoing_parcel} へ全単射 ✅。G2 を解消。

### M2: 多段ネスト → 検証は per-link、合成不要 ✅
```pfdsl
# 親: P→m2_child, map {order:incoming_order, shipment:parcel}
order >> P -> shipment
```
```pfdsl
# m2_child: Q→m2_grand, map {incoming_order:raw, parcel:packed}
incoming_order >> Q -> parcel
```
L2 のマップは m2_child 自身の id（incoming_order/parcel）を親側に使う。各リンクが自己完結 →
**グローバル合成は検証に不要**。ただし3階層を平坦化描画するなら top `order`=child `incoming_order`
=grand `raw` をマップ合成して辿る（§13 が非展開宣言ゆえ整合。展開 renderer の実装注記）。

### M4: 非単射マップ ❌
```pfdsl
# 親 [a,b], map {a:b}, 子 open {b,c}
[a, b] >> P -> r           # boundary: { a: b }
```
a→b（map）、b→b（未マップ=identity）→ 親 a,b が両方 child b に衝突（非単射）、child c 未対応。
判定: ❌ **実効対応が全単射でなければ error**。

### M5: dangling key ❌
`boundary: { nonexistent: x }`。`nonexistent` は親境界に無い、`x` が子境界か不明。
判定: ❌ **キーは親境界id・値は子境界id を要求**。

### X1: side 越境 ❌
親 INPUT `order` を map で子 TERMINAL `out` へ。判定: ❌ **入力↔open input・出力↔terminal の
side 整合**（越境禁止）。

### X2: feedback id をマップに ❌
`complaint >>? P` の complaint は境界外（feedback除外）→ マップキー不可（C1 に吸収）。

### X3: extends + subflow+map 併用 ✅ 直交
extends（presentation）と boundary（process metadata）は独立。preset は process: を持てず
マップを注入できない。穴なし。

### X4: swap マップ ✅（注記）
`boundary: {a:b, b:a}`、子 {a,b}。単射+全射 ✅ = **置換も合法**。難点: identity のつもりが
swap typo でも全単射ゆえ検出不能（マップの typo 安全性が identity 既定より低い）。軽微。

### X5: rename + 子内部 split 合成 ✅
`boundary: {order:in, shipment:out}` + 子 `in >> split -> [a,b]; [a,b] >> pack -> out`。
全単射成立。**rename と granularity-split は綺麗に合成**。

**rename マップ制約（C1-C5、§15.11 に反映）**:
- C1 キー = 親境界id（dangling→error）
- C2 値 = 子境界id
- C3 実効対応（明示map ⊕ 未マップ identity）が全単射（非単射・非全射→error）
- C4 side 整合（入力↔open input・出力↔terminal、越境→error）
- C5 feedback id はマップ不可（C1 に含む）/ subflow 無しへの boundary 指定→error

新規構造穴なしで設計が完全に特徴づけられた（収穫逓減に到達）。
