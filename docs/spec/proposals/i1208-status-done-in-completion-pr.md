# status の値が示す状態と、PR で統合する工程での done の更新時点 (#1208)

## 対象仕様バージョン

v0.0.24 → v0.0.25

## 概要

§2.7.1 は `wip` の例を「ブランチ・PR がオープン」、`done` の例を「main にマージ済み」と書いていた。
#1208 R6b で GitHub Issues バックエンドを採用した採用側の実サイクルを2回実施したところ、どちらの回も出力 artifact を `wip` のまま PR にし、PR 本文に「main にマージされるまで wip を維持する」と書いた。
配布の pfdsl SKILL の凡例もこの例と同じ趣旨（`wip=生産中（ブランチ/PR open）| done=main済み`）だった。
一方、pfd-ops の work-cycle は「作業完了時の status 更新は完了コミットと同時に行う」を既定とする。
例の読み方に従うと、merge 後に `done` を付ける主体が無い。完了チェーンの回収は `done` を付けず、GitHub Issues バックエンドは issue の close を status 更新の契機にしない。
その結果、merge 後の main に `wip` が残り、完了チェーンも回収されない。
上流の pfdsl リポ自身は、完了の PR の中で `done` にしている。

## 仕様変更

### §2.7.1 status

- `wip` の例を「作業ブランチで生産中」、`done` の例を「完了した変更が main に統合された状態」に改める。
- 次の項を追加する。値は、そのファイルを含むツリーが示す状態である。複数のツリーがある場合は統合先（例: main）のツリーの値を正とする。変更を PR で統合する工程では、完了の変更と同じ PR に含められるなら、その PR の中で `done` に更新する。PR がオープンの間、統合先の値はまだ `done` にならず、merge によって `done` になる。成果物が別のリポジトリにある場合など同じ PR に含められないときは、完了の変更が統合された後に、`done` への更新を統合先へ統合する。

列挙値、`status:` を書ける種別、診断は変えない。

## 設計判断

- **完了の PR の中で `done` にする（採用）**: 上流リポの運用と work-cycle の既定に一致し、merge の時点で統合先の値が `done` になる。新しい自動化や手順を要しない。所有者が選んだ。
- **PR では `wip` を保ち、merge 後に自動化で `done` にする（不採用）**: GitHub Issues バックエンドの「issue の close は status を動かす契機にしない」と衝突する。統合先へ自動コミットする処理を新たに持つことにもなる。どのバックエンドもその自動化を定義しておらず、採用先ごとに連携と bot の書込みを用意する必要がある。
- **凡例と work-cycle だけを直し、仕様の例は残す（不採用）**: 配布物は仕様書も `references/spec.md` として同梱するため、仕様を読んだ採用側で同じ誤読が残る。

## 影響範囲

- `docs/spec/spec.md` §2.7.1 とタイトル行、`docs/spec/spec-history.md`
- 生成元 `scripts/skill-template/SKILL.md` の status 凡例と、その生成物（配布 pfdsl SKILL、`references/spec.md`）
- `.claude/skills/pfd-ops/references/work-cycle.md` の「進捗と完了根拠」と、その生成コピー
- 実装コード・診断・CLI の挙動は変わらない
