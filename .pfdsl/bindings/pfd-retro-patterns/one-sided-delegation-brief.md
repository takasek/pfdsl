---
tags: [target:prose-doc, method:delegate]
phase: pre-artifact
---

- **委譲ブリーフの片肺 trap**: companion `.md` の記述更新を委譲するとき、同じ事実を述べる sibling `.pfdsl` のノード description をブリーフに含めないと、委譲先は指示された `.md` 側だけを直して戻る。
  委譲先に落ち度はない — ブリーフが片肺だったのであり、成果物レビューでも「指示通り」に見える。
  問いの形: 「このブリーフが更新を指示している散文は、同じ事実を述べるノードの description・criteria を図の側にも持っていないか」。
  具体例: `.svg` のドリフト検査機構を変えた回で、ブリーフは `.pfdsl/roadmap.md` と `.pfdsl/workflow.md` の該当記述を名指ししたが、同じ検査機構を述べる `pipeline.pfdsl` の `sample_previews.description` を含めていなかった（終端ゲートの「変換コンポーネント反映」項目で捕捉、#588）。
  対策: 委譲ブリーフに companion `.md` の編集が含まれる場合、sibling `.pfdsl` を `graph neighbors` で引いて該当ノードをブリーフに列挙する。ゲート側は既に捕捉できるので機構の追加は不要 — ブリーフ作成時の手順として持つ。
