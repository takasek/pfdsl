# Claude の追加評価

2026-10-28 の独立レビュー。評価者の自己記録では Claude Opus 5.5。
pfdsl の対象版は Astra・Sol と同じ `d1b5db85ecdb9344a5ed6fff2f1b17632a8ec6e6`。
[原報告の保存版](review.md)には A1〜A7 と M1〜M4、観察の種類、提案、未確認範囲を残した。
重要度は A1→A3→A2→A4→A5→A6→A7、推奨着手順は A3 を先とする評価者の提案で、統合分析の採用順ではない。

## 環境と確認条件

- macOS 27.2（26B123）、Node v26.12.1、pnpm 10.33.2、rustc 1.99.0と自己記録している。Astra・Sol のOS記録とは異なる。
- ネイティブは release app。識別子だけをビルド時に変更し、背景操作で評価した。
- Open パネルを完遂できず、評価用の Recent 一覧を事前作成してファイルを開いた。通常の初回 Open 動線の成功とは扱わない。
- 保存・再編集・外部変更・衝突確認・閉じる確認・大きい図・Find・splitter・sidebar・縮小ウィンドウを操作したと記録している。
- F1／F8／hover／右クリックと700px幅はブラウザで確認。ネイティブの F キー・ショートカットの成功に読み替えない。
- 起動前に standalone README の見出し・1〜58行、操作後に59〜131行・272〜400行を読んだ。過去の評価本文は読んでいないと報告している。
- HIG は menu bar／alerts／keyboards／windows／sidebars の本文に照合したと報告している。Typography は参照パックの要約経由で、取得本文との照合ではない。

## 保存根拠と限界

位置範囲の静的集計、typo 前後の CLI 診断を evidence に保存した。
画像はローカル原本に保持し、公開コピーには含めていない。
本保存作業で製品の新たな実操作や OS の再測定は行っていない。
Save As、ネイティブの Open/Save パネル、⌘操作、Fキー、hover、IME、VoiceOver、Quit、Export、Finder からの起動は未確認。
アプリの評価用データと他者の checkout は変更・削除していない。
