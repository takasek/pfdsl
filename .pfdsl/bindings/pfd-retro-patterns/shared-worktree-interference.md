---
tags: [target:worktree, context:shared-tree, context:parallel-work]
---

- **共有作業ツリーの他セッション干渉 trap**: 同じリポジトリのルート作業ツリーで複数のエージェントセッションが同時に動くと、一方の `git stash` / `git switch` が他方の未コミット編集をツリーから取り去り、HEAD を別ブランチへ移す。
  被害側から見た症状は「編集したはずのファイルが編集前の内容に戻っている」であり、ツールの失敗でもモデルの記憶違いでもないため、原因を自分の側に探すと際限なく空振りする。
  Edit ツールは成功を返し、その後の Read も成功する — 消失は次に同じ箇所を触るまで検出されない。
  問いの形: 「このツリーの HEAD とブランチは、自分が最後に置いた状態のままか。未コミット編集が戻っていたら、まず自分の操作でなく他セッションを疑ったか」。
  検出: `git reflog` に自分が実行していない `reset` / `checkout: moving from <自分のブランチ>` が並ぶ。**`git stash` は内部で `reset` を行うため、reflog 上は `reset: moving to HEAD` として現れ、`git reset` と区別がつかない** — 消えた編集を探すときは `git stash list` を先に見る。`git worktree list` と `git branch --show-current` で、ルートツリーが自分のブランチから外れていないかも見る。
  具体例: サイクル途中で別セッションがルートツリーで stash を取り、`fix/status-ready-empty-message` へ切り替えた。未コミットだった `scripts/gate-check.mjs` の編集が2度ツリーから消え、同セッションの `packages/` 変更と自分の変更が同一ツリーに同居した（2026-08-05）。
  対策: 復旧は「消えた側の差分を `git diff > patch` で退避 → 自分のブランチの worktree を作成 → そこへ `git apply` → ルートツリーの自分の変更のみ `git checkout --` で戻す」。`git stash list` に自分のものと他セッションのものが混在するので、drop する前に各 stash の内容が既にどこかのコミットへ入っていないかを確認する。相手の変更には触らない。
  予防はサイクルを worktree で回すこと。ルートツリーの HEAD は共有資源であり、単独セッションであることを前提にできない。
