CLI meta create 体験レビュー

対象: <checkout>/packages/cli/dist/cli.js（--version: 0.1.0）。利用者ドキュメント packages/cli/README.md:71-88 と docs/migration-guide.md:72-80、CLI help、実 CLI の実行結果だけを使用した。実装ソース、設計記録、git diff は未読。

結果: 独立した受入シナリオ 28 件中 27 件が通過し、回復コマンドのコピー実行に 1 件の failure を確認した。初回探索で基準を修正したケースと共有 fixture の影響を受けたケースはこの件数から除外し、失敗系を別 fixture で再実行した。

[P2] 空白を含むファイル名で、meta set が提示する回復コマンドをコピーすると回復できない。
入力は body-only artifact output を含む team report.pfdsl に対する meta set ... output label 'Output report' --json。exit 1 の JSON error は「Run pfdsl meta create <temporary>/pfdsl-cli-experience-01a10a12-g815l29a/team report.pfdsl output status=todo --write before using meta set.」と表示する。
その表示を shell と同じ引数分割でコピー実行すると、meta create は exit 2、stdout は空、stderr は「meta create: expected field=value, got 'output'」になった。元ファイルの SHA-256 と内容は不変。
同じ path を単一引数として引用した create に criteria=Reviewed を追加すると exit 0 / created:true / written:true となり、その後の meta set retry も exit 0 で label が更新された。
原因の実装は未読。利用者に提示するファイルパスの引用が必要であることは、表示文字列と実 CLI の拒否で確認した。
証拠は evidence.json の spaced-path-meta-set-recovery、copied-spaced-path-recovery、quoted-spaced-path-recovery、spaced-path-meta-set-retry。該当 fixture の作成前後の全文、stdout、stderr、exit、SHA-256 を記録した。

通過した体験: body-only artifact と process の種別推論、frontmatter がない図への定義作成、初期 label/status/criteria、comma と追加の =、text preview と JSON preview の一致、preview の source 不変、write JSON の created/written/line、meta get での正確な読戻し、meta set の回復後更新、実 checker の diagnostics 空、CRLF/コメント/引用符/folded breaks/本文の保存。
通過した拒否系: 既存定義、存在しない ID、roadmap artifact の status 欠落、unknown field、既知フィールドの誤った kind、invalid status、duplicate field、collection field、process status、workflow status、曖昧 role、duplicate YAML。拒否時は元ファイルの全 bytes が不変。--allow-unknown で extension scalar を明示追加でき、日付値が文字列として読める。

非 failure の観測: produced artifact に status だけで create すると成功し、後続 check は criteria 欠落を W002 warning として返した。README の「result with error diagnostics」を拒否する説明には反しない。回復コマンドを実行した後でも必要な criteria は利用者が追加する。

未確認: VS Code/web の host UI、Windows path/複数の shell、公開 package の install、symlink、duplicate mapping 以外の YAML 構造。実装・git metadata・外部公開への書込みは行っていない。

一時証拠: <temporary>/pfdsl-cli-experience-01a10a12-g815l29a/evidence.json。初回探索は results.json、分離再実行は followup-results.json に保持した。
