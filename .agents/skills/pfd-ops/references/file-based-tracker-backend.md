<!-- DO NOT EDIT. Authoritative source: .claude/skills/pfd-ops/references/file-based-tracker-backend.md. -->

# ファイルベース・トラッカー（pfd-ops プリセット）

PFD の作業項目を GitHub Issues でなく、リポ内の markdown ファイルで管理する流儀。issue トラッカーを持たない、または使わないリポが選べる再利用可能パターン。採用リポは `roadmap.md` でこのプリセットとファイルの所在を指す。

## 規約

- **一次情報**: 作業項目を列挙する markdown ファイル（ファイル名・置き場は採用リポが決め `roadmap.md` に記載する。例: `.pfdsl/work-items.md`）。`roadmap.pfdsl` は依存構造のみ管理する
- **id 規約**: 各作業項目にファイル内で一意な id を付与する（例: 連番 `T1`, `T2`, ...）。対応する process の id はその id を prefix にする（例: `iT1_do_work`）。**恒久** — 項目を完了にしても剥がさない。同一 process が複数項目に対応する場合は `iT1_iT2_do_work` のように連結する。対応する出力 artifact の id は最初から plain（prefix なし）
- **flow 分類**: 各項目に `flow: managed` / `flow: exempt` 相当のフィールドを付与する（例: 項目の見出し直下に `flow: managed` と書く）。roadmap 登録対象は managed、対象外は exempt。判定基準は GitHub Issues 版（`github-issues-backend.md`「ラベル判定基準」）と同じ: 他作業の着手をゲートするか・新しい製品能力を生むか
- **status 同期**: 一次情報は当該ファイルの各項目が持つ status フィールド。`roadmap.pfdsl` の対応 artifact/process の status は、項目の status を変更したのと同じタイミングで手動同期する（GitHub Issues 版が持つ `updatedAt` 自動追跡のような機構は無いので、同時更新を運用規約とする）
- **完了規則**: 項目を完了にしたら終端をチェーンごと削除する（チェーン = 当該 artifact + それを唯一生産する process + 関連 edge）。下流入力が残るものは削除せず、id の prefix も剥がさない（process に完了を示す `tags` を付けている場合はそれだけ削除する。付けていないリポは何もしない）。完了させず廃止する場合も終端は削除し、下流入力が残るものは代替を用意するか廃止するか人が判断する

## 完了契約

実装を完了として統合する変更束では、一次情報の当該項目の `status` を完了状態へ更新し、対応する出力 artifact の `status: done` と同じコミットに含める。終端ゲートでは両方の実在と同一コミットへの包含を確認し、一次情報だけが wip のまま残る状態を許可しない。この完了状態を統合した後、終端チェーンの削除は独立した後続変更で行う。削除を同じ変更束へ入れると、終端ゲートが確認すべき `status: done` の artifact 自体が消えるためである。

## 着手前の選択記録

work-cycle 手順1 の適用点1 が定義する Format 3 設計選択記録は、実行主体が着手前に確定する記録である。新規記録は `設計記録形式: 3` を宣言し、`決定:`、`理由:`、`案の処分:`、必要数の `前提検査 Pn:`、`改訂履歴:` をこの順で持つ。ファイルベースでは記録先自体がリポ内ファイルなので、確定操作はコミットになる。

- 記録を当該項目に追記し、**それだけを単独のコミットにする**
- そのコミットを、実装の初コミットより前に積む。前後の機械照合は**コミット順**（`git log --reverse` 上の並び）で行う
- **status 更新と削除の順序**: 出力 artifact の `status: done` 更新（pfd-ops プロトコル4・終端ゲート）を含む完了状態の統合が先、上の削除は後続変更。同じ変更束に両方を入れると、終端 artifact では「status を done にした」というゲートが削除済みノードを指すことになり、原理的に確認できなくなる。GitHub Issues 版がこれをマージ時点とクローズ時点に分けているのと同じ分割である
- **移行履歴**: 形式1と形式2の時刻による互換性は GitHub Issues backend だけに適用する。ファイルベースの新規記録は常に Format 3 を使い、旧形式を新たに書かない。
