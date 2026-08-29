---
tags: [method:delegate, method:unify, context:parallel-work]
---

- **独立に正しいunitが接合部で壊れる trap**: 各unitの受け入れ基準を単独で満たしても、一方の出力や操作順を他方が異なる契約で解釈すれば、結合後だけ誤った状態になる。
  問いの形: 「接合する出力・操作は、成功時と失敗時の両方で、相手側の解釈・観測・状態遷移の契約を保っているか。順序を入れ替えたときにも各unitの前提は成立するか」。
  具体例: 並行委譲したADRの構文例引用（double-backtick span）とlintのinline-code除外（当時single-backtickのみ対応）の組で、構文例が実マーカーとして検出され、定義例と参照例が相互解決してlintが偶然PASSした（#328。除外は #398 で backtick run 対応に修正済み）。
  具体例: dual-harness generator のrebaseで、全fileを書いた後にbundle manifestを記録する変更と、legacyなClaude-root filesを消す変更が混ざった。manifestをcleanupより先に書く順序では、後から消すfileまでhashに記録された。cleanupを前へ移した後のfailure injectionは、strictに失敗させるcleanup errorをbest-effort cleanupが握り潰す別の接合不良も検出した。
  対策: 結合の受け入れ基準に、各unitの成功試験だけでなく操作順のassertionと接合部ごとのfailure injectionを置く。生成・削除・hash・publish・rollbackをまたぐ契約では、最後に実行する操作とstrictに失敗させる操作を明示する。lint等の解釈器を接合する場合は実マッチを列挙し、例示が実データ化していないことを確認する。
