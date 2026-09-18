---
tags: [target:worktree, context:parallel-work, phase: pre-artifact]
---

- **サイクルの指示文書を、サイクルのツリーとは別の checkout から読む trap**: worktree でサイクルを回す運用では、実行も書き込みも worktree 側で行う。
  しかしセッション冒頭に読む指示文書（skill 本文・reference・companion）は、ツールへ渡すパス次第で main checkout 側の実体になる。
  main checkout は誰も rebase していない限り `origin/main` より遅れるので、そこから読んだ規約は**撤去済みの節を含んだまま**実行主体の前提になる。
  遅れたツリーのコードを見本として写す trap（`stale-window-external-artifact-survives-rebase`・`verification-ran-in-another-tree`）と同じ形だが、ずれているのが実行場所でも base でもなく「読んだ指示そのもの」である点が違う。
  症状は失敗として出ない。撤去済みの規約に従った分だけ余計な作業が発生し、現行規約に無い項目を満たそうとして詰まるか、逆に現行規約が求める項目を知らずに飛ばす。
  どちらも緑のまま進む。
  問いの形: 「いま従っている規約は、どのツリーのファイルから読んだか。そのツリーは `origin/<base>` に対して遅れていないか」。

  観測（2026-09-18、issue #1160 のサイクル）: セッション冒頭に読んだ `work-cycle.md` と `roadmap.md` は main checkout（`/Users/m5/works/pfdsl`）の実体だった。
  サイクルは `.claude/worktrees/root-instructions-template`（`origin/main` 起点）で回していた。
  読んだ版は `Review:` trailer をゲート条件として要求し、`phase: pre-artifact` のパターンを成果物を書く前に読み直すことを3つの参照点で求めていた。
  現行版はどちらも持たない — trailer はゲート条件から外れ（記録先は PR 本文）、pre-artifact 節自体が撤去されている。

  証拠: `rg -c 'pre-artifact' /Users/m5/works/pfdsl/.claude/skills/pfd-ops/references/work-cycle.md` が `1`、同じ相対パスを worktree 側で引くと `0`。
  companion も同様で、開発手順は `89cc2e1e docs(workflow): move development procedures out of roadmap` で `roadmap.md` から `workflow.md` へ移っていた。

  この回の帰結: コミット直前に現行 `workflow.md` を読み直したため、外へ出た成果物（PR 本文・設計記録・委譲ブリーフ）はいずれも現行規約に一致した。
  気付いた契機は、撤去済みの `REVIEW_TOOLS` を実装から探して見つからなかったこと — 規約の側でなく、規約が名指すコードの不在から辿った。

  原因の仮説（未検証）: セッション開始時点では worktree がまだ存在せず、skill のロード元がセッションの project root に固定されるため、後から worktree を作っても読み元は main checkout のままになる。

  未解決: 読み元のツリーを機械的に判定する手段を持たない。
  実行場所には `verification-tree-guard.mjs` があるが、Read 系のパスは判定対象外である。
