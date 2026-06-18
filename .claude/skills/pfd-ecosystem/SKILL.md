---
name: pfd-ecosystem
description: |
  対話的に ecosystem.pfdsl を初期構築または更新するスキル。
  ecosystem.pfdsl が scaffold のまま（または存在しない）場合に使う。
  ユーザーと確認しながら成果物を剪定し、producer/consumer を特定して
  グラフを育てる。/pfd-cycle の前提条件が揃っていない新規リポや、
  ecosystem を大幅に見直したいときに起動する。
---

# pfd-ecosystem: ecosystem.pfdsl 対話的構築

`ecosystem.pfdsl` と `ecosystem.md` を scaffold から実際のグラフに育てる。
**いきなり全部グラフ化しない** — ユーザーと対話しながら剪定する。

## ステップ 0: pfdsl スキルを起動する

.pfdsl 記法の品質ガイドに従うため、まず `/pfdsl` スキルを invoke する。

## ステップ 1: リポジトリ全体像を把握する

次のものを読んでリポ全体の構造を掴む:

- ルートの `README.md`
- ディレクトリ構成（`ls` で主要ディレクトリを確認）
- `.pfdsl/roadmap.pfdsl`（存在する場合）

把握できたら、リポジトリの目的と主要な成果物の種類をひと言で要約してユーザーに提示する。

## ステップ 2: 成果物候補の列挙と剪定（対話）

リポジトリ内の成果物候補を一覧にしてユーザーに提示する（spec・skill・examples・ADR・issue・roadmap 等、種類を問わない）。

各候補について:
- 「これは ecosystem に載せますか？」とユーザーに確認する
- **消費者を書けない成果物は載せない**（終端監査）
- ユーザーの判断で不要なものを除外する

承認された成果物だけで次のステップに進む。

## ステップ 3: producer / consumer の特定（対話）

承認された各成果物について:
- それを生成するプロセス（producer）は何か？
- それを使うプロセス（consumer）は何か？

不明なものはユーザーに確認する。

## ステップ 4: グラフの記述

`ecosystem.pfdsl` の frontmatter に artifact / process を追記し、`>>`/`->` のフローエッジで producer→artifact→consumer の関係を記述する。

pfdsl スキルの品質ガイドに従って記法を確認する。雛形の `seed_input` / `first_process` / `first_output` は実際のノード名に置き換える（プレースホルダのまま残さない）。

## ステップ 5: 散文を ecosystem.md に書く

グラフだけで表現しきれない運用手続き（知見の振り分け先・学習ループ・終端ゲートの根拠など）は `ecosystem.md` に文章で書く。

## ステップ 6: 検証とゲート

- `pfdsl check ecosystem.pfdsl` が通ること
- `ecosystem.pfdsl` を `ecosystem.pfdsl` の artifact として `roadmap.pfdsl` に登録されているか確認する（未登録なら pfd-ops スキルの「成果物の門番」に従って登録する）
