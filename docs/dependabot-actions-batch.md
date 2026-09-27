# Dependabot GitHub Actions の一括統合

`.github/workflows/dependabot-actions-batch.yml` は、`main` 向けの Dependabot GitHub Actions PR が `github-actions` ラベル付きで作成・再開・ラベル付与されたときに起動する。後続イベントが待機ジョブを取り消すため、最後の対象 PR から15分待ってまとめる。統合ジョブは別の排他グループで直列化し、処理中のイベントで取り消さない。最終 PR が開いている間は次の束を保留し、最終 PR がマージされたイベントで再開する。

`scripts/dependabot-actions-batch.mjs` は対象 PR の作成者、同一リポジトリの head、ブランチ名、base、変更ファイルを検証する。変更は workflow 内の40桁 SHA の `uses:` 行だけを受け入れる。PR のコミットをローカルの中間ブランチに統合し、生成物と pin のテスト期待値を更新してテストに通った場合だけ、中間ブランチを公開して `main` 向けの最終 PR を作る。元の Dependabot PR と `main` にはマージ操作を行わない。

## 有効化

専用の GitHub App をこのリポジトリだけにインストールし、Repository permissions に Contents、Pull requests、Workflows の Write を与える。App の Client ID を Actions variable `DEPENDABOT_BATCH_CLIENT_ID` に、秘密鍵の全文を Actions secret `DEPENDABOT_BATCH_APP_PRIVATE_KEY` に設定する。Client ID が未設定の間は待機ジョブを起動しない。App token は最終 PR の通常 CI が起動するように使用し、テストと生成の子プロセスには渡さない。

自動実行が失敗した場合は Actions のログと中間ブランチを確認する。対象 PR の変更が SHA pin 以外だった場合は処理を止め、手動で内容を確認する。テスト前に失敗した場合は公開ブランチを作らない。ブランチの push 後に PR 作成だけ失敗した場合は、次の対象イベントで公開済みブランチのマージコミットから対象番号を復元して PR 作成を再試行する。既存の中間ブランチを自動で上書きしない。
