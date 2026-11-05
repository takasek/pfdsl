---
tags: [target:prose-doc, context:guard, method:falsification]
---

観測日: 2026-09-21（#1221 / PR #1231）。当時の版は `4046d9cb`（誤った動機説明）と `c9b70502`（限定後）。

## 観測した入力と結果

真偽値だった `crossesWorktree` を4状態の `classifyTargetRepository`（`own` / `sibling` / `foreign` / `unknown`）へ広げた。
新設した `unknown` の動機を、コードコメント・`scripts/root-instructions-template/INSTRUCTIONS.md`・`.pfdsl/workflow.pfdsl` の3箇所へ「git が引けない環境で guard 全体が無効化されるのを避けるため、root を解決できない場合は fail closed を維持する」と書いた。

実測すると、その名指しのシナリオでは `unknown` の分岐に到達しない。
target が git リポジトリでない場合、`resolveGitRoots` が null を返すのと同じ理由で `git branch --show-current` も失敗する。
`currentBranch === undefined` になり、`targetsDefaultBranch` が false になるため、`unknown` を読む分岐より手前の「ブランチ不明 → allow」で抜ける。
非 git ディレクトリを target にして hook を直接叩くと、stdout は空（= allow）だった。

`unknown` が実際に deny へ到達するのは、**session 側の root だけが解決できず、target は正しく既定ブランチを返す**場合に限られる。
書いた動機（git が壊れた環境）と、その状態が実際に守る範囲（session root が解決できないセッション）が食い違っていた。

## 原因の仮説

状態を増やす判断は正しく、独立に同じ問題を解かせたレビュアーも同じ4状態へ到達した。
誤ったのは動機の書き方で、**新設した状態の説明を、その状態へ到達する入力の側からでなく、状態を作ろうと思った動機の側から書いた**ことによる。
動機は「git が壊れたら困る」であり、それは真である。
その動機が `unknown` によって満たされるかは、`unknown` より手前にある分岐が同じ入力を先に捕まえないかを見ないと分からない。
既存分岐を読まずに書けてしまうのが、この誤りが安く作れる理由である。

構造としては既存事例 [generalization-drops-the-qualifier](generalization-drops-the-qualifier.md) と同族で、そちらは一般化の工程で限定詞が落ちる形、こちらは限定詞が最初から書かれない形である。

自分の書いた3箇所とも同じ誤りを持っていたため、箇所どうしの突合では検出できない。
検出したのは、当時の `.pfdsl/workflow.md`「Claude Code（Opus）でのレビュー」（現行は「レビューの観点と記録」）の観点2が課す「diff が導入した事実主張を列挙し、各主張の**反証を試みる**」要件で、実行主体（自分）と委譲先レビュアーが独立に同じ反例へ到達した。
「主張が正しいか」を確かめる形だったら、3箇所とも読んで矛盾がないので通っていた。

## 未解決事項

新設した分岐へ到達する入力の列挙は、この回では手で行った（hook を直接叩いて出力を見た）。
分岐の到達可能性を機械的に列挙する手段はこのリポに無く、状態を増やす変更のたびに同じ手作業が要る。
対策として wrapper レベルのテストを2本追加し、`unknown` が実際に効く経路と効かない経路の両方を固定したが、これは今回の1関数についてのみである。
