# pfd-retro バインディング

A/B/C カタログ（監査観点の枠組み・配布）: pfdsl スキルの `references/review-perspectives.md`（plugin なら `${CLAUDE_PLUGIN_ROOT}/skills/pfdsl/references/`、repo-local なら `.claude/skills/pfdsl/references/`）。当リポで検出した具体例は `.pfdsl/review-perspectives.md`（配布カタログの当リポ instance）に蓄積する。

PFD 採用状況: (採用した種別を列挙する。例: roadmap・workflow を採用、pipeline 未採用)

出力宛先: (リポ固有の上書きがある場合のみ記入する。)

## 事例・観察・反例

記録の置き場は .pfdsl/bindings/pfd-retro-patterns/。sample-pattern.md は記入例であり、自リポの最初の事例を保存したら取り除いてよい。
既存の関連事例へ追記するか、独立した事例を同じ置き場へ保存する。観測した入力・結果、当時の版と条件、証拠、原因の仮説、未解決事項を区別する。過去の対策文は現行の規約として再配信しない。
コミットされなかった失敗は Git 履歴から復元できないため、必要な実物や安全に共有できる抜粋をその場で残す。

似た事例が必要なとき、現象・パス・エラー等の具体語で検索し、本文と根拠を読む。件数の閾値や専用検索器、タグ・phase、全読や読了証跡は必要ない。

```bash
rg -n --glob '*.md' '具体的な現象やエラー' .pfdsl/bindings/pfd-retro-patterns/
```

検索の0件を失敗の不在、ヒットを今回の適用とみなさない。
採用する対策は、その操作の既存手順・入力・道具・テストへ反映する。先例を使う委譲、変更前後の報告、最終レビューは pfd-ops の references/work-cycle.md が持つ。
毎サイクルの retro は同 reference の定期監査と手順5に従い、通知の有無で省略しない。

## 運用責任の終了

権限を持つ所有者は、機械化、移管と到達の確認、原因消滅、規則の置換、費用判断を根拠として現行の責任を終了できる。古さや無再発だけを根拠にしない。
判断理由と残る未解決事項は既存の作業記録へ残し、事例の保存と責任の終了を分ける。旧 bindings を新版で丸ごと上書きせず、固有の知見と未コミットの事例を保持してから依存経路を外す。
