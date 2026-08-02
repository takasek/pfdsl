---
name: distribution-review
description: |
  Use before a CLI release, or after changing anything that ships in
  plugin/pfdsl/, to review the distributed prompts as an adopting repo's
  reader would. Simulates that reader with sandboxed subagents given only the
  bundle, fixes what makes them stall, and records the reviewed commit that
  `make release` gates on. Invoke when `make release` refuses with "the
  distributed prompts have changed since their last review", when release-status
  shows unreviewed files, or when asked to audit the bundle for upstream-only
  assumptions. Perspectives live in docs/distribution-review.md.
---

# 配布プロンプトのレビュー

配布 bundle に混入する「上流リポの文脈でしか意味を持たない記述」を、**利用側の読み手を実際に走らせて**検出する。
観点カタログは `docs/distribution-review.md`（一次情報）。
机上で観点を当てるだけでは足りない — このクラスの欠陥は、読み手が実際にその行を頼りに作業して初めて行き止まりとして現れる。

## 2つのモード

| | 差分モード（既定） | 全文モード（手動起動のみ） |
|---|---|---|
| 対象 | 前回承認 commit からの差分 | 配布ツリー全文（22ファイル・約1,000行） |
| hash | **更新する** | **更新しない** |
| 起動 | `make release` が要求する / 配布層を触った後 | 人が明示的に頼んだときだけ |

全文モードが hash を進めないのは、全体を見る分ひとつの変更に対する解像度が差分モードに劣るため。
これで承認済みとすると、差分観点の穴を見逃したまま記録だけが進む。
全文モードで直したものは未レビュー差分として残り、次の差分モードが必ず拾う。

## 手順

### 1. 対象を出す

```sh
node -e 'import("./scripts/lib/distribution-review.mjs").then((m)=>{
  const r=m.runDistributionReviewCheck(m.repoDeps(process.cwd()));
  console.log(r.base);console.log(r.files.join("\n"));
})'
```

ゲートと同じ関数を通す。
別に書くと、レビューが見た集合とリリースが止まる集合がずれる。

`reviewed.json` の `commit` が `null` のときは base が git の空ツリーになり、差分＝配布ツリー全体になる。
初回は特別扱いせずこのまま回せばよい。
全文モードのときは差分でなく `git ls-files plugin/pfdsl/**/*.md` を `inScope` で絞ったものを対象にする。

### 2. 課題を組む

**観点を subagent に渡すのではない。** 渡すのは「利用側リポのメンテナが実際にやる作業」で、観点は詰まりを分類するときに自分（メイン agent）が使う。

課題の条件:

- **変更箇所を通らないと完了しない**こと。差分がどの能力の記述に当たるかを見て、その能力を使わせる課題にする（例: L4 滞留監査の記述を触ったなら「companion に汎用ルールらしき記述を見つけた。昇格先を決めて実行せよ」）
- **完遂を目的にしない**。詰まりの観測が目的なので、途中で止まってよいと明示する
- 1課題 = 1 subagent。差分が複数の能力にまたがるなら課題を分ける

### 3. sandbox を実体化する

```
<scratch>/adopt-<timestamp>-<課題名>/
  repo/                 ← git init。README + 最小の .pfdsl
  plugin-cache/pfdsl/   ← plugin/pfdsl のコピー
```

**1 probe = 1 sandbox。** 複数の probe に同じ sandbox を共有させない。
probe は実際にファイルを書くので、共有すると互いの編集が相手の入力になり、詰まりが配布物由来なのか他の probe の書き込み由来なのか切り分けられなくなる。

subagent には cwd を `repo/`、plugin root を `../plugin-cache/pfdsl` とだけ伝え、**上流リポの存在を伝えない**。
このリポのパスを読もうとすれば実際に存在しないので、行き止まりが自然に再現する。

これは ADR-0029 の Limitations が記録した制約への対処。
`Agent` ツールで起動した fresh subagent は skill の解決先が呼び出し元 worktree に紐づくため、「plugin だけを渡された読者」を指示だけでは再現しきれない。

### 4. subagent を走らせる

`general-purpose` を使う。
ブリーフに入れるもの: 課題・cwd・plugin root・「詰まったら何を読んで何が解決できなかったかを報告せよ」・「完遂は目的でない」。
入れないもの: 観点カタログ・上流リポの存在・この検査を回している事実。

### 5. 越境を事後検出する

報告に sandbox 外の痕跡が出ていないか確認する:

- このリポの絶対パス
- `plugin/pfdsl/...` という相対形（sandbox 内では `plugin-cache/pfdsl/...`）
- `.claude/skills/pfd-*` の実体を読んだ形跡

出ていたらその probe は**無効**。ブリーフを締め直して回し直す。
越境した probe は「利用側の読み手」ではなく上流の読み手なので、その報告で pass を出すと検出力が落ちたことに気付けない。

### 6. とりまとめる

詰まりを3つに分類する。

| 分類 | 対応 |
|---|---|
| (a) 配布プロンプトの欠陥 | canonical 側を直す（7へ） |
| (b) 課題設計の不備 | 課題を組み直して回し直す |
| (c) 環境制約 | 実行記録に残す。配布物は直さない |

(a) と (c) の切り分けを雑にしない。
「plugin cache のパスが分からなかった」は (c) に見えて (a) のことがある — 配布物が自分の在り処を説明していないなら、それは配布物の欠陥。

### 7. 直す

修正先は canonical。
配布パスからの対応は `canonicalSourceOf`（`scripts/lib/distribution-review.mjs`）が持っている:

```sh
node -e 'import("./scripts/lib/distribution-review.mjs").then(m=>console.log(m.canonicalSourceOf("plugin/pfdsl/skills/pfd-retro/SKILL.md")))'
```

直したら `make gen-plugin` で配布ツリーを再生成する。

### 8. 詰まりが消えたことを確認する

該当課題を新しい sandbox で回し直し、同じ場所で止まらないことを見る。
**ここまでがこのスキルの責務**。findings を出して止まるのではなく、修正の完了までを持つ。

### 9. 記録する

1. 実行記録 `docs/distribution-review/<YYYY-MM-DD>-<diff|full>.md` を書く。組んだ課題・各 probe の詰まり・分類・対応・越境の有無
2. 再発しうる型として一般化できた詰まりを `docs/distribution-review.md` の「教訓」へ昇格する。昇格したことを実行記録側にも書く
3. **差分モードのときだけ** `reviewed.json` を更新する:
   ```json
   { "commit": "<HEAD の40桁 sha>", "date": "<YYYY-MM-DD>", "log": "<記録ファイル名>" }
   ```
4. `node scripts/check-distribution-review.mjs` が exit 0 になることを確認してコミットする

記録用のコミットは配布プロンプトを触らないので、hash が指す内容と HEAD の内容は一致したままになる。

## このスキルを配布しない理由

利用側リポは何も配布しないので、この手順には実施先がない。
`assemblePluginDistIndependent`（`scripts/lib/gen-plugin.mjs`）のスキル列挙に載せなければ配布されない — `spec-stress-test` / `vscode-ext-debug` と同じ扱い。
