# 再現手順と証拠

> アーカイブ注記（2026-09-10）: この文書は固定コミット `827bcb1cb96238f918dad84dc6453176f131e029` を対象にした当時の監査記録であり、現行の不具合一覧や実装計画ではない。
> 最新の対応状況と残件は [#1055](https://github.com/takasek/pfdsl/issues/1055)、CLI 0.0.26 の公開完了記録は [#1138](https://github.com/takasek/pfdsl/issues/1138) を参照する。
> 観測・評価・提案は当時の内容を保持し、個人環境を含むパス表記は公開用の例示パスへ置換した。
> Markdown リンクは、このアーカイブ内の相対参照または監査対象コミットへの固定参照へ置き換えた。

## アーカイブの読み方（2026-09-10）

[source-manifest.json](source-manifest.json) は、当時の原本ファイル名・サイズ・SHA-256 を記録した目録を内容そのまま保存したものである。
[manifest.json](manifest.json) は、このアーカイブのルートを基準に、公開用のパス置換後のファイル名・サイズ・SHA-256 を記録する。
自身を除く納品ファイルを含み、原本の目録も対象とする。
3 本の baseline ログは個人環境のパスを置換し、保存名を `.log` から `.log.txt` に変更した。
7 個の `.pfdsl` fixture は意図的な不正入力・出力も含む履歴資料のため、有効なサンプルとして文書検査されないよう、内容を変えず `.pfdsl.txt` として保存した。
8 本の再現スクリプトも検出用の反例文字列を含む履歴資料のため、現役ソースの検査対象と区別し、個人環境のパスを置換して `.mjs.txt` として保存した。
原本のファイル名を復元して使う場合は、コピー先で末尾の `.txt` を取り除く。
スクリプトを実行するときも `.mjs` に戻し、以下の固定コミットと実験用パスの条件を満たしてから使う。
本文の「納品時点」は当時の原本を指し、[verification.json](verification.json) も当時の検証結果を保持している。
アーカイブ時の構文・参照・同一性の確認は、製品挙動の再実行を意味しない。

再現スクリプト、結果 JSON、ログ、本文の環境依存パスは、`/path/to/pfdsl`、`/path/to/codex/bin`、`/tmp/pfdsl-audit` へ置換している。
これらは例示パスであり、元の個人環境を示すものではない。
パス以外の観測値と反例は保持している。
`source-manifest.json` は非公開原本の識別用であり、公開ファイルとのバイト一致を示さない。
公開ファイルの整合確認には `manifest.json` を使う。
再実行する場合は、監査対象の固定コミットを別 checkout に用意して build し、コピーしたスクリプト内の入力 checkout と出力 scratch のパスをその環境に合わせて変更する。
現在の checkout をそのまま使うと、当時と異なる実装を測定し、既存の一時成果物を上書きする可能性がある。
反例 fixture と誤挙動を assert する箇所は、保存のために現行の正しい挙動へ書き換えていない。

## 以下は当時の記録

対象 commit は `827bcb1cb96238f918dad84dc6453176f131e029`。
元 checkout は `/path/to/pfdsl`、合成 fixture の保存先は `/tmp/pfdsl-audit`。
ここに保存したスクリプトは元 checkout の実装を絶対パスで読み、同セッションの一時ディレクトリにだけ実験結果を書く。
異なる場所で再実行する場合は、その2つの path 定数を新しい専用 checkout と空の一時ディレクトリへ変更し、必要な出力サブディレクトリを用意する。
build 済み dist と checkout の依存が前提となる。
製品ファイルを変更するスクリプトではなく、issue/PR の外部 I/O を行うスクリプトでもない。

スクリプトの成功は「現状の誤挙動を観測した」という意味を含む。
修正後の回帰テストへ移すときは、バグの現状を assert する箇所を正しい期待に変更する必要がある。
元実験の結果 JSON は読み戻しと比較用に保存した。

| スクリプト | 対応所見 | 実行方法と限界 | 結果 |
|---|---|---|---|
| [core-cli/reproduce.mjs.txt](core-cli/reproduce.mjs.txt) | C1/C2/C3 | 実 core/CLI の公開関数、合成ファイルと stdin | [JSON](core-cli/results.json) |
| [core-cli/cli-boundary-probe.mjs.txt](core-cli/cli-boundary-probe.mjs.txt) | C1/R1 | 実 CLI executable の fmt 書込みと diff text/DOT、scratch のみ | [JSON](core-cli/cli-boundary-results.json) |
| [core-cli/presentation-probe.mjs.txt](core-cli/presentation-probe.mjs.txt) | C4 | 実 presentation 解決、in-memory DAG。時間は1回観測 | [JSON](core-cli/presentation-results.json) |
| [render-editor/reproduce.mjs.txt](render-editor/reproduce.mjs.txt) | R1/R2/R3 | 実 source を esbuild でメモリ内 bundle、VS Code API mock、jsdom、Graphviz 初期化 Promise の遅延。実 extension host ではない | [JSON](render-editor/results.json) |
| [distribution/reproduce.mjs.txt](distribution/reproduce.mjs.txt) | D1/D2 | 実 deploy/lock/rollback と scratch。別 writer の publish を decoder 境界へ注入し、一つの実行順を再現 | [JSON](distribution/results.json) |
| [governance/probe.mjs.txt](governance/probe.mjs.txt) | G1 | 実 pure modules と未 export consumer 関数のソース抽出、合成 issue。before/after も同フォルダに保存 | [JSON](governance/results.json) |
| [governance/gate-probe.mjs.txt](governance/gate-probe.mjs.txt) | G2/G3/G4 と設計懸念 | 実 helper、workflow YAML、filesystem fixture。command executor は記録 stub。GitHub I/O は呼ばれれば失敗する設定 | [JSON](governance/gate-results.json) |
| [governance/checker-probe.mjs.txt](governance/checker-probe.mjs.txt) | G5/G6 | 実 detector/gate に文字列 fixture を渡す。fixture 中の shell command 自体や commit は実行しない | [JSON](governance/checker-results.json) |

同じ checkout で1本を再実行する例:

```sh
node /path/to/pfdsl/audit-2026-09-08/evidence/core-cli/cli-boundary-probe.mjs
```

通常のテスト、typecheck、文書検査の全ログもこのディレクトリに保存した。
`manifest.json` は納品時点の監査資料・証拠の path、サイズ、SHA-256 を記録する。
製品の runtime integrity を証明するものではなく、報告書と観測結果の組を識別するための目録である。
