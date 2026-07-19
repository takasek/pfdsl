---
name: pfd-grill
description: |
  Use when building a single .pfdsl diagram's content through backward
  dialogue — starting from a named final deliverable and recursively
  deriving the process that produces it, then that process's inputs, then
  those inputs' own producing processes, until every branch bottoms out at
  an external input. A general-purpose authoring technique applicable to
  any PFD, operational or not. Trigger when the user wants to
  "grill"/interrogate their way to a graph, or a PFD's kind/scaffold is
  already chosen but its graph is still empty. pfd-ecosystem picks which
  PFD kinds a project needs and recommends this technique for a graph's
  first-time construction.
---

# pfd-grill: 最終成果物からの後ろ向き対話構築

最終成果物の名前から出発し、それを生む process → その入力成果物 → その入力を生む process ...と遡って PFD の中身を対話的に埋める。
運用ハーネス（pfd-ops）の一部ではなく、運用 PFD・設計検討の図・単発の図を問わず任意の `.pfdsl` に適用できる汎用の作図アプローチ。

pfd-ecosystem との棲み分け: pfd-ecosystem は「どの種別（roadmap/workflow/runtime-pipeline）の PFD を持つか」を選ぶ。
pfd-grill は種別が決まった後、1枚の図の中身を後ろ向き再帰で導出する。
種別選定後の初回構築（pfd-ecosystem ステップ4）では、白紙の図を埋める作業と非常に整合するためこのスキルの利用が推奨される。

## ステップ 0: pfdsl スキルを起動する

.pfdsl 記法の品質ガイド・非 strict 許容の挙動を確認するため、まず `/pfdsl` スキルを invoke する。

## 対象ファイルを決める

既存の `.pfdsl` に書き足すか新規ファイルを作るかをユーザーに確認する。新規の場合は frontmatter（`type:` を含む）だけ先に用意し、以降のステップはボディ（node 定義・edge）に対して行う。

## 後ろ向き再帰（1つの成果物ノードに対して）

対象成果物ノード1つにつき、次の4手順を順に確定させる。

1. **名前を確定する**: 曖昧な名前（「レポート」等）はそのままノード ID にせず、具体化の問いを重ねてユーザーと確定する
2. **criteria を設定する**: 完了条件をユーザーに確認し、`criteria:` に書く
3. **process を導出する**: その成果物を生む process を1つ特定・具体化する（V001: 1成果物1 producer）。既存 process の出力として自然に繋がる場合はその process を再利用し、新規に立てない
4. **process の入力を導出する**: process が要求する入力成果物を列挙する。複数あれば `[a, b] >> P` の set notation を使う

## 再帰の終了

手順4で導出した各入力成果物について、それが**既存ノード**（すでに図にある、または他の producer を持つ）なら再帰を打ち切りそのノードを参照する。**外部入力**（これ以上遡れない、この図の外から来る入力）に到達したら、その枝の再帰を終了する。それ以外の新規成果物は「後ろ向き再帰」に戻り、その成果物を新たな対象として手順1〜4を繰り返す。

## 構造の保持と書き込み

- **既定は内部保持**: 対話で導出した構造（ノード・criteria・エッジ）はまず自分の作業文脈に内部的に保持し、ユーザーとの後ろ向き対話に集中する。プロジェクト自体から読める情報（README・既存図・コード）も内部で突き合わせ、問いの材料にする
- **書き込みは区切りで行う**: 実ファイルへの反映は、枝が一段落したとき・全再帰が完了したとき等の自然な区切りで行えばよく、頻度はユーザーの好みに合わせる。書き込みはファイル反映の作業にすぎず、pfd-grill の本体は対話による導出そのもの
- 長い対話で文脈喪失が怖い場合は途中反映も選択肢。書き途中のグラフでも `npx @pfdsl/cli check <file>`（非 strict）は V020/V002/V003 が warning に降格されるため落ちない（#480）
- 対話ログそのものは書かない — 確定した構造だけを反映する
- 全枝の再帰が完了しファイルに反映したら、最終検査として `--strict` でも通ることを確認する

## 検証とゲート

- 完成した `.pfdsl` が `npx @pfdsl/cli check <file> --strict` を通ること
- **roadmap.pfdsl を採用している場合のみ**: 構築した図が roadmap の artifact として登録されているか確認する（成果物の門番、pfd-ops プロトコル5）
