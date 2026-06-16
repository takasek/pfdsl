# ecosystem.pfdsl 構築プロンプト

以下をそのままこのプロジェクトの Claude に渡してください:

---

このプロジェクトの `ecosystem.pfdsl` と `ecosystem.md` は雛形（scaffold）のままです。プロジェクト全体を読んで、実際の生態系グラフに育ててください。

1. リポジトリ内の成果物（spec・skill・examples・ADR・issue・roadmap 等、種類を問わない）を洗い出す
2. 各成果物について、それを生成するプロセス（producer）と、それを使うプロセス（consumer）を特定する
3. **消費者を書けない成果物は ecosystem.pfdsl に載せない**（終端監査 — pfd-ops スキルの運用プロトコル参照）
4. artifact/process を `ecosystem.pfdsl` の frontmatter に追記し、`>>`/`->` のフローエッジで producer→artifact→consumer の関係を記述する
5. グラフだけで表現しきれない運用手続き（知見の振り分け先・学習ループ・終端ゲートの根拠など）は `ecosystem.md` に文章で書く
6. 完成したら `pfdsl check ecosystem.pfdsl` を通すこと

雛形の `seed_input` / `first_process` / `first_output` は実際のノード名・実際の成果物名に置き換えてください（プレースホルダのまま残さない）。

---
