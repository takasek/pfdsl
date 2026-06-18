# pfdsl

成果物管理・進捗更新・ワークフロー運用は pfd-ops スキルに従う。

## 実装方針

t-wadaのTDDで。適切な粒度でコミットすること。

### コミット粒度

論理単位ごとに分割する。1コミット = 1つの一貫した変更。Conventional Commits 準拠（`feat(scope): ...`, `refactor: ...`, `docs: ...`, `feat!: ...` 破壊的）。

変更束はブランチで作業し PR で main に統合する（main 直コミットしない。生態系図の develop→PR→merge_pr が正規経路）。

コミットメッセージは**英語**。

直近の履歴 (`git log --oneline`) を参考にスタイルを合わせる。