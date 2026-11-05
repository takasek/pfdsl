# Format 3 controlled same-prompt comparison

## Evidence boundary

The historical observation reported that one of five responses was decision-first and four began with premise inspection.
The original task payload in the retained logs is encrypted, so that historical 1/5 is provenance-limited reference evidence and is not the direct comparator in this report.
This report instead compares newly generated old-contract and current-contract cohorts under one frozen prompt and runtime.

The classifier is deliberately narrow: PASS if and only if a concrete selected or current implementation decision appears before any detailed premise test or candidate disposition.
An empty heading or non-concrete preface is not a decision.
This classifier measures reading order only; it does not prove semantic validity, candidate completeness, or correctness of the proposed design.
The controller used the classifier and runtime stated here during execution.
This durable report was assembled afterward and does not independently prove preregistration of the classifier, prompt, or runtime, nor their timing relative to the runs.
Its preserved inputs, responses, and exact classifier allow a third party to reproduce the classifications.

## Frozen protocol

The reconstructed scenario uses only facts common to all five historical responses: exactly one description names `workflow.pfdsl`; the target node exists only in authoritative `pipeline.pfdsl`; the bounded change corrects that stale reference; and no node move, duplication, or structural change is requested.

All ten runs used model `gpt-5.6-luna`, reasoning `medium`, and `fork_turns=none`.
Each run was instructed to read only its frozen work-cycle as its sole operational source and not to inspect any other file, response, report, Git history, or task context, write files, or perform Git or external operations.
The comparison is retrospective remediation for evidence omitted from the original rollout and did not gate the earlier `done` transition or downstream readiness.

Old contract commit: `d819c1f65ceb3aa09891e29e5fac64ab2c903a5a`.
Old source: `/tmp/pfdsl-issue1091-old-contract-20260905/.claude/skills/pfd-ops/references/work-cycle.md`.
Old source SHA-256: `f538623ea8ee0530ac205cc2bc9608082c99b9115165b03014a907c8b38cc5f7`.

Current contract commit: `266d2437f0f8e8dfd5b8ac9139ba4b7214b900e6`.
Current source: `.claude/skills/pfd-ops/references/work-cycle.md`.
Current source SHA-256: `35531554d5f4475aa810bd5c5adfdb5507c5f6c8e0db999d4af56f2fb0642376`.

## Controlled runs

Each prompt below uses this exact wrapper, with only the run ID and source path substituted:

```text
You are independent controlled-comparison run <ID>. Use a read-only tool to read only `<source path>`; it is your sole operational source. Do not inspect any other file, response, report, Git history, or task context. Do not edit files or perform Git/external operations. Then respond exactly as you would to the scenario below before implementation; include the complete design response and approval request, with no meta-commentary about this experiment.

Scenario: A documentation audit found exactly one description that names `workflow.pfdsl`, while the node it directs readers to exists only in `pipeline.pfdsl` and `pipeline.pfdsl` is authoritative for that node. The requested bounded change is to correct that stale file reference. No node move, duplication, or other structural change is requested.
```

### OLD-1 — PASS

Full prompt:

```text
You are independent controlled-comparison run OLD-1. Use a read-only tool to read only `/tmp/pfdsl-issue1091-old-contract-20260905/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not inspect any other file, response, report, Git history, or task context. Do not edit files or perform Git/external operations. Then respond exactly as you would to the scenario below before implementation; include the complete design response and approval request, with no meta-commentary about this experiment.

Scenario: A documentation audit found exactly one description that names `workflow.pfdsl`, while the node it directs readers to exists only in `pipeline.pfdsl` and `pipeline.pfdsl` is authoritative for that node. The requested bounded change is to correct that stale file reference. No node move, duplication, or other structural change is requested.
```

Full response:

```text
調査結果から、当該記述の参照先だけを `workflow.pfdsl` から `pipeline.pfdsl` へ修正します。ノードの移動・複製・構造変更は行いません。

前提: `pipeline.pfdsl` が当該ノードの authoritative location として存在し続けることを前提にする。

否定案: `pipeline.pfdsl` を authoritative location としない構成へ変更する案。これは所有者が定めた authoritative location と衝突し、参照先の曖昧さを生むため却下する。

競合実装案: ファイル名を削除し、「authoritative definition」を指す一般表現へ置換する案。具体的な参照先が失われ、読者の到達性が下がるため却下する。

採用案: stale reference を含む1箇所の記述を、同じノードを authoritative に保持する `pipeline.pfdsl` への参照へ修正する。変更前の不整合は1件、変更後は0件とする。

この設計で実装してよければ承認してください。
```

Order evidence: the first paragraph concretely selects the reference correction before the first inspection marker `前提:`.

### OLD-2 — FAIL

Full prompt:

```text
You are independent controlled-comparison run OLD-2. Use a read-only tool to read only `/tmp/pfdsl-issue1091-old-contract-20260905/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not inspect any other file, response, report, Git history, or task context. Do not edit files or perform Git/external operations. Then respond exactly as you would to the scenario below before implementation; include the complete design response and approval request, with no meta-commentary about this experiment.

Scenario: A documentation audit found exactly one description that names `workflow.pfdsl`, while the node it directs readers to exists only in `pipeline.pfdsl` and `pipeline.pfdsl` is authoritative for that node. The requested bounded change is to correct that stale file reference. No node move, duplication, or other structural change is requested.
```

Full response:

```text
前提: 本案は、`workflow.pfdsl` を参照する説明が1件だけ残り、対象ノードの正本が `pipeline.pfdsl` に存在し続けることを前提にする。

否定案: 参照を修正せず、`workflow.pfdsl` 側へノードを移動または複製して現状の説明を成立させる。

却下理由: `pipeline.pfdsl` が対象ノードの権威ある所有先であり、別ファイルへの移動・複製は正本を増やしてドリフト経路を作るため採用しない。これは今回の作業者の都合ではなく、既存の正本所有に基づく制約である。

設計案:

- 採用: stale な説明中のファイル参照だけを `workflow.pfdsl` から `pipeline.pfdsl` へ修正する。
- 却下: ノードの移動、複製、構造変更。対象ノードの正本と構造は変更しない。
- 却下: 参照を残す。修正後も誤ったファイルへ読者を誘導するため、監査で発見された不整合が解消されない。

変更範囲は、該当する説明1件の参照文字列に限定する。受け入れ基準は、説明が `pipeline.pfdsl` の対象ノードを指すこと、`workflow.pfdsl` への当該 stale reference が残らないこと、ノードの移動・複製その他の構造変更が発生しないこととする。

この設計で実装に進めてよいですか？
```

Order evidence: the response starts with `前提:`; the first concrete selected decision appears later under `設計案:`.

### OLD-3 — FAIL

Full prompt:

```text
You are independent controlled-comparison run OLD-3. Use a read-only tool to read only `/tmp/pfdsl-issue1091-old-contract-20260905/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not inspect any other file, response, report, Git history, or task context. Do not edit files or perform Git/external operations. Then respond exactly as you would to the scenario below before implementation; include the complete design response and approval request, with no meta-commentary about this experiment.

Scenario: A documentation audit found exactly one description that names `workflow.pfdsl`, while the node it directs readers to exists only in `pipeline.pfdsl` and `pipeline.pfdsl` is authoritative for that node. The requested bounded change is to correct that stale file reference. No node move, duplication, or other structural change is requested.
```

Full response:

```text
前提: `workflow.pfdsl` を指す記述が誤ったまま残り、読者が権威あるノードへ到達できない状態が存在し続ける。

設計案:

- 案A（採用）: 該当する1件の記述だけを修正し、参照先を `pipeline.pfdsl` に変更する。ノードの移動・複製・構造変更は行わない。
- 否定案: 何も変更せず、現状の参照を維持する。監査で誤参照が確認済みであり、読者の誤誘導が残るため却下する。
- 競合実装案: `workflow.pfdsl` 側に注記やリダイレクト説明を追加する。所有者が `pipeline.pfdsl` を権威ある定義としているため、誤った参照を残すこの案は却下する。

対象は stale reference の単純な文言修正1件に限定する。変更後は、該当記述が `pipeline.pfdsl` を指すこと、ノードの移動・複製がないこと、変更対象の `.pfdsl` が検査を通過することを確認する。

この設計で実装を開始してよいですか？
```

Order evidence: the response starts with `前提:`; the selected `案A` appears afterward.

### OLD-4 — FAIL

Full prompt:

```text
You are independent controlled-comparison run OLD-4. Use a read-only tool to read only `/tmp/pfdsl-issue1091-old-contract-20260905/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not inspect any other file, response, report, Git history, or task context. Do not edit files or perform Git/external operations. Then respond exactly as you would to the scenario below before implementation; include the complete design response and approval request, with no meta-commentary about this experiment.

Scenario: A documentation audit found exactly one description that names `workflow.pfdsl`, while the node it directs readers to exists only in `pipeline.pfdsl` and `pipeline.pfdsl` is authoritative for that node. The requested bounded change is to correct that stale file reference. No node move, duplication, or other structural change is requested.
```

Full response:

```text
前提: `pipeline.pfdsl` が対象ノードの権威ある定義として存続すること。

否定案: `pipeline.pfdsl` の権威性を廃止し、対象ノードを `workflow.pfdsl` へ移す。

競合実装案: ファイル名を記載せず、対象概念のみを説明する。

設計判断:

- 採用: stale な1件の参照先を `workflow.pfdsl` から `pipeline.pfdsl` へ訂正する。
- 却下: ノードの移動・複製。ユーザーが構造変更を求めていないため。
- 保留: ファイル名を除去する案。読者を権威ある定義へ直接誘導できず、今回の問題を確実に解消する根拠が弱い。

変更範囲は、該当する description のファイル参照1箇所だけとする。ノード、PFD 構造、リンク、生成方式は変更しない。症状指標は、誤った `workflow.pfdsl` 参照を含む description を変更前1件・変更後0件とする。

この設計で実装に進めてよいですか？
```

Order evidence: `前提:`, `否定案:`, and `競合実装案:` precede the first selected decision under `設計判断:`.

### OLD-5 — FAIL

Full prompt:

```text
You are independent controlled-comparison run OLD-5. Use a read-only tool to read only `/tmp/pfdsl-issue1091-old-contract-20260905/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not inspect any other file, response, report, Git history, or task context. Do not edit files or perform Git/external operations. Then respond exactly as you would to the scenario below before implementation; include the complete design response and approval request, with no meta-commentary about this experiment.

Scenario: A documentation audit found exactly one description that names `workflow.pfdsl`, while the node it directs readers to exists only in `pipeline.pfdsl` and `pipeline.pfdsl` is authoritative for that node. The requested bounded change is to correct that stale file reference. No node move, duplication, or other structural change is requested.
```

Full response:

```text
前提: 本案は、参照対象ノードが `pipeline.pfdsl` にのみ存在し、今後も `pipeline.pfdsl` がそのノードの authoritative source であり続けることを前提にする。

否定案: `workflow.pfdsl` をそのノードの authoritative source に変更し、対象ノードを移動する。

競合実装案: ノードを移動せず、`workflow.pfdsl` 側に同一ノードを複製して双方から参照できるようにする。

案の処分:

- `pipeline.pfdsl` を指すように stale な description のファイル参照だけを修正する — 採用。
- `workflow.pfdsl` を authoritative source に変更してノードを移動する — 却下。`pipeline.pfdsl` が authoritative であるという所有権と矛盾し、ノードの所在と権威を変更する。
- `workflow.pfdsl` にノードを複製する — 却下。単一の authoritative source という所有権を壊し、二重管理による drift 経路を作る。

実施内容は、該当する description 中の `workflow.pfdsl` というファイル参照を `pipeline.pfdsl` に置換する一点に限定する。ノードの移動・複製・構造変更は行わない。

この設計で実装へ進めてよいですか？
```

Order evidence: `前提:`, `否定案:`, and `競合実装案:` precede the first selected disposition under `案の処分:`.

### NEW-1 — PASS

Full prompt:

```text
You are independent controlled-comparison run NEW-1. Use a read-only tool to read only `/Users/m5/works/pfdsl/.worktrees/issue-1091-comparable-reader-evidence/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not inspect any other file, response, report, Git history, or task context. Do not edit files or perform Git/external operations. Then respond exactly as you would to the scenario below before implementation; include the complete design response and approval request, with no meta-commentary about this experiment.

Scenario: A documentation audit found exactly one description that names `workflow.pfdsl`, while the node it directs readers to exists only in `pipeline.pfdsl` and `pipeline.pfdsl` is authoritative for that node. The requested bounded change is to correct that stale file reference. No node move, duplication, or other structural change is requested.
```

Full response:

```text
設計記録形式: 3

決定:
- description の参照先（実装）: `workflow.pfdsl` を `pipeline.pfdsl` に訂正する。対象 description 以外は変更しない。
- ノード配置（実装しない）: 対象ノードは authoritative source である `pipeline.pfdsl` に残す。移動・複製・構造変更は行わない。
- 検証（調査のみ）: 変更後、description の参照先が `pipeline.pfdsl` になっていることと、構造変更がないことを確認する。

理由:
- description の参照先（実装）: 読者を対象ノードの authoritative source へ導くため。
- ノード配置（実装しない）: ノードの所有元を維持し、依頼された bounded change の範囲を守るため。
- 検証（調査のみ）: stale reference の解消と変更範囲を確認するため。

案の処分:
- 採用 — 元候補「stale file reference の訂正」— `workflow.pfdsl` を `pipeline.pfdsl` に変更する。
- 却下 — 元候補「ノードを workflow.pfdsl へ移動」— authoritative source と異なる配置になり、依頼された参照訂正を超えるため。
- 却下 — 元候補「ノードを workflow.pfdsl に複製」— 二重管理を生み、authoritative source を一意に保てないため。

前提検査 P1:
対象: 対象ノードの authoritative source と参照先。
前提: 本案は対象ノードの authoritative source が `pipeline.pfdsl` であり続ける状態を前提にする。
前提を外した案: authoritative source が `workflow.pfdsl` へ移る場合は、description の参照訂正ではなくノード移動と関連リンクの再設計を行う。
既存候補との差分: 移動案は参照文字列だけでなくノード配置と構造を変更する。
検査案の処分 P1: 却下 — 今回の前提は成立しており、依頼でもノード移動・複製・構造変更を除外しているため。

改訂履歴:
- なし

この設計で実装に着手してよいですか？
```

Order evidence: `決定:` contains concrete correction bullets before `案の処分:` and `前提検査 P1:`.

### NEW-2 — PASS

Full prompt:

```text
You are independent controlled-comparison run NEW-2. Use a read-only tool to read only `/Users/m5/works/pfdsl/.worktrees/issue-1091-comparable-reader-evidence/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not inspect any other file, response, report, Git history, or task context. Do not edit files or perform Git/external operations. Then respond exactly as you would to the scenario below before implementation; include the complete design response and approval request, with no meta-commentary about this experiment.

Scenario: A documentation audit found exactly one description that names `workflow.pfdsl`, while the node it directs readers to exists only in `pipeline.pfdsl` and `pipeline.pfdsl` is authoritative for that node. The requested bounded change is to correct that stale file reference. No node move, duplication, or other structural change is requested.
```

Full response:

```text
設計記録形式: 3

決定:

- 参照先修正（実装）: `workflow.pfdsl` を指している唯一の stale な description を、対象ノードを実際に所有する `pipeline.pfdsl` への参照へ修正する。
- 構造変更（実装しない）: ノードの移動、複製、追加、削除は行わない。
- 検証（調査のみ）: 修正前後で stale な参照が解消され、`pipeline.pfdsl` の権威性と既存ノード構造が維持されることを確認する。

理由:

- 参照先修正: 読者を対象ノードの権威ある定義へ導き、誤誘導を解消する。
- 構造変更: ノードは `pipeline.pfdsl` にのみ存在し、同ファイルが権威あるため、構造を変えず所有関係を維持する。
- 検証: bounded change の範囲を超える移動・複製や別の stale reference を混入させず、目的達成を確認する。

案の処分:

- 採用 — 元候補「stale なファイル参照を `pipeline.pfdsl` に修正」— 唯一の不整合を直接解消し、ノード所有者を変更しない。
- 却下 — 元候補「ノードを `workflow.pfdsl` へ移動」— `pipeline.pfdsl` が当該ノードの権威ある所有者であり、所有関係を変更するため。
- 却下 — 元候補「ノードを両ファイルへ複製」— 権威ある定義を二重化し、将来の内容乖離を生むため。
- 採用 — 元候補「何もしない」— 比較対象として扱うが、stale reference による読者の誤誘導を残すため不採用とする。

前提検査 P1:

対象: `pipeline.pfdsl` の権威性。

前提: 本案は対象ノードの権威ある定義が `pipeline.pfdsl` に存在し続けることを前提にする。

前提を外した案: `pipeline.pfdsl` が権威ある定義でないなら、所有ファイルを再決定し、参照修正だけでなくノード所有関係の再設計を行う。

既存候補との差分: 既存候補はいずれも `pipeline.pfdsl` の権威性を前提としているため、所有関係を再決定する案は別クラスである。

検査案の処分 P1: 保留 — `pipeline.pfdsl` の権威性が否定される証拠が出た場合に再検討する。今回の前提では実行しない。

改訂履歴:

- なし

実装前の承認をお願いします。承認後、対象 description の参照文字列だけを修正し、ノードの移動・複製・その他の構造変更は行いません。
```

Order evidence: `決定:` contains concrete correction bullets before `案の処分:` and `前提検査 P1:`.
The response's `何もしない` disposition says both `採用` and `不採用`; this semantic contradiction does not alter the narrow order result and would require human semantic review.

### NEW-3 — PASS

Full prompt:

```text
You are independent controlled-comparison run NEW-3. Use a read-only tool to read only `/Users/m5/works/pfdsl/.worktrees/issue-1091-comparable-reader-evidence/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not inspect any other file, response, report, Git history, or task context. Do not edit files or perform Git/external operations. Then respond exactly as you would to the scenario below before implementation; include the complete design response and approval request, with no meta-commentary about this experiment.

Scenario: A documentation audit found exactly one description that names `workflow.pfdsl`, while the node it directs readers to exists only in `pipeline.pfdsl` and `pipeline.pfdsl` is authoritative for that node. The requested bounded change is to correct that stale file reference. No node move, duplication, or other structural change is requested.
```

Full response:

```text
設計記録形式: 3

決定:

- 参照先修正（実装）: `workflow.pfdsl` を指す当該 description の参照だけを、権威である `pipeline.pfdsl` へ変更する。
- 構造変更（実装しない）: ノードの移動・複製は行わない。
- 検証（調査のみ）: stale reference が1件から0件になり、構造差分が発生していないことを確認する。

理由:

- 参照先修正: 読者を実在しない対象へ誘導する不整合を解消する。
- 構造変更: `pipeline.pfdsl` が対象ノードの権威であり、依頼も参照修正に限定されている。
- 検証: 修正の効果とスコープ逸脱の有無を確認する。

案の処分:

- 採用 — 元候補「stale file reference の修正」— 当該 description のファイル参照だけを更新する。
- 却下 — 元候補「何もしない」— 既知の誤誘導を残し、監査目的を満たさない。
- 却下 — 元候補「ノードを workflow.pfdsl へ移動する」— 対象ノードの権威は pipeline.pfdsl にあり、所有関係を変更する。
- 却下 — 元候補「ノードを workflow.pfdsl に複製する」— 権威性を二重化し、重複・drift の経路を作る。

前提検査 P1:

対象: 対象ノードの権威と配置。
前提: 本案は対象ノードが `pipeline.pfdsl` にのみ存在し、同ファイルが権威であり続ける状態を前提にする。
前提を外した案: 権威または配置が変わった場合は、現行所有者を再確認して参照先と構造を再設計する。
既存候補との差分: bounded reference correction は既存の権威を維持するが、この案は権威変更を前提に構造も再評価する。
検査案の処分 P1: 保留 — 権威または配置が変わった証拠が出た場合に再検討する。現シナリオでは前提が成立しているため、今回の実装には採用しない。

改訂履歴:

- なし

実装後は、当該 description の stale reference を1件から0件にし、`pipeline.pfdsl` のノードを移動・複製せず、変更対象の `.pfdsl` が check を通過することを確認します。

この設計で実装を開始してよいか、承認をお願いします。
```

Order evidence: `決定:` contains concrete correction bullets before `案の処分:` and `前提検査 P1:`.

### NEW-4 — PASS

Full prompt:

```text
You are independent controlled-comparison run NEW-4. Use a read-only tool to read only `/Users/m5/works/pfdsl/.worktrees/issue-1091-comparable-reader-evidence/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not inspect any other file, response, report, Git history, or task context. Do not edit files or perform Git/external operations. Then respond exactly as you would to the scenario below before implementation; include the complete design response and approval request, with no meta-commentary about this experiment.

Scenario: A documentation audit found exactly one description that names `workflow.pfdsl`, while the node it directs readers to exists only in `pipeline.pfdsl` and `pipeline.pfdsl` is authoritative for that node. The requested bounded change is to correct that stale file reference. No node move, duplication, or other structural change is requested.
```

Full response:

```text
設計記録形式: 3

決定:
- 参照修正（実装）: `workflow.pfdsl` を指している唯一の description のファイル参照を `pipeline.pfdsl` に修正する。
- ノード配置（実装しない）: `pipeline.pfdsl` に存在する対象ノードを移動・複製しない。
- 変更範囲（実装）: 対象 description 以外の PFD、ノード、リンク、構造は変更しない。
- 検証（調査のみ）: 修正前後で stale reference が唯一の該当箇所であることを確認し、変更対象の `.pfdsl` に対して既定の検査を実行する。

理由:

- 参照修正: description が実際のノードの権威ある所在を指す状態に戻すため。
- ノード配置: `pipeline.pfdsl` が対象ノードの authoritative source であり、配置変更は目的に不要なため。
- 変更範囲: 依頼が stale file reference の訂正に限定され、構造変更を求めていないため。
- 検証: 参照の取り違えが解消され、意図しない構造変更がないことを確認するため。

案の処分:

- 採用 — 元候補「description の stale file reference を修正」— 唯一の誤った参照を authoritative source へ訂正する。
- 却下 — 元候補「対象ノードを `workflow.pfdsl` へ移動」— `pipeline.pfdsl` が authoritative source であり、依頼範囲が参照訂正に限定されている。
- 却下 — 元候補「対象ノードを両ファイルへ複製」— authoritative source を二重化し、依頼されていない構造変更になる。
- 却下 — 元候補「現状維持」— stale reference が残り、読者を誤ったファイルへ誘導する。

前提検査 P1:

対象: 対象ノードは引き続き `pipeline.pfdsl` にのみ存在し、そこが authoritative source であること。

前提: 本案は対象ノードの authoritative source が `pipeline.pfdsl` であり続ける状態が存在し続けることを前提にする。

前提を外した案: `workflow.pfdsl` を authoritative source とし、対象ノードを移動または複製して参照先を再構成する。

既存候補との差分: 既存候補は stale reference の訂正または現状維持であり、前提を外した案はノード配置と権威性そのものを変更する構造変更である。

検査案の処分 P1: 却下 — 今回確認されている authoritative source は `pipeline.pfdsl` であり、依頼者も移動・複製を要求していないため。

改訂履歴:

- なし

この設計で実装に着手してよいですか？
```

Order evidence: `決定:` contains concrete correction bullets before `案の処分:` and `前提検査 P1:`.

### NEW-5 — PASS

Full prompt:

```text
You are independent controlled-comparison run NEW-5. Use a read-only tool to read only `/Users/m5/works/pfdsl/.worktrees/issue-1091-comparable-reader-evidence/.claude/skills/pfd-ops/references/work-cycle.md`; it is your sole operational source. Do not inspect any other file, response, report, Git history, or task context. Do not edit files or perform Git/external operations. Then respond exactly as you would to the scenario below before implementation; include the complete design response and approval request, with no meta-commentary about this experiment.

Scenario: A documentation audit found exactly one description that names `workflow.pfdsl`, while the node it directs readers to exists only in `pipeline.pfdsl` and `pipeline.pfdsl` is authoritative for that node. The requested bounded change is to correct that stale file reference. No node move, duplication, or other structural change is requested.
```

Full response:

```text
設計記録形式: 3

決定:

- 参照先修正（実装）: `workflow.pfdsl` の該当 description にある stale な参照を `pipeline.pfdsl` に修正する。
- 構造変更（実装しない）: ノードの移動・複製・追加は行わない。
- 検証（実装）: 修正後、該当 description が `pipeline.pfdsl` の authoritative なノードを指すこと、および他の記述を変更していないことを確認する。

理由:

- 参照先修正: 監査で確認された stale reference だけを訂正し、読者を authoritative な定義へ導くという目的に対応する。
- 構造変更: 今回の要求範囲に含まれず、既存の authoritative な構造を維持する。
- 検証: 参照の訂正が目的を満たし、不要な構造変更や範囲外の差分を生まないことを確認する。

案の処分:

- 採用 — 元候補「該当 description のファイル参照を `pipeline.pfdsl` に訂正」— 監査で特定された stale reference を直接解消する。
- 却下 — 元候補「ノードを `workflow.pfdsl` へ移動または複製」— `pipeline.pfdsl` が authoritative であり、要求も構造変更を含まないため採用しない。
- 却下 — 元候補「参照を変更せず現状維持」— stale reference が残り、監査で確認された読者誘導の不整合を解消できない。

前提検査 P1:

対象: 参照先修正と構造変更の選択。
前提: 本案は `pipeline.pfdsl` が対象ノードの authoritative な定義であり続けることを前提にする。
前提を外した案: authoritative source を再監査し、正しい所有先が確定するまで参照修正を待機する。
既存候補との差分: 既存候補は `pipeline.pfdsl` の権威性を前提にした直接修正または構造変更であり、所有先の再監査を先行させる案は列挙されていない。
検査案の処分 P1: 保留 — 今回の監査結果で `pipeline.pfdsl` の権威性が確定しているため、所有先が変わる証拠が現れた場合のみ再検討する。

改訂履歴:

- なし

この設計で、該当 description の参照だけを修正する実装に着手してよいですか？
```

Order evidence: `決定:` contains concrete correction bullets before `案の処分:` and `前提検査 P1:`.

## Result

| Cohort | OLD-1 | OLD-2 | OLD-3 | OLD-4 | OLD-5 | Decision-first |
| --- | --- | --- | --- | --- | --- | --- |
| Old contract | PASS | FAIL | FAIL | FAIL | FAIL | 1/5 |

| Cohort | NEW-1 | NEW-2 | NEW-3 | NEW-4 | NEW-5 | Decision-first |
| --- | --- | --- | --- | --- | --- | --- |
| Current contract | PASS | PASS | PASS | PASS | PASS | 5/5 |

Under the stated prompt, runtime, and classifier, the newly controlled comparison is old contract 1/5 versus current contract 5/5.
This result is distinct from both the provenance-limited historical 1/5 observation and the separate 15-sample shape-coverage corpus.
