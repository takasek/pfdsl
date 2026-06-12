# pfdsl

## 実装ロードマップ

`docs/pfdsl_implementation_flow.pfdsl` がツールチェーン実装の進捗を PFDSL 自身で記述している（dogfooding）。各 artifact に `status: done | wip | todo | blocked` が付与され、`statusStyles` で可視化される。
作業を進めたらこのファイルの該当 artifact の status を更新する。
ツールチェーン実装に関わる新規 artifact / process は同ファイルに追記。知識成果物・スキルの追加は「成果物の生態系」の図に登録する（境界: 実装物 = roadmap、知識・能力 = ecosystem）。

## 成果物の生態系

`docs/artifact_ecosystem.pfdsl` がリポジトリ内成果物（spec / skill / examples / ADR / issues / roadmap）の生成元と利用局面を定義する。新しい種類の成果物を追加するとき・既存成果物の置き場や用途に迷ったときはまずこの図を見る。消費者を書けない成果物は作らない（終端監査）。

## 実装方針

t-wadaのTDDで。適切な粒度でコミットすること。

### コミット粒度

論理単位ごとに分割する。1コミット = 1つの一貫した変更。Conventional Commits 準拠（`feat(scope): ...`, `refactor: ...`, `docs: ...`, `feat!: ...` 破壊的）。

変更束はブランチで作業し PR で main に統合する（main 直コミットしない。生態系図の develop→PR→merge_pr が正規経路）。

コミットメッセージは**英語**。

直近の履歴 (`git log --oneline`) を参考にスタイルを合わせる。
