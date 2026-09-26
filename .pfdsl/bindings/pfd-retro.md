# pfd-retro バインディング

A・B・C カタログ（監査観点の枠組み）: `docs/review-perspectives.md`（配布レンズ）。当リポの具体例・機構は `.pfdsl/review-perspectives.md`（instance）に蓄積する。

カタログの棚卸し時に、必要なら `wc -c` でバイト数、`rg -c '^- \*\*'` で項目数を確認する。20 KiB または40項目を超えたら分割を検討する目安とし、合否条件にはしない。この目安は A・B・C の図・仕様レンズに適用し、過去事例には適用しない。直近5コミットで純追記が3件以上続いているか、全読が context を圧迫していると実測できるかも合わせて、人が分割を判断する。

C 系の対象仕様: `docs/spec/spec.md`。実行手順: `/spec-stress-test`（リポローカル）。

設計決定記録: `docs/adr/`（ADR。一覧・改訂規約は `docs/adr/README.md`）。pfd-ops 定期監査トリガーの「設計決定記録」はこれを指す。

PFD 採用状況: roadmap（`.pfdsl/roadmap.pfdsl`）・workflow（`.pfdsl/workflow.pfdsl`）・pipeline（`.pfdsl/pipeline.pfdsl`）を採用。

出力宛先は `.pfdsl/workflow.md`「知見の振り分け（3経路）」セクションに従う。companion への書き分け（どの companion に書くか）は `.claude/skills/pfd-ops/references/architecture.md` の「companion への書き分けルール」表が一次情報。
## 事例・観察・反例の記録

`.pfdsl/bindings/pfd-retro-patterns/` は検索可能な過去事例の置き場であり、通常作業へ対策を配る正本ではない。既存の本文・具体例・未コミットの失敗記録を残す。`33878aebdaae1c69fda95bd4aea5bf2ba0b321e3` までの記述とタグは当時の資料で、現在も適用できるとは限らない。移行の判断と確認範囲は `docs/adr/0038-retro-case-migration.md` に記録する。

調査や retro で似た事例が必要なとき、現象・ファイル名・エラー等の具体語から検索し、ヒットした本文と根拠を読む。検索の0件は失敗の不在を、ヒットは今回の適用を意味しない。タグ・phase による対策の抽出や自動選別、全読、読了記録は要求しない。

```bash
rg -n --glob '*.md' 'ENOENT|baseline|委譲' .pfdsl/bindings/pfd-retro-patterns/
rg --files .pfdsl/bindings/pfd-retro-patterns/
```

新しい観察は既存の関連事例へ追記でき、独立した事例なら同じ置き場へ保存する。観測した入力・結果、当時の版や条件、証拠、原因の仮説、未解決事項を区別して書く。コミットされなかった失敗は Git 履歴から復元できないため、その場の実物や安全に共有できる抜粋を残す。private な証拠の公開には別途承認が必要である。
採用した対策は効く時点の既存手順へ反映し、その対策が今回の条件に適用できるかをそこで確認する。対策の候補・当時の判断は事例に残せるが、現行規約として再配信しない。書式やタグの統一だけを目的に事例を直さない。

運用責任の終了と事例の保存を分ける。権限を持つ所有者は、機械化、移管先での責任と到達の確認、原因の消滅、代替規則、費用判断を根拠として現行の責任を終了できる。単に古い・しばらく再発しないことを終了の証拠にしない。終了理由と残る未解決事項を既存の判断記録に残し、事例本文を削除する必要はない。

## 日常の適用点

委譲と変更前後の報告は `.pfdsl/bindings/pfd-ops.md`「ワークサイクルの追加手順」の「手順 2 の追加で worktree 上の変更を検証する」と「適用点 3 と 3 層制御で実装を委譲し外向き操作を制御する」、最終レビューは同節「終端ゲートの追加項目を検査して完了を確認する」と `.pfdsl/workflow.md`「Codex でのレビュー」が持つ。事例を引かなくても、今回の入力・実物・期待結果が渡ることを確認する。
毎サイクルの retro は同 reference の「定期監査」と手順5が持つ。repo-local の `scripts/pre-commit` は `scripts/lib/retro-reminder-check.mjs` で staged roadmap の done 追加を通知する。この通知は commit 前の補助であり、done のないサイクル終結や `--no-verify`、配布先の commit を見ない。
変更した事例も通常の最終差分レビューで根拠・観測と推論・現在の手順との区別を確認する。カタログ全体の現行性や対策抽出の意味を維持する専用レビュー・release gate は持たない。

## 配布物への finding 反映

誰が配布層を編集できるかの一般ルールは pfd-retro SKILL.md「出力」節の「上流変更ルール」が一次情報（ADR-0028）。
このリポは pfd-* bundle の上流であるため、そのルールの「自リポが上流である場合」に当たり、配布物への finding 反映をその場での編集として実施してよい（採用リポにこの経路は無い）。
配布スキル本文（SKILL.md）に取り込めるのは L1 に一般化できる記述のみ。
昇格の可否基準・スキル間相互参照の可否・一般化できない具体例の置き場は `pfd-ops/references/architecture.md` が一次情報。

## 1 回の実行契約

この節は監査の対象でなく1回の監査の実行管理を定めるので、`.claude/skills/pfd-ops/references/architecture.md`「昇格先の判定ルール」の区分 iii に当たり、配布層でなくこの binding が持つ（ADR-0040）。

適用単位は、1回の監査へ入れられる層と情報源を決める。`retro_request` が情報源を必須として指定した後の欠落は非適用による省略ではない。収集前に実行 ID、cutoff、必須情報源集合、任意情報源集合を確定し、cutoff より後の活動をその実行から除外する。

1. 各情報源について、問い合わせ、cutoff、取得結果、coverage 状態、安定したイベント ID を凍結 inventory に記録する。必須情報源を取得できなければ coverage を incomplete とし、計画、監査実行、「特になし」の結論を停止する。任意情報源を取得できなければ unavailable と記録して継続する。
2. inventory の各イベントについて、どの監査対象に含めるかを非排他的に分類し、理由を付ける。選んだ具体的な PFD、セッション証拠、知識成果物を解決し、参照だけでなく内容を同じ cutoff で凍結してから A・B・C・D の適用層を監査する。
3. 各 finding に実行 ID と証拠参照を付ける。pfd-retro SKILL.md「出力」節の宛先への振り分けは変更権限ではなく、通常の意思決定経路による人間の disposition だけがリポジトリ保守を許可する。必須情報源の coverage が complete で、選んだ適用層をすべて監査した場合に限り「特になし」と報告できる。
4. 必要な全消費者が同じ task record へアクセスできるなら、inventory、計画、対象 snapshot はセッション出力のままでよい。ホストが同じ task record を保持する compaction は checkpoint の契機にしない。凍結したリポジトリ snapshot だけを読む read-only subagent へ A・B 監査を委譲するときは transient な C・D evidence を渡さず、公開済み commit または対象ファイルだけを渡すため、session inventory の checkpoint は不要である。実行ごとの恒久的なリポジトリ ledger は作らない。
5. 受け手が必要な transient evidence へアクセスできない handoff の前だけ、cutoff、情報源別 coverage、受け手の可視性境界で安全な event identifier、未解決 findings の最小 checkpoint を、意図した受け手だけが読める既存の保存先へ置く。内部 session ID、tool metadata、private evidence は public issue・PR へ書かない。public issue・PR を使う場合は、外部書き込みの直前に正確な内容と宛先を人間へ提示し、その書き込み自体の明示承認を得る。retrospective の実行承認を checkpoint の公開承認とみなさない。
6. 可視性に適合する保存先が無い、または必要な外部書き込みの承認が得られない場合は handoff せず、同じ task・session で監査を完結させる。必要な checkpoint 前に task record を失った場合、その実行を放棄し、新しい実行 ID と cutoff ですべての情報源を再収集する。放棄した実行との同一性を主張しない。

## 知識成果物ライフサイクル監査

知識成果物ライフサイクル監査: 採用する。対象: `.pfdsl/roadmap.pfdsl` の criteria、`.pfdsl/*.md` companion、`docs/adr/`、`docs/pfd_payoff_log.md`

監査項目の本文は配布層の `references/knowledge-lifecycle.md` が持つ。次の2項目は pfdsl の配布機構を前提にするため、配布層でなくこの binding が持ち、上流であるこのリポでだけ適用する。

- **効果の実測**: 対策の前後比較を、`.pfdsl/bindings/pfd-ops.md`「ワークサイクルの追加手順」の「手順 2 の追加で worktree 上の変更を検証する」が固定した基準・対象版・条件と照合する。取得を逃した基準は比較不能とし、今の値で埋めない。測定後の変更で根拠が崩れた範囲を再確認し、代理指標や構造検査の成功と実運用の効果を区別する
- **配布スキル本文の蒸留監査**: 配布スキル本文の手順リストで、複数の追記が同一原則に統合できるものはないか。追記の堆積は原則への蒸留候補である — 各行について「これはまだ原則か、個別事故の傷跡か」を問う。蒸留を実施できるリポも「出力」節の上流変更ルールが決める
