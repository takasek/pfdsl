# safe-modeによる実作業の往復（2026-10-26）

## 実測結果

新鮮なClaude Code 2.1.309のsafe-modeセッションが、固定protocolとCLI出力から81行（空行除外）のdriverを生成した。
親が実入力とコードを監査し、生成ソースを編集せずに実行した。
`result.json` は `PASS`、実行終了コードは0である。

対象は実際のroadmapでreadyだった `i542_migrate_spec_id_refs` である。
#542の段階移行のうち、§15.1の見出しへ `SPEC_single_producer_constraint` を付け、その2相互参照を安定ID参照へ置換した。
規範本文とその他の参照は保ち、`spec_id_refs` をtodoからwipへ進めた。
これはStage 1全体や#542の完了ではなく、成果物全体のcriteriaは未達のままである。
run成功とartifact受入はADR-0048契約4に従って区別する。

## 生成前の固定

- 対象のモデル・入力・criteriaとreadyは `snapshot.json` / `ready.json`、出力path対応は `capture-plan.json` に固定した。
- `pins.json` はprotocol・prompt・CLI/core実体・checker・対象ファイルのSHA-256と対象source commitを持つ。
- 実行時の非公開原本の準備commitは `b521a4ce`、公開用対応commitは `a26efb9f78b4c794aeac3f0fdcc7bada0062bbf9` である。
- `prompt.md` は短い実験protocolと実CLIの出力だけから構成し、生成セッションに過去の応答や会話を渡していない。
- 作業直前にもlive readyと実行前3版をdriverが照合した。

## 実入力の隔離監査

起動は通常のClaudeログインを使い、APIキーを追加していない。
この起動だけの環境変数でadvisorも除外した。

```sh
CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1 claude \
  --safe-mode --disable-slash-commands --tools '' \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --system-prompt-snapshot on --print --output-format json < prompt.md
```

safe-modeの意図は[公式資料](https://code.claude.com/docs/en/debug-your-config#test-against-a-clean-configuration)、advisorの除外は[公式の専用設定](https://code.claude.com/docs/en/advisor#turn-the-advisor-off)に基づく。
フラグやREADY応答だけで隔離成功とは判定していない。

実セッション `dd57f8b8-5399-48bd-be3d-62e68a929084` の `api-request-shape`、全 `api-request-blob`、`api-request` から要求を復元した。
再帰的なキー順ソート、compact UTF-8 JSONによるSHA-256がshape・blob・最終requestの全記録値と一致した。
最終request digestは `53897c3c3887689fcf78626b45d1c8d598837a377f2b387f112157b3663199a6` である。
固定promptは改行・末尾を含め完全一致し、API tools配列と全tool-use/result blockは0件だった。
独立した別agentも実記録を読み、同じ結果を確認した。

pfd-cycle・他skill本文/一覧・共通AGENTS/CLAUDE.md・過去会話・メモリは要求に含まれていなかった。
標準harness指示と環境・アカウント識別情報は残る。
独立設計レビューは、Issueの具体的禁止対象がPFD/作業知識を運ぶ文脈であり、これらの標準metadataの除去を追加要件にしていないことを原記録へ照合した。
metadata-zero、通信ヘッダーやサーバー内部の未記録加工までの証明は主張しない。
個人情報・非公開指示の本文は公開せず、`input-audit.json` に分類・長さ・hash・照合結果を残した。
公開資料だけで非公開要求本文を完全に再検証できるとは主張しない。

## 詰まった箇所と準備失敗

`preparation-attempts.json` と `attempt1-*` / `attempt2-*` に失敗を保持した。
最初の生成は準備commitのMarkdown検査失敗を読む前に開始してしまったため無効とし、実行しなかった。
そのセッションにはadvisor呼出もある。
2回目は固定入力で生成したが、driverがprotocolのmanifestという語から存在しない `manifest` フィールドを創作し、checkerへ実行後snapshotを渡すコードになった。
追加snapshotの書込みも許可範囲外だったため実行しなかった。
具体型が `artifacts` であることと、checkerの第2引数が元の実行前snapshotであることをprotocolへ明記し、新鮮な3回目で生成し直した。
親が過去のコードを修正して成功driverに仕立てたのではない。

3回目にも記録上のprotocol逸脱が1件ある。
protocolはassertion一覧を `checks.json` へ保存するよう求めたが、driverが保存したのは外部コマンドの引数・終了コード・stdout/stderrだけだった。
生成コードは編集せず、この欠落を残したまま親が実行の終了コード・stdout/stderrを `execution.json`、正確な対象差分の別検証を `parent-verification.json` へ保存した。
後者は指定の見出し1件と参照2件以外に一切変更がないこと、規範本文・他参照の保持、対象scopeと固定入力の維持を直接検査した。
この親側の補完を、driver自身がassertion一覧を出したことに数えない。

## 証拠と再検査

`evidence.json` は実行前versionsと実行後resultVersions、実際の変更2path、todo→wip、進めたprocessとwork itemの対応、型付き乖離を記録する。
`checks.json` はID未定義の確認、採番前検査、実CLI ready/status更新、ID整合検査、get-by-IDの実結果を持つ。
`negative-regression.json` は過去の主停止試行と2否定例を実checkerで再検査した結果であり、元ファイルは変更していない。

このtrialのcheckerは、実行時の対象ファイルを読み、固定pre snapshotとの前後照合を行った。
後続のE0 status更新等でモデルが変わったcheckoutへ同じ証拠を渡すと版不一致になるため、再検査は実行直後の固定commitから対象2pathを復元して行う。
そのcommitと再現手順は親ディレクトリのREADMEに記す。
準備器やdriverを再実行して過去のsnapshot・証拠を置き換えてはならない。

## 公開用表現と実行原本

公開ガードがローカルの絶対パスを検出したため、この公開用記録ではcheckoutのパスを `CHECKOUT_ROOT` と表記する。
公開用driverの対象rootは自分の配置場所から相対導出する形へ変更した。
これは実行後の公開用変更であり、実際に生成・実行した未編集ソースや実API入力と公開ファイルが同じバイト列だとは主張しない。
実行時の原本と元の未公開履歴は非公開バックアップに保持し、`publication-redactions.json` に元データと公開用表現のhashを区別する。
`pins.json` と入力監査の元hash・完全一致判定は実行時の非公開原本を指す。
モデルとspecの対象内容・証拠の3版・実行結果は公開用変更の対象にしていない。
