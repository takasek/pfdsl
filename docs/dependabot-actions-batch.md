# Dependabot GitHub Actions の一括統合

`.github/workflows/dependabot-actions-batch.yml` は、`main` 向けの Dependabot GitHub Actions PR が作成されたときに起動する。対象は作成者と `dependabot/github_actions/` ブランチ名で判定する。後続の作成イベントが待機ジョブを取り消すため、最後の対象 PR 作成から15分待ってまとめる。待機ジョブの完了イベントで `.github/workflows/dependabot-actions-integrate.yml` が起動し、元の `settle` ジョブの成功を GitHub API で確認した後に Actions secret にアクセスして統合する。統合ジョブは別の排他グループで直列化し、処理中のイベントで取り消さない。待機完了直後に別の PR が届いても早取りしないよう、自動実行では作成から15分以上経った PR だけを収集する。再開や head 更新などの例外は統合 workflow の `workflow_dispatch` で手動再収集する。最終 PR のマージでは起動しない。

`scripts/dependabot-actions-batch.mjs` は対象 PR の作成者、同一リポジトリの head、ブランチ名、base、変更ファイルを検証する。変更は workflow 内の40桁 SHA の `uses:` 行だけを受け入れる。PR のコミットをローカルの中間ブランチに統合し、生成物と pin のテスト期待値を更新してテストに通った場合だけ、中間ブランチを公開して `main` 向けの最終 PR を作る。元の Dependabot PR の base は変更せず、個別のマージ操作も行わない。最終 PR は元のコミットを保持する merge commit 方式でマージする。元 PR の head SHA がその後変わった場合は、同じ PR 番号でも次回の収集対象になる。

## 有効化

専用の GitHub App をこのリポジトリだけにインストールし、Repository permissions に Contents、Pull requests、Workflows の Write を与える。App の Client ID を Actions variable `DEPENDABOT_BATCH_CLIENT_ID` に、秘密鍵の全文を Actions secret `DEPENDABOT_BATCH_APP_PRIVATE_KEY` に設定する。Client ID が未設定の間は待機ジョブを起動しない。App token は最終 PR の通常 CI が起動するように使用し、テストと生成の子プロセスには渡さない。

自動実行が失敗した場合は Actions のログと中間ブランチを確認する。対象 PR の変更が SHA pin 以外だった場合は処理を止め、手動で内容を確認する。テスト前に失敗した場合は公開ブランチを作らない。ブランチの push 後に PR 作成が失敗した場合は3回まで再試行する。それでも PR が作成できず公開ブランチだけ残った場合や、最終 PR をマージせず閉じた場合は、次回の実行を止めて手動確認を求める。既存の中間ブランチを自動で上書きしない。最終 PR 本文の `batch-includes:` 行は取り込み済み head の識別に使うため編集しない。収集漏れを再実行するときは、開いている最終 PR が無いことを確かめ、Actions の「integrate Dependabot Actions updates」から Run workflow を `main` で実行する。
