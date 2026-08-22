---
tags: [method:delegate, context:parallel-work]
---

- **並行委譲の接合部**: 複数 subagent へ並行委譲した成果物同士の整合は、各委譲の受け入れ基準では検証されない。
  検収では成果物ペアの接合部（一方が定める規約 × 他方が生成する内容）を突合する。
  問いの形: 「委譲 A の出力は、委譲 B が実装した検査・規約の除外条件に収まっているか」。
  具体例: ADR の構文例引用（double-backtick span）と lint の inline-code 除外（当時 single-backtick のみ対応）の組で、構文例が実マーカーとして検出され、定義例と参照例が相互解決して lint が偶然 PASS した（#328。除外は #398 で backtick run 対応に修正済み）。
  検査 PASS は接合部の健全性を保証しない — 例示が実データ化していないかを実マッチ列挙（検出関数の直接実行）で確認する。
  **同じ形は委譲を伴わない単独の編集でも起きる。** 例示として書いた文字列が、それを囲む記法のエスケープ規則と衝突すると、例示のつもりのものが実データとして解釈される。
  具体例: JSDoc のブロックコメント内に再帰 glob の例を書いたところ、そのパターンに含まれる星と区切りの並びがコメント終端記号を作り、以降の散文が構文として解釈されてファイルが壊れた（#582 のサイクル）。
  問いの形: 「この例示は、それを囲む記法にとってただの文字列か、それとも意味を持つ並びを含むか」。
  対策: 例示を書いたら、囲みの記法でパースし直す（コメントならファイルを実行・import する、lint なら検出関数を直接走らせる）。目視では終端記号は読み飛ばされる。
  **同じ形は rebase で併合した、独立に正しい契約同士にも起きる。** Claude root の bundle manifest は全ファイルを書き終えた後に記録する必要があり、Codex migration の cleanup は legacy な Claude-root files を消す必要がある。各変更を単独に通しても、manifest を cleanup より先に書く接合順では、後に消す file まで hash に記録してしまう。
  具体例: dual-harness generator の rebase でこの順序が混ざり、独立した seam review が manifest を書いた後の legacy cleanup を検出した。cleanup を前へ移した後の failure injection は、strict に失敗として扱う cleanup error を best-effort cleanup が握り潰す経路も検出した。
  問いの形の追加: 「併合する各契約の操作順は、他方が観測・記録する状態を後から変えないか。途中の cleanup が失敗したとき、その error は契約どおり伝播・rollback されるか」。
  対策の追加: 結合の受け入れ基準には各 unit の成功試験だけでなく、操作列の順序 assertion と接合部ごとの failure injection を置く。生成・削除・hash・publish・rollback をまたぐ契約は、最後に書くものと strict に失敗させるものを明示して検査する。
