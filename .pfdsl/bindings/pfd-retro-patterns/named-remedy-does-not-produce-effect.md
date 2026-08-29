---
tags: [target:prose-doc]
---

- **名指しされた対処法が狙ったeffectを生まない trap**: 拒否messageや規約が示す手段を正常に起動できても、戻り値の成功と狙った状態変化を同一視すると、効かなかった対処を完了として次へ進む。
  問いの形: 「この手段は起動できただけか、狙った状態変化が起きたことまで確かめたか。確認commandと期待値は何か」。
  具体例: sibling worktreeへの `git add` を止めたguardは「sessionの作業directoryを対象worktreeへ移せ」と対処法を名指しした。その手段は成功を返したが、次turnでも `pwd` はmain repo、branchは `main` のままだった。command中の `cd` もguardのtarget解決を変えず、そのサイクルのcommit3回は人手へ渡した（#1012、2026-08-28）。
  対策: 対処法を名指しするときは、effectを確認するcommandと期待値まで併記する。確認手段を書けないなら、効くと未確認の対処法を示さず人間へ渡す。
