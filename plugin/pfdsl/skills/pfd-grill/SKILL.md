---
name: pfd-grill
description: |
  Use when building a single .pfdsl diagram's content from scratch through
  backward dialogue — starting from a named final deliverable and recursively
  deriving the process that produces it, then that process's inputs, then
  those inputs' own producing processes, until every branch bottoms out at an
  external input. Trigger when the user wants to "grill"/interrogate their way
  to a graph, or a PFD's kind/scaffold is already chosen but its graph is
  still empty. Complements pfd-ecosystem (picks which PFD kinds a project
  needs; this skill fills in one graph's content once a kind is chosen).
---

# pfd-grill: 最終成果物からの後ろ向き対話構築

最終成果物の名前から出発し、それを生む process → その入力成果物 → その入力を生む process ...と遡って PFD の中身を対話的に埋める。フルスクラッチで1枚の PFD を書くときの手順。

pfd-ecosystem との棲み分け: pfd-ecosystem は「どの種別（roadmap/workflow/runtime-pipeline）の PFD を持つか」を選ぶ。pfd-grill は種別が決まった後、1枚の図の中身を後ろ向き再帰で書く。

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

## 運用方針

- **逐次書き込み**: 対話で確定した構造は都度 `.pfdsl` に書き込み、`npx @pfdsl/cli check <file>`（非 strict）を実行して green を保つ。書き途中のグラフは V020/V002/V003 が warning に降格されるため（#480）、未完成の枝があっても check は落ちない。対話ログそのものは書かない — 確定した構造だけを反映する
- 全枝の再帰が完了したら、最終検査として `--strict` でも通ることを確認する

## 検証とゲート

- 完成した `.pfdsl` が `npx @pfdsl/cli check <file> --strict` を通ること
- **roadmap.pfdsl を採用している場合のみ**: 構築した図が roadmap の artifact として登録されているか確認する（成果物の門番、pfd-ops プロトコル5）
