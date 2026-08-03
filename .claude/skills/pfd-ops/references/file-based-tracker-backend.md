# ファイルベース・トラッカー（pfd-ops プリセット）

PFD の作業項目を GitHub Issues でなく、リポ内の markdown ファイルで管理する流儀。issue トラッカーを持たない、または使わないリポが選べる再利用可能パターン。採用リポは `roadmap.md` でこのプリセットとファイルの所在を指す。

## 規約

- **一次情報**: 作業項目を列挙する markdown ファイル（ファイル名・置き場は採用リポが決め `roadmap.md` に記載する。例: `.pfdsl/work-items.md`）。`roadmap.pfdsl` は依存構造のみ管理する
- **id 規約**: 各作業項目にファイル内で一意な id を付与する（例: 連番 `T1`, `T2`, ...）。対応する process の id はその id を prefix にする（例: `iT1_do_work`）。**恒久** — 項目を完了にしても剥がさない。同一 process が複数項目に対応する場合は `iT1_iT2_do_work` のように連結する。対応する出力 artifact の id は最初から plain（prefix なし）
- **flow 分類**: 各項目に `flow: managed` / `flow: exempt` 相当のフィールドを付与する（例: 項目の見出し直下に `flow: managed` と書く）。roadmap 登録対象は managed、対象外は exempt。判定基準は GitHub Issues 版（`github-issues-backend.md`「ラベル判定基準」）と同じ: 他作業の着手をゲートするか・新しい製品能力を生むか
- **status 同期**: 一次情報は当該ファイルの各項目が持つ status フィールド。`roadmap.pfdsl` の対応 artifact/process の status は、項目の status を変更したのと同じタイミングで手動同期する（GitHub Issues 版が持つ `updatedAt` 自動追跡のような機構は無いので、同時更新を運用規約とする）
- **完了規則**: 項目を完了にしたら終端をチェーンごと削除する（チェーン = 当該 artifact + それを唯一生産する process + 関連 edge）。下流入力が残るものは process 側の `tags` のみ削除し、id の prefix は剥がさない。完了させず廃止する場合も終端は削除し、下流入力が残るものは代替を用意するか廃止するか人が判断する
