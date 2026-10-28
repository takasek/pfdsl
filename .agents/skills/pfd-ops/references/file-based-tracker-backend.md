<!-- DO NOT EDIT. Authoritative source: scripts/harness-template/skills/pfd-ops/references/file-based-tracker-backend.md. -->

# ファイルベース・トラッカー（pfd-ops プリセット）

PFD の作業項目を GitHub Issues でなく、リポ内の markdown ファイルで管理する流儀。issue トラッカーを持たない、または使わないリポが選べる再利用可能パターン。採用リポは `roadmap.md` でこのプリセットとファイルの所在を指す。

## 規約

- **一次情報**: 作業項目を列挙する markdown ファイル（ファイル名・置き場は採用リポが決め `roadmap.md` に記載する。例: `.pfdsl/work-items.md`）。`roadmap.pfdsl` は依存構造のみ管理する
- **作業項目の参照**: 対応は [`work-cycle.md`「作業項目と process の対応」](work-cycle.md#作業項目と-process-の対応) に従う。各項目にファイル内で一意な識別子を付与する（例: `T1`）。process の `location:` には、その項目を一意に指す URL を置く（例: `file:///absolute/path/work-items.md#t1`、または既存の文書共有先の項目 URL）。ファイルだけを指して項目を特定できない参照は対応とみなさない。識別子とアンカーの対応、参照先の到達・項目の実在確認は採用リポが定める。`file://` の絶対パスは別 checkout へそのまま持ち運べるとは限らず、CLI のリンク検査は URL の実在を検証しない。`work-items.md#t1` は現行 CLI ではアンカー付き参照でなく全体がファイル名として扱われるため使わない。
- **flow 分類**: 各項目に `flow: managed` / `flow: exempt` 相当のフィールドを付与する（例: 項目の見出し直下に `flow: managed` と書く）。roadmap 登録対象は managed、対象外は exempt。判定基準は GitHub Issues 版（`github-issues-backend.md`「ラベル判定基準」）と同じ: 未解決の依存がある（前提が未完了、または他の作業が待っている）作業を載せ、どちらにも当たらない作業は載せない
- **status 同期**: 一次情報は当該ファイルの各項目が持つ status フィールド。`roadmap.pfdsl` の対応する出力 artifact の status と整合させる。同期の実行時点と commit・PR の単位は採用リポの運用規律が定める。完了の判定は下の完了契約に従う
- **完了チェーン回収**: 下の完了契約を満たした後、[`work-cycle.md`「完了チェーンの回収」](work-cycle.md#完了チェーンの回収) の `pfdsl prune` で回収する。項目ごとの手削除や独自の保持規則は置かない。実行契機と変更の統合方法は採用先が決める。未完了のまま廃止する場合は done として回収せず、必要な入力を保ち、代替や廃止を人が判断して依存構造へ反映する

## 完了契約

完了を判定する対象版では、一次情報の当該項目が完了状態であり、対応する出力 artifact が `status: done` であることを両方確認する。一次情報だけが wip のまま残る状態を完了とは判定しない。確認が終わるまでは、対象の artifact・process・edge を保持する。削除済みの対象を、確認済みの根拠にしない。この状態を用意して確認する時点や変更束の単位は採用リポの運用規律が定め、本プリセットは同一コミットへの包含や PR の順序を要求しない。

設計記録の要否・配置・書式・承認参照は、採用先の実行規律が定める。
本プリセットは、その保存先や操作時点を要求しない。
