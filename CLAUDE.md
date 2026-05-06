# pfdsl

## 実装ロードマップ

`docs/pfdsl_implementation_flow.pfdsl` がツールチェーン実装の進捗を PFDSL 自身で記述している（dogfooding）。各 artifact に `status: done | wip | todo | blocked` が付与され、`statusStyles` で可視化される。
作業を進めたらこのファイルの該当 artifact の status を更新する。
新規 artifact / process を追加した場合も同ファイルに追記。

## コミット粒度

論理単位ごとに分割する。1コミット = 1つの一貫した変更。Conventional Commits 準拠（`feat(scope): ...`, `refactor: ...`, `docs: ...`, `feat!: ...` 破壊的）。

コミットメッセージは**英語**。

直近の履歴 (`git log --oneline`) を参考にスタイルを合わせる。
